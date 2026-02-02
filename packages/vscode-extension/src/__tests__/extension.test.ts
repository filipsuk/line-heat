import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { HASH_VERSION, sha256Hex } from '@line-heat/protocol';

import { startMockLineHeatServer } from './support/mockLineHeatServer';

import {
	cdpCaptureScreenshotPng,
	editAndWaitForLog,
	runGit,
	sleep,
	waitFor,
	waitForAsync,
	type ExtensionApi,
} from './support/testUtils';

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

			const expectedInner = `${fileUri.fsPath}:15 functionId=Alpha/outer anchorLine=13`;
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

		test('does not treat nested const arrow functions as separate blocks', async () => {
			const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
			assert.ok(extension, 'Extension not found');

		const api = await extension?.activate();
		assert.ok(api?.logger, 'Extension did not return logger');

		api?.logger.lines.splice(0, api.logger.lines.length);

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-nested-const-'));
		try {
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

			const filePath = path.join(tempDir, 'nested-const.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					'type LogLevel = "info" | "debug";',
					'type LineHeatLogger = { log: (message: string) => void };',
					'',
					'const createLogger = (level: LogLevel): LineHeatLogger => {',
					'  const secondLevelVariable = () => {',
					'    const inner = 1;',
					'    return inner;',
					'  };',
					'',
					'  return {',
					'    log: () => secondLevelVariable(),',
					'  };',
					'};',
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });

			const expected = `${fileUri.fsPath}:6 functionId=createLogger anchorLine=4`;
			await editAndWaitForLog(api, editor, new vscode.Position(5, 0), 'edit ', expected);

			assert.ok(
				!api.logger.lines.some((line) => line.includes('functionId=secondLevelVariable')),
				`Unexpected nested functionId detected. Last 20 log entries:\n${api.logger.lines
					.slice(-20)
					.join('\n')}`,
			);
			} finally {
				await fs.rm(tempDir, { recursive: true, force: true });
			}
		});

	test('attributes deep edits to the nearest level-2 block (top-level const arrow)', async () => {
		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');

		const api = await extension?.activate();
		assert.ok(api?.logger, 'Extension did not return logger');

		api?.logger.lines.splice(0, api.logger.lines.length);

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-inline-callback-'));
		try {
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

			const filePath = path.join(tempDir, 'inline-callback.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					'export const foo = () => {',
					'  someFunc((x: number) => {',
					'    function level3() {',
					'      const z = 1;',
					'      return z;',
					'    }',
					'    return level3() + x;',
					'  });',
					'};',
					'',
					'function someFunc(cb: (x: number) => number) {',
					'  return cb(1);',
					'}',
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });

			const expected = `${fileUri.fsPath}:4 functionId=foo anchorLine=1`;
			await editAndWaitForLog(api, editor, new vscode.Position(3, 0), 'edit ', expected);

			assert.ok(api?.logger.lines.includes(expected), `Missing log entry: ${expected}`);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('attributes edits inside exported const arrow (empty body) to the const symbol', async () => {
		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');

		const api = await extension?.activate();
		assert.ok(api?.logger, 'Extension did not return logger');

		api?.logger.lines.splice(0, api.logger.lines.length);

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-exported-const-typed-'));
		try {
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

			const filePath = path.join(tempDir, 'exported-const-empty-body.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					'export const formatRelativeTime = (now: number, timestamp: number) => {',
					'	// heat and presence should work here',
					'};',
					'',
					'export const other = () => 1;',
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });

			const expected = `${fileUri.fsPath}:2 functionId=formatRelativeTime anchorLine=1`;
			await editAndWaitForLog(api, editor, new vscode.Position(1, 1), 'edit ', expected);

			assert.ok(api?.logger.lines.includes(expected), `Missing log entry: ${expected}`);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('attributes deep edits to the nearest level-2 block (top-level function)', async () => {
		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');

		const api = await extension?.activate();
		assert.ok(api?.logger, 'Extension did not return logger');

		api?.logger.lines.splice(0, api.logger.lines.length);

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-deep-function-'));
		try {
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

			const filePath = path.join(tempDir, 'deep-function.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					'export function outer() {',
					'  function level2() {',
					'    function level3() {',
					'      function level4() {',
					'        return 1;',
					'      }',
					'      return level4();',
					'    }',
					'    return level3();',
					'  }',
					'  return level2();',
					'}',
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });

			const expected = `${fileUri.fsPath}:5 functionId=outer anchorLine=1`;
			await editAndWaitForLog(api, editor, new vscode.Position(4, 0), 'edit ', expected);

			assert.ok(api?.logger.lines.includes(expected), `Missing log entry: ${expected}`);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('attributes deep edits to the nearest level-2 block (class method)', async () => {
		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');

		const api = await extension?.activate();
		assert.ok(api?.logger, 'Extension did not return logger');

		api?.logger.lines.splice(0, api.logger.lines.length);

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-deep-class-method-'));
		try {
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

			const filePath = path.join(tempDir, 'deep-class.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					'export class Box {',
					'  methodOne() {',
					'    function level3() {',
					'      function level4() {',
					'        return 1;',
					'      }',
					'      return level4();',
					'    }',
					'    return level3();',
					'  }',
					'}',
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });

			const expected = `${fileUri.fsPath}:5 functionId=Box/methodOne anchorLine=2`;
			await editAndWaitForLog(api, editor, new vscode.Position(4, 0), 'edit ', expected);

			assert.ok(api?.logger.lines.includes(expected), `Missing log entry: ${expected}`);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('attributes edits in class body to the class when no level-2 member applies', async () => {
		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');

		const api = await extension?.activate();
		assert.ok(api?.logger, 'Extension did not return logger');

		api?.logger.lines.splice(0, api.logger.lines.length);

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-class-body-'));
		try {
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

			const filePath = path.join(tempDir, 'class-body.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					'export class Box {',
					'  private value = 1;',
					'',
					'  methodOne() {',
					'    return this.value;',
					'  }',
					'}',
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc, { preview: false });

			const expected = `${fileUri.fsPath}:2 functionId=Box anchorLine=1`;
			await editAndWaitForLog(api, editor, new vscode.Position(1, 0), 'edit ', expected);

			assert.ok(api?.logger.lines.includes(expected), `Missing log entry: ${expected}`);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});


		test('does not show own presence in CodeLens', async () => {
		const token = 'devtoken';
		const editorConfig = vscode.workspace.getConfiguration('editor');
		const config = vscode.workspace.getConfiguration('lineheat');
		await editorConfig.update('codeLens', true, vscode.ConfigurationTarget.Global);
		await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
		await config.update('token', '', vscode.ConfigurationTarget.Global);
		await config.update('displayName', 'Me', vscode.ConfigurationTarget.Global);
		await config.update('emoji', '😎', vscode.ConfigurationTarget.Global);

		const mockServer = await startMockLineHeatServer({
			token,
			retentionDays: 7,
			autoRoomSnapshot: ({ room, auth }) => {
				const ownUserId = auth?.userId ?? 'unknown';
				const now = Date.now();
				return {
					hashVersion: HASH_VERSION,
					repoId: room.repoId,
					filePath: room.filePath,
					functions: [],
					presence: [
						{
							functionId: sha256Hex('testFunction'),
							anchorLine: 1,
							users: [
								{ userId: ownUserId, displayName: 'Me', emoji: '😎', lastSeenAt: now },
								{ userId: 'u2', displayName: 'Alice', emoji: '🦄', lastSeenAt: now },
							],
						},
					],
				};
			},
		});

		test('logs presence:set with a meaningful functionId (not %2F) for exported const arrow', async () => {
			const token = 'devtoken';
			const editorConfig = vscode.workspace.getConfiguration('editor');
			const config = vscode.workspace.getConfiguration('lineheat');
			await editorConfig.update('codeLens', true, vscode.ConfigurationTarget.Global);
			await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
			await config.update('token', '', vscode.ConfigurationTarget.Global);
			await config.update('displayName', 'Me', vscode.ConfigurationTarget.Global);
			await config.update('emoji', '😎', vscode.ConfigurationTarget.Global);
			await config.update('logLevel', 'debug', vscode.ConfigurationTarget.Global);

			const mockServer = await startMockLineHeatServer({ token, retentionDays: 7 });
			await config.update('serverUrl', mockServer.serverUrl, vscode.ConfigurationTarget.Global);
			await config.update('token', token, vscode.ConfigurationTarget.Global);

			const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
			assert.ok(extension, 'Extension not found');
			const api = await extension.activate();
			assert.ok(api?.logger, 'Extension did not return logger');
			api.logger.messages.splice(0, api.logger.messages.length);

			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-presence-functionid-'));
			try {
				await runGit(['init'], tempDir);
				await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

				const filePath = path.join(tempDir, 'someFunc.ts');
				const fileUri = vscode.Uri.file(filePath);
				await fs.writeFile(
					filePath,
					[
						'export const someFunc = (intensity: number) => {',
						"\tif (intensity >= 0.75) {",
						"\t\treturn '🔥';",
						"\t}",
						"\tif (intensity >= 0.5) {",
						"\t\treturn '🟠';",
						"\t}",
						"\tif (intensity >= 0.25) {",
						"\t\treturn '🟡';",
						"\t}",
						"\treturn '🔵';",
						'};',
					].join('\n'),
					'utf8',
				);

				const doc = await vscode.workspace.openTextDocument(fileUri);
				const editor = await vscode.window.showTextDocument(doc, { preview: false });
				await sleep(100);
				api.logger.messages.splice(0, api.logger.messages.length);

				const expectedFilePath = path.relative(tempDir, filePath).split(path.sep).join('/');
				const expectedFilePathHash = sha256Hex(expectedFilePath);
				await mockServer.waitForRoomJoin({ predicate: (room) => room.filePath === expectedFilePathHash });

				editor.selection = new vscode.Selection(new vscode.Position(5, 1), new vscode.Position(5, 1));
				await waitFor(
					() =>
						api.logger.messages.some(
							(m) => m.includes('lineheat: presence:desired:set') && m.includes('functionId=someFunc'),
						),
					8000,
					`presence:desired:set not observed. Last 30 messages:\n${api.logger.messages
						.slice(-30)
						.join('\n')}`,
				);
				assert.ok(
					!api.logger.messages.some((m) => m.includes('lineheat: presence:set') && m.includes('functionId=%2F')),
					`Unexpected %2F functionId in presence:set. Last 30 messages:\n${api.logger.messages
						.slice(-30)
						.join('\n')}`,
				);
			} finally {
				await fs.rm(tempDir, { recursive: true, force: true });
				await mockServer.close();
				await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
				await config.update('token', '', vscode.ConfigurationTarget.Global);
				await config.update('displayName', '', vscode.ConfigurationTarget.Global);
				await config.update('emoji', '', vscode.ConfigurationTarget.Global);
				await config.update('logLevel', undefined, vscode.ConfigurationTarget.Global);
				await editorConfig.update('codeLens', undefined, vscode.ConfigurationTarget.Global);
			}
		});

		await config.update('serverUrl', mockServer.serverUrl, vscode.ConfigurationTarget.Global);
		await config.update('token', token, vscode.ConfigurationTarget.Global);

		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');
		await extension.activate();

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
			await vscode.window.showTextDocument(doc, { preview: false });

			const expectedFilePath = path.relative(tempDir, filePath).split(path.sep).join('/');
			const expectedFilePathHash = sha256Hex(expectedFilePath);
			await mockServer.waitForRoomJoin({
				predicate: (room) => room.filePath === expectedFilePathHash,
			});

			await waitForAsync(async () => {
				const result = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', fileUri);
				const lenses = result as vscode.CodeLens[];
				const titles = lenses
					.map((lens) => lens.command?.title)
					.filter((title): title is string => Boolean(title));
				const hasOther = titles.some((title) => title.includes('live:') && title.includes('🦄 Alice'));
				const hasSelf = titles.some((title) => title.includes('😎 Me'));
				return hasOther && !hasSelf;
			}, 8000);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
			await mockServer.close();
			await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
			await config.update('token', '', vscode.ConfigurationTarget.Global);
			await config.update('displayName', '', vscode.ConfigurationTarget.Global);
			await config.update('emoji', '', vscode.ConfigurationTarget.Global);
			await editorConfig.update('codeLens', undefined, vscode.ConfigurationTarget.Global);
		}
		});

		test('does not show own edits in CodeLens', async () => {
			const token = 'devtoken';
			const editorConfig = vscode.workspace.getConfiguration('editor');
			const config = vscode.workspace.getConfiguration('lineheat');
			await editorConfig.update('codeLens', true, vscode.ConfigurationTarget.Global);
			await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
			await config.update('token', '', vscode.ConfigurationTarget.Global);
			await config.update('displayName', 'Me', vscode.ConfigurationTarget.Global);
			await config.update('emoji', '😎', vscode.ConfigurationTarget.Global);

			const mockServer = await startMockLineHeatServer({
				token,
				retentionDays: 7,
				autoRoomSnapshot: ({ room, auth }) => {
					const ownUserId = auth?.userId ?? 'unknown';
					const now = Date.now();
					const lastEditAt = now - 2 * 60 * 1000;
					return {
						hashVersion: HASH_VERSION,
						repoId: room.repoId,
						filePath: room.filePath,
						functions: [
							{
								functionId: sha256Hex('testFunction'),
								anchorLine: 1,
								lastEditAt,
								topEditors: [
									{ userId: ownUserId, displayName: 'Me', emoji: '😎', lastEditAt },
									{ userId: 'u2', displayName: 'Alice', emoji: '🦄', lastEditAt },
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

			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-own-edits-'));
			try {
				await runGit(['init'], tempDir);
				await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

				const filePath = path.join(tempDir, 'edits.ts');
				const fileUri = vscode.Uri.file(filePath);
				await fs.writeFile(
					filePath,
					'function testFunction() {\n  const value = 42;\n  return value;\n}',
					'utf8',
				);

				const doc = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(doc, { preview: false });

				const expectedFilePath = path.relative(tempDir, filePath).split(path.sep).join('/');
				const expectedFilePathHash = sha256Hex(expectedFilePath);
				await mockServer.waitForRoomJoin({
					predicate: (room) => room.filePath === expectedFilePathHash,
				});

				await waitForAsync(async () => {
					const result = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', fileUri);
					const lenses = result as vscode.CodeLens[];
					const titles = lenses
						.map((lens) => lens.command?.title)
						.filter((title): title is string => typeof title === 'string' && (title.includes('edit:') || title.includes('live:')));
					const hasOther = titles.some((title) => title.includes('edit:') && title.includes('🦄 Alice'));
					const hasSelf = titles.some((title) => title.includes('😎 Me'));
					return hasOther && !hasSelf;
				}, 8000);
			} finally {
				await fs.rm(tempDir, { recursive: true, force: true });
				await mockServer.close();
				await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
				await config.update('token', '', vscode.ConfigurationTarget.Global);
				await config.update('displayName', '', vscode.ConfigurationTarget.Global);
				await config.update('emoji', '', vscode.ConfigurationTarget.Global);
				await editorConfig.update('codeLens', undefined, vscode.ConfigurationTarget.Global);
			}
		});

		test('does not show heat CodeLens when only editor is self', async () => {
			const token = 'devtoken';
			const editorConfig = vscode.workspace.getConfiguration('editor');
			const config = vscode.workspace.getConfiguration('lineheat');
			await editorConfig.update('codeLens', true, vscode.ConfigurationTarget.Global);
			await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
			await config.update('token', '', vscode.ConfigurationTarget.Global);
			await config.update('displayName', 'Me', vscode.ConfigurationTarget.Global);
			await config.update('emoji', '😎', vscode.ConfigurationTarget.Global);

			const mockServer = await startMockLineHeatServer({
				token,
				retentionDays: 7,
				autoRoomSnapshot: ({ room, auth }) => {
					const ownUserId = auth?.userId ?? 'unknown';
					const now = Date.now();
					const lastEditAt = now - 2 * 60 * 1000;
					return {
						hashVersion: HASH_VERSION,
						repoId: room.repoId,
						filePath: room.filePath,
						functions: [
							{
								functionId: sha256Hex('testFunction'),
								anchorLine: 1,
								lastEditAt,
								topEditors: [
									{ userId: ownUserId, displayName: 'Me', emoji: '😎', lastEditAt },
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

			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-own-edits-only-self-'));
			try {
				await runGit(['init'], tempDir);
				await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

				const filePath = path.join(tempDir, 'edits-only-self.ts');
				const fileUri = vscode.Uri.file(filePath);
				await fs.writeFile(
					filePath,
					'function testFunction() {\n  const value = 42;\n  return value;\n}',
					'utf8',
				);

				const doc = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(doc, { preview: false });

				const expectedFilePath = path.relative(tempDir, filePath).split(path.sep).join('/');
				const expectedFilePathHash = sha256Hex(expectedFilePath);
				await mockServer.waitForRoomJoin({
					predicate: (room) => room.filePath === expectedFilePathHash,
				});

				await waitForAsync(async () => {
					const result = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', fileUri);
					const lenses = result as vscode.CodeLens[];
					const lineHeatLenses = lenses.filter(
						(lens) => {
							const title = lens.command?.title ?? '';
							return title.includes('edit:') || title.includes('live:');
						},
					);
					return lineHeatLenses.length === 0;
				}, 8000);
			} finally {
				await fs.rm(tempDir, { recursive: true, force: true });
				await mockServer.close();
				await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
				await config.update('token', '', vscode.ConfigurationTarget.Global);
				await config.update('displayName', '', vscode.ConfigurationTarget.Global);
				await config.update('emoji', '', vscode.ConfigurationTarget.Global);
				await editorConfig.update('codeLens', undefined, vscode.ConfigurationTarget.Global);
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
			const expectedFilePathHash = sha256Hex(expectedFilePath);
			const expectedRepoIdHash = sha256Hex('github.com/acme/lineheat');
			const joined = await mockServer.waitForRoomJoin({
				predicate: (room) => room.filePath === expectedFilePathHash,
			});
			assert.strictEqual(joined.hashVersion, HASH_VERSION);
			assert.strictEqual(joined.filePath, expectedFilePathHash);
			assert.strictEqual(joined.repoId, expectedRepoIdHash);
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

			test('shows other user presence from file:delta', async () => {
				const token = 'devtoken';
				const editorConfig = vscode.workspace.getConfiguration('editor');
				const config = vscode.workspace.getConfiguration('lineheat');
				await editorConfig.update('codeLens', true, vscode.ConfigurationTarget.Global);

				const aliceEmoji = '🦄';
				const aliceName = 'Alice';

				const mockServer = await startMockLineHeatServer({
					token,
					retentionDays: 7,
					autoRoomSnapshot: ({ room }) => ({
						hashVersion: HASH_VERSION,
						repoId: room.repoId,
						filePath: room.filePath,
						functions: [],
						presence: [],
					}),
				});

				await config.update('serverUrl', mockServer.serverUrl, vscode.ConfigurationTarget.Global);
				await config.update('token', token, vscode.ConfigurationTarget.Global);

				const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
				assert.ok(extension, 'Extension not found');
				await extension.activate();

				const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-presence-delta-'));
				try {
					await runGit(['init'], tempDir);
					await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

					const filePath = path.join(tempDir, 'presence.ts');
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
					const expectedFilePathHash = sha256Hex(expectedFilePath);
					const joinedRoom = await mockServer.waitForRoomJoin({
						predicate: (room) => room.filePath === expectedFilePathHash,
					});

					const now = Date.now();
					mockServer.emitFileDelta({
						hashVersion: HASH_VERSION,
						repoId: joinedRoom.repoId,
						filePath: joinedRoom.filePath,
						updates: {
							presence: [
								{
									functionId: sha256Hex('alpha'),
									anchorLine: 1,
									users: [
										{
											userId: 'u2',
											displayName: aliceName,
											emoji: aliceEmoji,
											lastSeenAt: now,
										},
									],
								},
							],
						},
					});

					await waitForAsync(async () => {
						const result = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', fileUri);
						const lenses = result as vscode.CodeLens[];
						const titles = lenses
							.map((lens) => lens.command?.title)
							.filter((title): title is string => Boolean(title));
						return titles.some(
							(title) => title.includes('live:') && title.includes(`${aliceEmoji} ${aliceName}`),
						);
					}, 8000);
				} finally {
					await fs.rm(tempDir, { recursive: true, force: true });
					await mockServer.close();
					await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
					await config.update('token', '', vscode.ConfigurationTarget.Global);
					await editorConfig.update('codeLens', undefined, vscode.ConfigurationTarget.Global);
				}
			});

			test('provides heat CodeLens with emoji, age, and top editors', async () => {
				const token = 'devtoken';
				const editorConfig = vscode.workspace.getConfiguration('editor');
				const config = vscode.workspace.getConfiguration('lineheat');
			await editorConfig.update('codeLens', true, vscode.ConfigurationTarget.Global);
			// Set decay to 24 hours so 17h old edit shows '🟡' (intensity ~0.29)
			await config.update('heatDecayHours', 24, vscode.ConfigurationTarget.Global);

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
						hashVersion: HASH_VERSION,
						repoId: room.repoId,
						filePath: room.filePath,
						functions: [
							{
								functionId: sha256Hex('alpha'),
								anchorLine: 1,
								lastEditAt: alphaLastEditAt,
								topEditors: [
									{ userId: 'u2', displayName: aliceName, emoji: aliceEmoji, lastEditAt: alphaLastEditAt },
									{ userId: 'u3', displayName: bobName, emoji: bobEmoji, lastEditAt: alphaLastEditAt },
									{ userId: 'u4', displayName: carolName, emoji: carolEmoji, lastEditAt: alphaLastEditAt },
								],
							},
							{
								functionId: sha256Hex('beta'),
								anchorLine: 5,
								lastEditAt: betaLastEditAt,
								topEditors: [
									{ userId: 'u2', displayName: aliceName, emoji: aliceEmoji, lastEditAt: betaLastEditAt },
								],
							},
						],
						presence: [
							{
								functionId: sha256Hex('alpha'),
								anchorLine: 1,
								users: [
									{ userId: 'u5', displayName: carolName, emoji: carolEmoji, lastSeenAt: now },
								],
								},
							],
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
				const expectedFilePathHash = sha256Hex(expectedFilePath);
				await mockServer.waitForRoomJoin({
					predicate: (room) => room.filePath === expectedFilePathHash,
				});

				// Allow time for snapshot to be processed by the client
				await sleep(200);

				const debugInfo = { lastDebug: '' };
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
					const hasPresence = titles.some(
						(title) => title.includes('live:') && title.includes(`${carolEmoji} ${carolName}`),
					);
					const hasGammaLine = lenses.some((lens) => lens.range.start.line === 8);
					debugInfo.lastDebug = `lenses=${lenses.length} titles=[${titles.join(' | ')}] hasHot=${hasHot} hasMild=${hasMild} hasPresence=${hasPresence} hasGammaLine=${hasGammaLine}`;
					if (hasHot && hasMild && hasPresence && !hasGammaLine) {
						return true;
					}
					return false;
				}, 10000).catch((err) => {
					throw new Error(`${err.message}. Debug: ${debugInfo.lastDebug}`);
				});
			} finally {
				await fs.rm(tempDir, { recursive: true, force: true });
				await mockServer.close();
				await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
				await config.update('token', '', vscode.ConfigurationTarget.Global);
				await config.update('heatDecayHours', undefined, vscode.ConfigurationTarget.Global);
				await editorConfig.update('codeLens', undefined, vscode.ConfigurationTarget.Global);
			}
		});

		test('preserves non-self age when local user edits the same function', async () => {
			const token = 'devtoken';
			const editorConfig = vscode.workspace.getConfiguration('editor');
			const config = vscode.workspace.getConfiguration('lineheat');
			await editorConfig.update('codeLens', true, vscode.ConfigurationTarget.Global);

			const aliceEmoji = '🦄';
			const aliceName = 'Alice';
			const selfName = 'Me';
			const selfEmoji = '😎';

			const mockServer = await startMockLineHeatServer({
				token,
				retentionDays: 7,
				autoRoomSnapshot: ({ room, auth }) => {
					const ownUserId = auth?.userId ?? 'unknown';
					const now = Date.now();
					// Non-self edit happened 30 minutes ago
					const nonSelfLastEditAt = now - 30 * 60 * 1000;
					// Self edit happened 2 minutes ago (newer)
					const selfLastEditAt = now - 2 * 60 * 1000;
					return {
						hashVersion: HASH_VERSION,
						repoId: room.repoId,
						filePath: room.filePath,
						functions: [
							{
								functionId: sha256Hex('testFunction'),
								anchorLine: 1,
								lastEditAt: selfLastEditAt, // Overall heat timestamp is self (newer)
								topEditors: [
									{ userId: 'u2', displayName: aliceName, emoji: aliceEmoji, lastEditAt: nonSelfLastEditAt },
									{ userId: ownUserId, displayName: selfName, emoji: selfEmoji, lastEditAt: selfLastEditAt },
								],
							},
						],
						presence: [],
					};
				},
			});

			await config.update('serverUrl', mockServer.serverUrl, vscode.ConfigurationTarget.Global);
			await config.update('token', token, vscode.ConfigurationTarget.Global);
			await config.update('displayName', selfName, vscode.ConfigurationTarget.Global);
			await config.update('emoji', selfEmoji, vscode.ConfigurationTarget.Global);

			const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
			assert.ok(extension, 'Extension not found');
			await extension.activate();

			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-non-self-age-'));
			try {
				await runGit(['init'], tempDir);
				await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

				const filePath = path.join(tempDir, 'age.ts');
				const fileUri = vscode.Uri.file(filePath);
				await fs.writeFile(
					filePath,
					'function testFunction() {\n  const value = 42;\n  return value;\n}',
					'utf8',
				);

				const doc = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(doc, { preview: false });

				const expectedFilePath = path.relative(tempDir, filePath).split(path.sep).join('/');
				const expectedFilePathHash = sha256Hex(expectedFilePath);
				await mockServer.waitForRoomJoin({
					predicate: (room) => room.filePath === expectedFilePathHash,
				});

				await waitForAsync(async () => {
					const result = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', fileUri);
					const lenses = result as vscode.CodeLens[];
					const heatLens = lenses.find(
						(lens) => {
							const title = lens.command?.title ?? '';
							return title.includes('edit:') || title.includes('live:');
						},
					);
					if (!heatLens) {
						return false;
					}
					
					const title = heatLens.command?.title ?? '';
					// Should show the non-self age (30 minutes ago), not self age (2 minutes ago)
					// formatRelativeTime should return "30m" for 30 minutes ago
					assert.ok(title.includes('30m'), `Expected title to contain "30m" (non-self age), got: ${title}`);
					assert.ok(title.includes('edit:'), `Expected title to contain "edit:", got: ${title}`);
					assert.ok(title.includes(`${aliceEmoji} ${aliceName}`), `Expected title to contain Alice, got: ${title}`);
					// Should not contain self user in the title
					assert.ok(!title.includes(selfName), `Expected title to not contain self user, got: ${title}`);
					
					// Tooltip should also use the non-self age
					const tooltip = heatLens.command?.tooltip ?? '';
					assert.ok(tooltip.includes('30m'), `Expected tooltip to contain "30m", got: ${tooltip}`);
					return true;
				}, 8000);
			} finally {
				await fs.rm(tempDir, { recursive: true, force: true });
				await mockServer.close();
				await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
				await config.update('token', '', vscode.ConfigurationTarget.Global);
				await config.update('displayName', '', vscode.ConfigurationTarget.Global);
				await config.update('emoji', '', vscode.ConfigurationTarget.Global);
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
						hashVersion: HASH_VERSION,
						repoId: room.repoId,
						filePath: room.filePath,
						functions: [
							{
								functionId: sha256Hex('alpha'),
								anchorLine: 1,
								lastEditAt: alphaLastEditAt,
								topEditors: [
									{ userId: 'u2', displayName: aliceName, emoji: aliceEmoji, lastEditAt: alphaLastEditAt },
									{ userId: 'u3', displayName: bobName, emoji: bobEmoji, lastEditAt: alphaLastEditAt },
								],
							},
						],
						presence: [
							{
								functionId: sha256Hex('alpha'),
								anchorLine: 1,
								users: [
									{ userId: 'u9', displayName: bobName, emoji: bobEmoji, lastSeenAt: now },
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
					].join('\n'),
					'utf8',
				);

				const doc = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(doc, { preview: false });

				const expectedFilePath = path.relative(tempDir, filePath).split(path.sep).join('/');
				const expectedFilePathHash = sha256Hex(expectedFilePath);
				await mockServer.waitForRoomJoin({
					predicate: (room) => room.filePath === expectedFilePathHash,
				});

				await waitForAsync(async () => {
					const result = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', fileUri);
					const lenses = result as vscode.CodeLens[];
					return lenses.some((lens) => {
						const title = lens.command?.title ?? '';
					return title.includes('🔥') && title.includes('live:');
					});
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
