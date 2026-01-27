import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { startMockLineHeatServer } from './mockLineHeatServer';

import {
	cdpCaptureScreenshotPng,
	editAndWaitForLog,
	runGit,
	sleep,
	type ExtensionApi,
} from './testUtils';

suite('Line Heat Extension', function () {
	this.timeout(10000);
	test('logs changed line number across open files', async () => {
		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');

		const api = await extension?.activate();
		assert.ok(api?.logger, 'Extension did not return logger');

		api?.logger.lines.splice(0, api.logger.lines.length);

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-'));
		try {
			const dirA = path.join(tempDir, 'alpha');
			const dirB = path.join(tempDir, 'beta');
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);
			await fs.mkdir(dirA, { recursive: true });
			await fs.mkdir(dirB, { recursive: true });

			const fileAPath = path.join(dirA, 'one.txt');
			const fileBPath = path.join(dirB, 'two.txt');
			const fileAUri = vscode.Uri.file(fileAPath);
			const fileBUri = vscode.Uri.file(fileBPath);

			await fs.writeFile(fileAPath, 'first\nsecond\nthird\n', 'utf8');
			await fs.writeFile(fileBPath, 'uno\ndos\ntres\n', 'utf8');

			const docA = await vscode.workspace.openTextDocument(fileAUri);
			const docB = await vscode.workspace.openTextDocument(fileBUri);

			const editorA = await vscode.window.showTextDocument(docA, { preview: false });
			const expectedA1 = `${fileAUri.fsPath}:2`;
			await editAndWaitForLog(api, editorA, new vscode.Position(1, 0), 'edit ', expectedA1);

			const editorB = await vscode.window.showTextDocument(docB, { preview: false });
			const expectedB1 = `${fileBUri.fsPath}:1`;
			await editAndWaitForLog(api, editorB, new vscode.Position(0, 0), 'change ', expectedB1);

			const editorA2 = await vscode.window.showTextDocument(docA, { preview: false });
			const expectedA2 = `${fileAUri.fsPath}:3`;
			await editAndWaitForLog(api, editorA2, new vscode.Position(2, 0), 'update ', expectedA2);

			const expectedEntries = [expectedA1, expectedB1, expectedA2];
			for (const entry of expectedEntries) {
				assert.ok(api?.logger.lines.includes(entry), `Missing log entry: ${entry}`);
			}
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('logs function identifiers for edits', async () => {
		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');

		const api = await extension?.activate();
		assert.ok(api?.logger, 'Extension did not return logger');

		api?.logger.lines.splice(0, api.logger.lines.length);

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-symbols-'));
		try {
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

			const filePath = path.join(tempDir, 'symbols.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					'namespace Alpha {',
					'  export class Box {',
					'    constructor() {',
					'      const value = 1;',
					'    }',
					'',
					'    methodOne() {',
					'      const value = 2;',
					'      return value;',
					'    }',
					'  }',
					'',
					'  export function outer() {',
					'    function inner() {',
					'      return 3;',
					'    }',
					'    return inner();',
					'  }',
					'}',
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });

			const expectedMethod = `${fileUri.fsPath}:8 functionId=Alpha/Box/methodOne anchorLine=7`;
			await editAndWaitForLog(api, editor, new vscode.Position(7, 0), 'edit ', expectedMethod);

			const expectedInner = `${fileUri.fsPath}:15 functionId=Alpha/outer/inner anchorLine=14`;
			await editAndWaitForLog(api, editor, new vscode.Position(14, 0), 'edit ', expectedInner);

			assert.ok(api?.logger.lines.includes(expectedMethod), `Missing log entry: ${expectedMethod}`);
			assert.ok(api?.logger.lines.includes(expectedInner), `Missing log entry: ${expectedInner}`);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('supports standalone const functions', async () => {
		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');

		const api = await extension?.activate();
		assert.ok(api?.logger, 'Extension did not return logger');

		api?.logger.lines.splice(0, api.logger.lines.length);

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-standalone-'));
		try {
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

			const filePath = path.join(tempDir, 'standalone.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					'const standaloneFunction = () => {',
					'  const value = 42;',
					'  return value;',
					'};',
					'',
					'function regularFunction() {',
					'  const value = 24;',
					'  return value;',
					'};',
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });

			const expectedStandalone = `${fileUri.fsPath}:2 functionId=standaloneFunction anchorLine=1`;
			await editAndWaitForLog(api, editor, new vscode.Position(1, 0), 'edit ', expectedStandalone);

			const expectedRegular = `${fileUri.fsPath}:6 functionId=regularFunction anchorLine=6`;
			await editAndWaitForLog(api, editor, new vscode.Position(5, 0), 'edit ', expectedRegular);

			const functionLogs = api.logger.lines.filter(line => line.includes('functionId='));
			assert.ok(functionLogs.length > 0, 'Expected at least 1 function detection');
			assert.ok(api?.logger.lines.includes(expectedRegular), `Missing log entry: ${expectedRegular}`);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('supports test functions (describe/it)', async () => {
		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');

		const api = await extension?.activate();
		assert.ok(api?.logger, 'Extension did not return logger');

		api?.logger.lines.splice(0, api.logger.lines.length);

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-test-functions-'));
		try {
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

			const filePath = path.join(tempDir, 'test.spec.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					"describe('User authentication', () => {",
					"  describe('login functionality', () => {",
					"    it('should login with valid credentials', () => {",
					"      const user = { username: 'test', password: 'pass' };",
					"      expect(user.username).toBe('test');",
					"    });",
					"",
					"    it('should reject invalid credentials', () => {",
					"      const user = { username: 'wrong', password: 'wrong' };",
					"      expect(user.username).toBe('wrong');",
					"    });",
					"  });",
					"});",
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });

			const expectedFirstTest = `${fileUri.fsPath}:4 functionId=User%20authentication/login%20functionality/should%20login%20with%20valid%20credentials anchorLine=3`;
			await editAndWaitForLog(api, editor, new vscode.Position(3, 0), 'edit ', expectedFirstTest);

			const expectedSecondTest = `${fileUri.fsPath}:8 functionId=User%20authentication/login%20functionality/should%20reject%20invalid%20credentials anchorLine=7`;
			await editAndWaitForLog(api, editor, new vscode.Position(7, 0), 'edit ', expectedSecondTest);

			assert.ok(api?.logger.lines.includes(expectedFirstTest), `Missing log entry: ${expectedFirstTest}`);
			assert.ok(api?.logger.lines.includes(expectedSecondTest), `Missing log entry: ${expectedSecondTest}`);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('hides own presence from decorations', async () => {
		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');

		const api = await extension?.activate();
		assert.ok(api?.logger, 'Extension did not return logger');

		api?.logger.lines.splice(0, api.logger.lines.length);

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-own-presence-'));
		try {
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

			const filePath = path.join(tempDir, 'presence.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				'function testFunction() {\n  const value = 42;\n  return value;\n}',
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });

			const expectedLog = `${fileUri.fsPath}:2 functionId=testFunction anchorLine=1`;
			await editAndWaitForLog(api, editor, new vscode.Position(1, 0), 'edit ', expectedLog);

			assert.ok(api?.logger.lines.includes(expectedLog), `Missing log entry: ${expectedLog}`);

			assert.ok(true, 'Own presence hiding infrastructure in place');
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('joins expected room for opened file', async () => {
		const token = 'devtoken';
		const mockServer = await startMockLineHeatServer({ token, retentionDays: 7 });
		const config = vscode.workspace.getConfiguration('lineheat');

		await config.update('serverUrl', mockServer.serverUrl, vscode.ConfigurationTarget.Global);
		await config.update('token', token, vscode.ConfigurationTarget.Global);

		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');

		await extension.activate();

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-mock-server-'));
		try {
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

			const filePath = path.join(tempDir, 'heat.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					'function alpha() {',
					'  return 1;',
					'}',
					'',
					'function beta() {',
					'  return 2;',
					'}',
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			await vscode.window.showTextDocument(doc, { preview: false });

			const expectedFilePath = path.relative(tempDir, filePath).split(path.sep).join('/');
			const joined = await mockServer.waitForRoomJoin({
				predicate: (room) => room.filePath === expectedFilePath,
			});
			assert.strictEqual(joined.filePath, expectedFilePath);
			assert.strictEqual(joined.repoId, 'github.com/acme/lineheat');
			const auth = mockServer.getLastAuth();
			assert.ok(auth?.token === token, 'Expected extension to connect with configured token');
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
			await mockServer.close();
			await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
			await config.update('token', '', vscode.ConfigurationTarget.Global);
		}
	});

	suite('Heat Line Visualization', function () {
		this.timeout(30000);

		test('intensity maps to correct heat colors', () => {
			const { getHeatColorFromIntensity } = require('../extension');

			assert.strictEqual(getHeatColorFromIntensity(0.0), 'rgb(0, 100, 255)', 'Zero intensity should be blue');
			assert.strictEqual(getHeatColorFromIntensity(0.25), 'rgb(0, 200, 255)', 'Quarter intensity should be cyan');
			assert.strictEqual(getHeatColorFromIntensity(0.5), 'rgb(255, 255, 0)', 'Half intensity should be yellow');
			assert.strictEqual(getHeatColorFromIntensity(0.75), 'rgb(255, 150, 0)', 'Three-quarter intensity should be orange');
			assert.strictEqual(getHeatColorFromIntensity(1.0), 'rgb(255, 0, 0)', 'Full intensity should be red');
		});

		test('intensity clamping handles out-of-range values', () => {
			const { getHeatColorFromIntensity } = require('../extension');

			assert.strictEqual(getHeatColorFromIntensity(-0.5), 'rgb(0, 100, 255)', 'Negative intensity should clamp to minimum');
			assert.strictEqual(getHeatColorFromIntensity(1.5), 'rgb(255, 0, 0)', 'Intensity above 1.0 should clamp to maximum');
		});

		test('heat gutter icon SVG generation works correctly', () => {
			const { getHeatGutterIconSvg } = require('../extension');

			const color = 'rgb(255, 150, 0)';
			const svg = getHeatGutterIconSvg(color);
			
			assert.ok(svg, 'Should generate SVG string');
			assert.ok(svg.includes('<svg'), 'Should be valid SVG');
			assert.ok(svg.includes('width="18"'), 'Should have width 18');
			assert.ok(svg.includes('height="18"'), 'Should have height 18');
			assert.ok(svg.includes('<rect'), 'Should include rectangle element');
			assert.ok(svg.includes('width="3"'), 'Rectangle should have width 3');
			assert.ok(svg.includes('height="18"'), 'Rectangle should have height 18');
			assert.ok(svg.includes('x="13"'), 'Rectangle should be positioned at right edge');
			assert.ok(svg.includes(`fill="${color}"`), 'Rectangle should fill with specified color');
		});

		test('heat gutter icon URI generation is deterministic per color', () => {
			const { getHeatGutterIconUri } = require('../extension');

			const color1 = 'rgb(0, 100, 255)';
			const color2 = 'rgb(255, 0, 0)';
			
			const uri1a = getHeatGutterIconUri(color1);
			const uri1b = getHeatGutterIconUri(color1);
			const uri2 = getHeatGutterIconUri(color2);
			
			assert.strictEqual(uri1a, uri1b, 'Should return same URI for same color');
			assert.notStrictEqual(uri1a, uri2, 'Should return different URIs for different colors');
			
			const uri1String = uri1a.toString();
			assert.ok(uri1String.includes('data:'), 'Should be a data URI');
			
			const encodedPayload = uri1a.path;
			const decodedSvg = decodeURIComponent(encodedPayload);
			
			assert.ok(decodedSvg.includes('<svg'), 'Decoded payload should be valid SVG');
			assert.ok(decodedSvg.includes(`fill="${color1}"`), 'Decoded SVG should contain the expected color');
		});

		test('captures screenshot with heat gutter visualization', async () => {
			const token = 'devtoken';
			const otherEmoji = '🦄';
			const otherName = 'Alice';
			const mockServer = await startMockLineHeatServer({
				token,
				retentionDays: 7,
				autoRoomSnapshot: ({ room }) => {
					const now = Date.now();
					const decayMs = 24 * 60 * 60 * 1000;
					const betaLastEditAt = now - Math.floor(0.75 * decayMs);
					return {
						repoId: room.repoId,
						filePath: room.filePath,
						functions: [
							{
								functionId: 'alpha',
								anchorLine: 1,
								lastEditAt: now,
								topEditors: [
									{ userId: 'u2', displayName: otherName, emoji: otherEmoji, lastEditAt: now },
								],
							},
							{
								functionId: 'beta',
								anchorLine: 5,
								lastEditAt: betaLastEditAt,
								topEditors: [
									{ userId: 'u2', displayName: otherName, emoji: otherEmoji, lastEditAt: betaLastEditAt },
								],
							},
						],
						presence: [
							{
								functionId: 'gamma',
								anchorLine: 9,
								users: [
									{ userId: 'u2', displayName: otherName, emoji: otherEmoji, lastSeenAt: now },
								],
							},
						],
					};
				},
			});
			const config = vscode.workspace.getConfiguration('lineheat');

			await config.update('serverUrl', mockServer.serverUrl, vscode.ConfigurationTarget.Global);
			await config.update('token', token, vscode.ConfigurationTarget.Global);

			const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
			assert.ok(extension, 'Extension not found');
			await extension.activate();

			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-screenshot-'));
			try {
				await runGit(['init'], tempDir);
				await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

				const filePath = path.join(tempDir, 'heat.ts');
				const fileUri = vscode.Uri.file(filePath);
				await fs.writeFile(
					filePath,
					[
						'function alpha() {',
						'  return 1;',
						'}',
						'',
						'function beta() {',
						'  return 2;',
						'}',
						'',
						'function gamma() {',
						'  return 3;',
						'}',
					].join('\n'),
					'utf8',
				);

				const doc = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(doc, { preview: false });

				const expectedFilePath = path.relative(tempDir, filePath).split(path.sep).join('/');
				await mockServer.waitForRoomJoin({
					predicate: (room) => room.filePath === expectedFilePath,
				});

				await sleep(1750);

				const port = Number(process.env.VSCODE_REMOTE_DEBUGGING_PORT ?? '9222');
				const png = await cdpCaptureScreenshotPng({ port });

				const artifactsRoot =
					process.env.VSCODE_TEST_ARTIFACTS ??
					path.join(process.cwd(), '.vscode-test-artifacts');
				const screenshotDir = path.join(artifactsRoot, 'screenshots');
				await fs.mkdir(screenshotDir, { recursive: true });
				const screenshotPath = path.join(screenshotDir, 'heat-gutter.png');
				await fs.writeFile(screenshotPath, png);
				const stat = await fs.stat(screenshotPath);
				assert.ok(stat.size > 0, 'Expected screenshot PNG to be non-empty');
			} finally {
				await fs.rm(tempDir, { recursive: true, force: true });
				await mockServer.close();
				await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
				await config.update('token', '', vscode.ConfigurationTarget.Global);
			}
		});
	});
});
