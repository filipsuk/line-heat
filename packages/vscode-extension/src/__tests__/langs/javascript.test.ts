import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { resolveJavaScriptTestBlockFunctionInfo } from '../../langs/javascript/testBlocks';

suite('langs/javascript', function () {
	this.timeout(10000);

	test('resolves nested describe/it blocks', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-js-tests-'));
		try {
			const filePath = path.join(tempDir, 'sample.test.ts');
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
					"  });",
					"});",
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const info = resolveJavaScriptTestBlockFunctionInfo(new vscode.Position(4, 2), doc);
			assert.deepStrictEqual(info, {
				functionId:
					'User%20authentication/login%20functionality/should%20login%20with%20valid%20credentials',
				anchorLine: 3,
			});
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('resolves suite/test blocks', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-js-suite-'));
		try {
			const filePath = path.join(tempDir, 'sample.test.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					"suite('Alpha', () => {",
					"  suite('Beta', () => {",
					"    test('works', () => {",
					"      expect(1).toBe(1);",
					"    });",
					"  });",
					"});",
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const info = resolveJavaScriptTestBlockFunctionInfo(new vscode.Position(3, 2), doc);
			assert.deepStrictEqual(info, {
				functionId: 'Alpha/Beta/works',
				anchorLine: 3,
			});
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('does not falsely match .split(\'/\') as it(\'/\')', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-js-false-positive-'));
		try {
			const filePath = path.join(tempDir, 'not-a-test.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					"export const getHeatEmojiFromIntensity = (intensity: number) => {",
					"  const parts = 'a/b'.split('/');",
					"  return parts.join(',');",
					"};",
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);
			const info = resolveJavaScriptTestBlockFunctionInfo(new vscode.Position(1, 10), doc);
			assert.strictEqual(info, null);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
