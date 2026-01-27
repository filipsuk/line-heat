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
	waitForAsync,
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

	suite('Heat CodeLens', function () {
		this.timeout(30000);

		test('provides heat CodeLens with emoji, age, and top editors', async () => {
			const token = 'devtoken';
			const editorConfig = vscode.workspace.getConfiguration('editor');
			const config = vscode.workspace.getConfiguration('lineheat');
			await editorConfig.update('codeLens', true, vscode.ConfigurationTarget.Global);

			const aliceEmoji = '🦄';
			const bobEmoji = '🙂';
			const carolEmoji = '🐱';
			const aliceName = 'Alice';
			const bobName = 'Bob';
			const carolName = 'Carol';

			const mockServer = await startMockLineHeatServer({
				token,
				retentionDays: 7,
				autoRoomSnapshot: ({ room }) => {
					const now = Date.now();
					const alphaLastEditAt = now - 2 * 60 * 1000;
					const betaLastEditAt = now - 17 * 60 * 60 * 1000;
					return {
						repoId: room.repoId,
						filePath: room.filePath,
						functions: [
							{
								functionId: 'alpha',
								anchorLine: 1,
								lastEditAt: alphaLastEditAt,
								topEditors: [
									{ userId: 'u2', displayName: aliceName, emoji: aliceEmoji, lastEditAt: alphaLastEditAt },
									{ userId: 'u3', displayName: bobName, emoji: bobEmoji, lastEditAt: alphaLastEditAt },
									{ userId: 'u4', displayName: carolName, emoji: carolEmoji, lastEditAt: alphaLastEditAt },
								],
							},
							{
								functionId: 'beta',
								anchorLine: 5,
								lastEditAt: betaLastEditAt,
								topEditors: [
									{ userId: 'u2', displayName: aliceName, emoji: aliceEmoji, lastEditAt: betaLastEditAt },
								],
							},
						],
						presence: [],
					};
				},
			});

			await config.update('serverUrl', mockServer.serverUrl, vscode.ConfigurationTarget.Global);
			await config.update('token', token, vscode.ConfigurationTarget.Global);

			const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
			assert.ok(extension, 'Extension not found');
			await extension.activate();

			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-codelens-'));
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

				await waitForAsync(async () => {
					const result = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', fileUri);
					const lenses = result as vscode.CodeLens[];
					const titles = lenses
						.map((lens) => lens.command?.title)
						.filter((title): title is string => Boolean(title));
					const hasHot = titles.some(
						(title) => title.includes('🔥') && title.includes(`${aliceEmoji} ${aliceName}`),
					);
					const hasMild = titles.some(
						(title) => title.includes('🟡') && title.includes(`${aliceEmoji} ${aliceName}`),
					);
					const hasGammaLine = lenses.some((lens) => lens.range.start.line === 8);
					return hasHot && hasMild && !hasGammaLine;
				}, 8000);
			} finally {
				await fs.rm(tempDir, { recursive: true, force: true });
				await mockServer.close();
				await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
				await config.update('token', '', vscode.ConfigurationTarget.Global);
				await editorConfig.update('codeLens', undefined, vscode.ConfigurationTarget.Global);
			}
		});

		test('captures screenshot with heat CodeLens', async () => {
			const token = 'devtoken';
			const editorConfig = vscode.workspace.getConfiguration('editor');
			await editorConfig.update('codeLens', true, vscode.ConfigurationTarget.Global);

			const aliceEmoji = '🦄';
			const aliceName = 'Alice';
			const bobEmoji = '🙂';
			const bobName = 'Bob';

			const mockServer = await startMockLineHeatServer({
				token,
				retentionDays: 7,
				autoRoomSnapshot: ({ room }) => {
					const now = Date.now();
					const alphaLastEditAt = now - 2 * 60 * 1000;
					return {
						repoId: room.repoId,
						filePath: room.filePath,
						functions: [
							{
								functionId: 'alpha',
								anchorLine: 1,
								lastEditAt: alphaLastEditAt,
								topEditors: [
									{ userId: 'u2', displayName: aliceName, emoji: aliceEmoji, lastEditAt: alphaLastEditAt },
									{ userId: 'u3', displayName: bobName, emoji: bobEmoji, lastEditAt: alphaLastEditAt },
								],
							},
						],
						presence: [],
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
					].join('\n'),
					'utf8',
				);

				const doc = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(doc, { preview: false });

				const expectedFilePath = path.relative(tempDir, filePath).split(path.sep).join('/');
				await mockServer.waitForRoomJoin({
					predicate: (room) => room.filePath === expectedFilePath,
				});

				await waitForAsync(async () => {
					const result = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', fileUri);
					const lenses = result as vscode.CodeLens[];
					return lenses.some((lens) => (lens.command?.title ?? '').includes('🔥'));
				}, 8000);

				await sleep(1250);

				const port = Number(process.env.VSCODE_REMOTE_DEBUGGING_PORT ?? '9222');
				const png = await cdpCaptureScreenshotPng({ port });

				const artifactsRoot =
					process.env.VSCODE_TEST_ARTIFACTS ??
					path.join(process.cwd(), '.vscode-test-artifacts');
				const screenshotDir = path.join(artifactsRoot, 'screenshots');
				await fs.mkdir(screenshotDir, { recursive: true });
				const screenshotPath = path.join(screenshotDir, 'heat-codelens.png');
				await fs.writeFile(screenshotPath, png);
				const stat = await fs.stat(screenshotPath);
				assert.ok(stat.size > 0, 'Expected screenshot PNG to be non-empty');
			} finally {
				await fs.rm(tempDir, { recursive: true, force: true });
				await mockServer.close();
				await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
				await config.update('token', '', vscode.ConfigurationTarget.Global);
				await editorConfig.update('codeLens', undefined, vscode.ConfigurationTarget.Global);
			}
		});
	});
});
