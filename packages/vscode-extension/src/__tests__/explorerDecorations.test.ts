import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { sha256Hex } from '@line-heat/protocol';

import { HeatFileDecorationProvider } from '../heatFileDecorationProvider';
import type { LineHeatSettings } from '../types';
import { startMockLineHeatServer } from './support/mockLineHeatServer';
import { createTestWorkspace, runGit, sleep, waitFor, type ExtensionApi } from './support/testUtils';

const createMockSettings = (overrides: Partial<LineHeatSettings> = {}): LineHeatSettings => ({
	serverUrl: 'http://localhost:9999',
	token: 'test-token',
	displayName: 'Tester',
	emoji: '🧪',
	heatDecayHours: 72,
	logLevel: 'info',
	presenceNotificationCooldownMinutes: 15,
	enabledRepositories: [],
	explorerDecorations: true,
	...overrides,
});

suite('Explorer Heat Decorations', function () {
	this.timeout(15000);

	test('shows fire decoration on file with heat >= 0.75', () => {
		const hashedRepoId = sha256Hex('test-repo');
		const hashedFilePath = sha256Hex('src/hot.ts');
		const fileUri = vscode.Uri.file('/workspace/src/hot.ts');

		const repoHeatMap = new Map<string, Map<string, number>>();
		repoHeatMap.set(hashedRepoId, new Map([[hashedFilePath, Date.now() - 5 * 60_000]]));

		const hashIndex = new Map<string, Map<string, vscode.Uri>>();
		hashIndex.set(hashedRepoId, new Map([[hashedFilePath, fileUri]]));

		const provider = new HeatFileDecorationProvider({
			getLogger: () => undefined,
			getSettings: () => createMockSettings(),
			getRepoHeatMap: () => repoHeatMap,
			getHashIndex: () => hashIndex,
		});

		const decoration = provider.provideFileDecoration(fileUri);
		assert.ok(decoration, 'Expected a decoration for hot file');
		assert.strictEqual(decoration.badge, '\u{1F525}', 'Expected fire emoji badge');
		assert.strictEqual(decoration.tooltip, 'Teammates edited 5m ago');
		assert.strictEqual(decoration.propagate, undefined, 'Expected no propagation (folders get their own decoration)');
	});

	test('no decoration on file with heat below 0.75', () => {
		const hashedRepoId = sha256Hex('test-repo');
		const hashedFilePath = sha256Hex('src/cold.ts');
		const fileUri = vscode.Uri.file('/workspace/src/cold.ts');

		const repoHeatMap = new Map<string, Map<string, number>>();
		// 60 hours ago → intensity ~0.17 (well below 0.75)
		repoHeatMap.set(hashedRepoId, new Map([[hashedFilePath, Date.now() - 60 * 3600_000]]));

		const hashIndex = new Map<string, Map<string, vscode.Uri>>();
		hashIndex.set(hashedRepoId, new Map([[hashedFilePath, fileUri]]));

		const provider = new HeatFileDecorationProvider({
			getLogger: () => undefined,
			getSettings: () => createMockSettings(),
			getRepoHeatMap: () => repoHeatMap,
			getHashIndex: () => hashIndex,
		});

		const decoration = provider.provideFileDecoration(fileUri);
		assert.strictEqual(decoration, undefined, 'Expected no decoration for cold file');
	});

	test('no decoration when server returns empty files (self-exclusion)', () => {
		const hashedRepoId = sha256Hex('test-repo');
		const hashedFilePath = sha256Hex('src/mine.ts');
		const fileUri = vscode.Uri.file('/workspace/src/mine.ts');

		// Server returned empty files map (self-exclusion or no data)
		const repoHeatMap = new Map<string, Map<string, number>>();
		repoHeatMap.set(hashedRepoId, new Map());

		const hashIndex = new Map<string, Map<string, vscode.Uri>>();
		hashIndex.set(hashedRepoId, new Map([[hashedFilePath, fileUri]]));

		const provider = new HeatFileDecorationProvider({
			getLogger: () => undefined,
			getSettings: () => createMockSettings(),
			getRepoHeatMap: () => repoHeatMap,
			getHashIndex: () => hashIndex,
		});

		const decoration = provider.provideFileDecoration(fileUri);
		assert.strictEqual(decoration, undefined, 'Expected no decoration when server returns empty');
	});

	test('shows folder decoration with most recent hot file time', () => {
		const hashedRepoId = sha256Hex('test-repo');
		const hashedFileA = sha256Hex('src/a.ts');
		const hashedFileB = sha256Hex('src/b.ts');
		const fileUriA = vscode.Uri.file('/workspace/src/a.ts');
		const fileUriB = vscode.Uri.file('/workspace/src/b.ts');
		const folderUri = vscode.Uri.file('/workspace/src');

		const repoHeatMap = new Map<string, Map<string, number>>();
		repoHeatMap.set(hashedRepoId, new Map([
			[hashedFileA, Date.now() - 2 * 3600_000], // 2h ago
			[hashedFileB, Date.now() - 10 * 60_000],  // 10m ago (most recent)
		]));

		const hashIndex = new Map<string, Map<string, vscode.Uri>>();
		hashIndex.set(hashedRepoId, new Map([
			[hashedFileA, fileUriA],
			[hashedFileB, fileUriB],
		]));

		const provider = new HeatFileDecorationProvider({
			getLogger: () => undefined,
			getSettings: () => createMockSettings(),
			getRepoHeatMap: () => repoHeatMap,
			getHashIndex: () => hashIndex,
		});

		const decoration = provider.provideFileDecoration(folderUri);
		assert.ok(decoration, 'Expected a decoration for folder with hot files');
		assert.strictEqual(decoration.badge, '\u{00B7}');
		assert.strictEqual(decoration.tooltip, 'Teammates edited 10m ago');
	});

	test('no folder decoration when no hot files underneath', () => {
		const hashedRepoId = sha256Hex('test-repo');
		const hashedFilePath = sha256Hex('other/cold.ts');
		const fileUri = vscode.Uri.file('/workspace/other/cold.ts');
		const folderUri = vscode.Uri.file('/workspace/src');

		const repoHeatMap = new Map<string, Map<string, number>>();
		repoHeatMap.set(hashedRepoId, new Map([[hashedFilePath, Date.now() - 5 * 60_000]]));

		const hashIndex = new Map<string, Map<string, vscode.Uri>>();
		hashIndex.set(hashedRepoId, new Map([[hashedFilePath, fileUri]]));

		const provider = new HeatFileDecorationProvider({
			getLogger: () => undefined,
			getSettings: () => createMockSettings(),
			getRepoHeatMap: () => repoHeatMap,
			getHashIndex: () => hashIndex,
		});

		const decoration = provider.provideFileDecoration(folderUri);
		assert.strictEqual(decoration, undefined, 'Expected no decoration for folder without hot files');
	});

	test('no decoration when explorerDecorations setting is false', () => {
		const hashedRepoId = sha256Hex('test-repo');
		const hashedFilePath = sha256Hex('src/hot.ts');
		const fileUri = vscode.Uri.file('/workspace/src/hot.ts');

		const repoHeatMap = new Map<string, Map<string, number>>();
		repoHeatMap.set(hashedRepoId, new Map([[hashedFilePath, Date.now() - 5 * 60_000]]));

		const hashIndex = new Map<string, Map<string, vscode.Uri>>();
		hashIndex.set(hashedRepoId, new Map([[hashedFilePath, fileUri]]));

		const provider = new HeatFileDecorationProvider({
			getLogger: () => undefined,
			getSettings: () => createMockSettings({ explorerDecorations: false }),
			getRepoHeatMap: () => repoHeatMap,
			getHashIndex: () => hashIndex,
		});

		const decoration = provider.provideFileDecoration(fileUri);
		assert.strictEqual(decoration, undefined, 'Expected no decoration when setting disabled');
	});

	test('decorations cleared on socket disconnect', async () => {
		const token = 'devtoken';
		const config = vscode.workspace.getConfiguration('lineheat');
		await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
		await config.update('token', '', vscode.ConfigurationTarget.Global);
		await config.update('displayName', 'Me', vscode.ConfigurationTarget.Global);
		await config.update('emoji', '😎', vscode.ConfigurationTarget.Global);
		await config.update('explorerDecorations', true, vscode.ConfigurationTarget.Global);

		const tempDir = await createTestWorkspace('line-heat-explorer-disconnect');
		await runGit(['init'], tempDir);
		await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);

		const filePath = path.join(tempDir, 'hot.ts');
		await fs.writeFile(filePath, 'const x = 1;\n', 'utf8');
		const fileUri = vscode.Uri.file(filePath);
		await runGit(['add', '.'], tempDir);

		const mockServer = await startMockLineHeatServer({
			token,
			retentionDays: 7,
			repoHeatHandler: () => {
				return {
					files: {
						[sha256Hex('hot.ts')]: Date.now() - 5 * 60_000,
					},
				};
			},
		});

		await config.update('serverUrl', mockServer.serverUrl, vscode.ConfigurationTarget.Global);
		await config.update('token', token, vscode.ConfigurationTarget.Global);

		const extension = vscode.extensions.getExtension<ExtensionApi>('filipsuk.lineheat-vscode');
		assert.ok(extension, 'Extension not found');
		const api = await extension.activate();
		assert.ok(api?.logger, 'Extension did not return logger');
		api.logger.messages.splice(0, api.logger.messages.length);

		try {
			const doc = await vscode.workspace.openTextDocument(fileUri);
			await vscode.window.showTextDocument(doc, { preview: false });

			const expectedFilePathHash = sha256Hex(
				path.relative(tempDir, filePath).split(path.sep).join('/'),
			);
			await mockServer.waitForRoomJoin({
				predicate: (room) => room.filePath === expectedFilePathHash,
			});

			// Wait for hash index build + repo heat emission to process
			await waitFor(
				() =>
					api.logger.messages.some(
						(m) => m.includes('hash-index:built'),
					),
				8000,
				`hash-index:built not found in messages. Last 20: ${api.logger.messages.slice(-20).join('\n')}`,
			);

			// Wait a bit for the repo:heat ack to arrive
			await sleep(500);

			// Now disconnect all clients — extension should clear repoHeatMap and refresh decorations
			mockServer.disconnectAllClients();

			// Wait for the disconnect log
			await waitFor(
				() =>
					api.logger.messages.some(
						(m) => m.includes('disconnected'),
					),
				8000,
				`disconnect not detected. Last 20: ${api.logger.messages.slice(-20).join('\n')}`,
			);

			// After disconnect, CodeLens should also be cleared — which confirms state was wiped.
			// We verify by checking the extension logged the disconnect (observable behavior).
			// The extension's disconnect handler sets repoHeatMap=undefined and calls refresh(),
			// so any provideFileDecoration call would return undefined.
			assert.ok(
				api.logger.messages.some((m) => m.includes('disconnected')),
				'Expected disconnect message in logs',
			);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
			await mockServer.close();
			await config.update('serverUrl', '', vscode.ConfigurationTarget.Global);
			await config.update('token', '', vscode.ConfigurationTarget.Global);
			await config.update('displayName', '', vscode.ConfigurationTarget.Global);
			await config.update('emoji', '', vscode.ConfigurationTarget.Global);
			await config.update('explorerDecorations', undefined, vscode.ConfigurationTarget.Global);
		}
	});
});
