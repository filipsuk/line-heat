import * as path from 'node:path';

import * as vscode from 'vscode';

import { encodeSymbolName } from '../../format';
import { type FunctionInfo } from '../../types';

const jsLanguageIds = new Set<string>([
	'javascript',
	'javascriptreact',
	'typescript',
	'typescriptreact',
]);

export const isJavaScriptLikeDocument = (document: vscode.TextDocument) => {
	if (jsLanguageIds.has(document.languageId)) {
		return true;
	}
	const ext = path.extname(document.uri.fsPath).toLowerCase();
	return ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx';
};

/**
 * JavaScript/TypeScript-specific fallback "block" detection for test files (describe/it/test).
 *
 * This does a lightweight text scan to synthesize a stable functionId for the current test case,
 * so presence/heat can still be attributed even when the language symbol provider doesn't expose
 * nested test blocks.
 */
export const resolveJavaScriptTestBlockFunctionInfo = (
	position: vscode.Position,
	document: vscode.TextDocument,
): FunctionInfo | null => {
	const maxLine = Math.min(position.line, document.lineCount - 1);
	const getCallName = (text: string, keyword: 'describe' | 'suite' | 'it' | 'test') => {
		// Word-boundary is critical here to avoid false positives like `.split('/')`.
		const match =
			keyword === 'describe'
				? text.match(/\bdescribe\s*\(\s*(["'])([^"']+)\1/)
				: keyword === 'suite'
					? text.match(/\bsuite\s*\(\s*(["'])([^"']+)\1/)
					: text.match(/\b(?:it|test)\s*\(\s*(["'])([^"']+)\1/);
		return match ? match[2] : undefined;
	};

	let testLine = -1;
	let testName: string | undefined;
	for (let lineIndex = maxLine; lineIndex >= 0; lineIndex -= 1) {
		const text = document.lineAt(lineIndex).text;
		const name = getCallName(text, 'it') ?? getCallName(text, 'test');
		if (name) {
			testLine = lineIndex;
			testName = name;
			break;
		}
	}
	if (!testName || testLine < 0) {
		return null;
	}

	const describeStack: Array<{ name: string; depth: number }> = [];
	let braceDepth = 0;
	for (let lineIndex = 0; lineIndex <= testLine; lineIndex += 1) {
		const text = document.lineAt(lineIndex).text;
		const name = getCallName(text, 'describe') ?? getCallName(text, 'suite');
		const openCount = (text.match(/{/g) ?? []).length;
		const closeCount = (text.match(/}/g) ?? []).length;
		const nextDepth = braceDepth + openCount - closeCount;
		if (name) {
			const depth = openCount > 0 ? nextDepth : braceDepth + 1;
			describeStack.push({ name, depth });
		}
		braceDepth = nextDepth;
		while (describeStack.length > 0 && describeStack[describeStack.length - 1].depth > braceDepth) {
			describeStack.pop();
		}
	}
	const describeNames = describeStack.map((entry) => entry.name);
	const segments = [...describeNames, testName].map((name) => encodeSymbolName(name));
	const anchorLine = position.line === testLine ? testLine : testLine + 1;
	return { functionId: segments.join('/'), anchorLine };
};
