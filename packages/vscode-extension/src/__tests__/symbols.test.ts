import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { resolveFunctionInfo } from '../symbols';

suite('symbols (core)', function () {
	this.timeout(10000);

	test('treats exported const variable as containing its body when symbol range is too small', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-synthetic-symbol-'));
		try {
			const filePath = path.join(tempDir, 'exported-const.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					'export const formatRelativeTime = (now: number, timestamp: number) => {',
					'  // inside body',
					'};',
					'',
					'export const other = () => 1;',
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);

			const symbols: vscode.DocumentSymbol[] = [
				new vscode.DocumentSymbol(
					'formatRelativeTime',
					'',
					vscode.SymbolKind.Variable,
					// Deliberately too-small range (identifier only): does NOT include the function body.
					new vscode.Range(new vscode.Position(0, 13), new vscode.Position(0, 29)),
					new vscode.Range(new vscode.Position(0, 13), new vscode.Position(0, 29)),
				),
			];

			const info = resolveFunctionInfo(symbols, new vscode.Position(1, 2), doc);
			assert.deepStrictEqual(info, { functionId: 'formatRelativeTime', anchorLine: 1 });
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('treats exported const arrow as containing its body when provider reports a function symbol with header-only range', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-synthetic-symbol-fn-'));
		try {
			const filePath = path.join(tempDir, 'exported-const-someFunc.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					"export const someFunc = (intensity: number) => {",
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
					"};",
					"",
					"export const other = () => 1;",
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);

			const symbols: vscode.DocumentSymbol[] = [
				new vscode.DocumentSymbol(
					'someFunc',
					'',
					vscode.SymbolKind.Function,
					// Deliberately header-only range: does NOT include the function body.
					new vscode.Range(new vscode.Position(0, 13), new vscode.Position(0, 20)),
					new vscode.Range(new vscode.Position(0, 13), new vscode.Position(0, 20)),
				),
			];

			const info = resolveFunctionInfo(symbols, new vscode.Position(5, 2), doc);
			assert.deepStrictEqual(info, { functionId: 'someFunc', anchorLine: 1 });
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

});
