import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { resolveFunctionInfo } from '../../symbols';

suite('langs/javascript', function () {
	this.timeout(10000);

	test('attributes nested callback edits to outermost function (level-2 rule)', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-js-callback-'));
		try {
			const filePath = path.join(tempDir, 'sample.test.ts');
			const fileUri = vscode.Uri.file(filePath);
			// File content: one wrapping suite() with two test() blocks
			await fs.writeFile(
				filePath,
				[
					"suite('MySuite', function() {",
					"  test('first test', function() {",
					"    expect(1).toBe(1);",
					"  });",
					"  test('second test', function() {",
					"    expect(2).toBe(2);",
					"  });",
					"});",
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);

			// Simulate what VS Code's symbol provider would return for callback structures.
			// The outer suite callback is a Function (level-2 member).
			// Nested test callbacks are children but NOT level-2 members (depth > 2).
			// Activity is attributed to the outermost function (suite).
			const suiteSymbol = new vscode.DocumentSymbol(
				'MySuite',
				'',
				vscode.SymbolKind.Function,
				new vscode.Range(new vscode.Position(0, 0), new vscode.Position(7, 2)),
				new vscode.Range(new vscode.Position(0, 7), new vscode.Position(0, 16)),
			);
			const test1Symbol = new vscode.DocumentSymbol(
				'first test',
				'',
				vscode.SymbolKind.Function,
				new vscode.Range(new vscode.Position(1, 2), new vscode.Position(3, 4)),
				new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 20)),
			);
			const test2Symbol = new vscode.DocumentSymbol(
				'second test',
				'',
				vscode.SymbolKind.Function,
				new vscode.Range(new vscode.Position(4, 2), new vscode.Position(6, 4)),
				new vscode.Range(new vscode.Position(4, 8), new vscode.Position(4, 21)),
			);
			suiteSymbol.children = [test1Symbol, test2Symbol];
			const symbols = [suiteSymbol];

			// Cursor inside first test (line 2: "expect(1).toBe(1);")
			// Attributed to MySuite (the outermost level-2 function)
			const info1 = resolveFunctionInfo(symbols, new vscode.Position(2, 4), doc);
			assert.deepStrictEqual(info1, {
				functionId: 'MySuite',
				anchorLine: 1,
			});

			// Cursor inside second test (line 5: "expect(2).toBe(2);")
			// Also attributed to MySuite
			const info2 = resolveFunctionInfo(symbols, new vscode.Position(5, 4), doc);
			assert.deepStrictEqual(info2, {
				functionId: 'MySuite',
				anchorLine: 1,
			});

			// Cursor in suite declaration line
			const infoSuite = resolveFunctionInfo(symbols, new vscode.Position(0, 10), doc);
			assert.deepStrictEqual(infoSuite, {
				functionId: 'MySuite',
				anchorLine: 1,
			});
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test('attributes deep callback edits to outermost function', async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-js-depth-'));
		try {
			const filePath = path.join(tempDir, 'deep.test.ts');
			const fileUri = vscode.Uri.file(filePath);
			await fs.writeFile(
				filePath,
				[
					"suite('Outer', function() {",
					"  suite('Middle', function() {",
					"    test('Inner', function() {",
					"      // deep code",
					"    });",
					"  });",
					"});",
				].join('\n'),
				'utf8',
			);

			const doc = await vscode.workspace.openTextDocument(fileUri);

			// Three levels of nested callbacks - only Outer is level-2
			const outerSymbol = new vscode.DocumentSymbol(
				'Outer',
				'',
				vscode.SymbolKind.Function,
				new vscode.Range(new vscode.Position(0, 0), new vscode.Position(6, 2)),
				new vscode.Range(new vscode.Position(0, 7), new vscode.Position(0, 13)),
			);
			const middleSymbol = new vscode.DocumentSymbol(
				'Middle',
				'',
				vscode.SymbolKind.Function,
				new vscode.Range(new vscode.Position(1, 2), new vscode.Position(5, 4)),
				new vscode.Range(new vscode.Position(1, 9), new vscode.Position(1, 17)),
			);
			const innerSymbol = new vscode.DocumentSymbol(
				'Inner',
				'',
				vscode.SymbolKind.Function,
				new vscode.Range(new vscode.Position(2, 4), new vscode.Position(4, 6)),
				new vscode.Range(new vscode.Position(2, 10), new vscode.Position(2, 17)),
			);
			middleSymbol.children = [innerSymbol];
			outerSymbol.children = [middleSymbol];
			const symbols = [outerSymbol];

			// Cursor inside innermost test (line 3: "// deep code")
			// Attributed to Outer (the outermost level-2 function)
			const info = resolveFunctionInfo(symbols, new vscode.Position(3, 6), doc);
			assert.deepStrictEqual(info, {
				functionId: 'Outer',
				anchorLine: 1,
			});
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
