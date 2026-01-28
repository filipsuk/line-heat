import * as vscode from 'vscode';

import { encodeSymbolName } from './format';
import { type FunctionInfo, type FunctionSymbolEntry, type LineHeatLogger } from './types';

const documentSymbolCache = new Map<string, { version: number; symbols: vscode.DocumentSymbol[] }>();
const documentFunctionIndexCache = new Map<
	string,
	{ version: number; index: Map<string, FunctionSymbolEntry[]> }
>();

const documentSymbolDebounceTimers = new Map<string, NodeJS.Timeout>();
const symbolDebounceMs = 250;

const functionSymbolKinds = new Set<vscode.SymbolKind>([
	vscode.SymbolKind.Function,
	vscode.SymbolKind.Method,
	vscode.SymbolKind.Constructor,
]);

const blockSymbolKinds = new Set<vscode.SymbolKind>([
	...functionSymbolKinds,
	vscode.SymbolKind.Variable,
]);

const containerSymbolKinds = new Set<vscode.SymbolKind>([
	vscode.SymbolKind.Class,
	vscode.SymbolKind.Namespace,
	vscode.SymbolKind.Module,
	vscode.SymbolKind.Function,
	vscode.SymbolKind.Variable,
]);

/**
 * Returns whether a DocumentSymbol should be treated as a "block" for LineHeat.
 *
 * Basic rules:
 * - `Function|Method|Constructor` are always blocks.
 * - `Variable` is a block only when it is not nested inside another block.
 *
 * This is intentionally language-agnostic: it uses only `SymbolKind` + nesting depth
 * (no parsing or source-text heuristics).
 */
const isBlockSymbol = (
	symbol: vscode.DocumentSymbol,
	ancestors: vscode.DocumentSymbol[] = [],
): boolean => {
	if (functionSymbolKinds.has(symbol.kind)) {
		return true;
	}

	if (symbol.kind === vscode.SymbolKind.Variable) {
		return !ancestors.some((ancestor) => blockSymbolKinds.has(ancestor.kind));
	}

	return false;
};

/**
 * Builds a stable function/block identifier string for a symbol.
 *
 * The ID is a slash-separated path of URI-escaped name segments.
 * The container path includes only selected symbol kinds (classes/namespaces/modules
 * and other blocks), so nested symbols become `Outer/Inner`.
 */
const buildFunctionId = (ancestors: vscode.DocumentSymbol[], symbol: vscode.DocumentSymbol) => {
	const containerSegments = ancestors
		.filter((ancestor) => containerSymbolKinds.has(ancestor.kind))
		.map((ancestor) => encodeSymbolName(ancestor.name));
	const functionName = encodeSymbolName(symbol.name);
	return containerSegments.length > 0
		? `${containerSegments.join('/')}/${functionName}`
		: functionName;
};

const isDocumentSymbol = (
	symbol: vscode.DocumentSymbol | vscode.SymbolInformation,
): symbol is vscode.DocumentSymbol => 'selectionRange' in symbol;

const convertToDocumentSymbol = (symbol: vscode.SymbolInformation): vscode.DocumentSymbol => ({
	name: symbol.name,
	detail: '',
	kind: symbol.kind,
	selectionRange: symbol.location.range,
	range: new vscode.Range(
		new vscode.Position(symbol.location.range.start.line, 0),
		symbol.location.range.end,
	),
	children: [],
});

/**
 * Returns (and caches) DocumentSymbols for a document.
 *
 * We rely on VS Code's built-in document symbol providers (language-dependent).
 * Results are cached per document version, with a debounce to avoid thrashing
 * while the user is actively editing.
 */
export const getDocumentSymbols = async (document: vscode.TextDocument, logger?: LineHeatLogger) => {
	const cacheKey = document.uri.toString();
	const cached = documentSymbolCache.get(cacheKey);
	if (cached && cached.version === document.version) {
		return cached.symbols;
	}

	const existingTimer = documentSymbolDebounceTimers.get(cacheKey);
	if (existingTimer) {
		clearTimeout(existingTimer);
	}

	if (cached) {
		documentSymbolDebounceTimers.set(
			cacheKey,
			setTimeout(async () => {
				documentSymbolDebounceTimers.delete(cacheKey);
				try {
					const results = await vscode.commands.executeCommand<
						(vscode.DocumentSymbol | vscode.SymbolInformation)[]
					>('vscode.executeDocumentSymbolProvider', document.uri);
					const symbols = (results ?? []).map((symbol) =>
						isDocumentSymbol(symbol) ? symbol : convertToDocumentSymbol(symbol),
					);
					documentSymbolCache.set(cacheKey, { version: document.version, symbols });
					if (logger) {
						logger.debug(
							`lineheat: symbols:refreshed document=${cacheKey} version=${document.version}`,
						);
					}
				} catch {
					documentSymbolCache.set(cacheKey, { version: document.version, symbols: [] });
				}
			}, symbolDebounceMs),
		);
		return cached.symbols;
	}

	try {
		const results = await vscode.commands.executeCommand<
			(vscode.DocumentSymbol | vscode.SymbolInformation)[]
		>('vscode.executeDocumentSymbolProvider', document.uri);
		const symbols = (results ?? []).map((symbol) =>
			isDocumentSymbol(symbol) ? symbol : convertToDocumentSymbol(symbol),
		);
		if (logger && document.uri.fsPath.includes('standalone.ts')) {
			logger.debug(
				`standalone.ts: raw results=${results?.length ?? 0}, final symbols=${symbols.length}`,
			);
			for (let i = 0; i < symbols.length; i++) {
				const symbol = symbols[i];
				logger.debug(
					`standalone.ts: symbol ${i}: name=${symbol.name}, kind=${symbol.kind}, range=${symbol.range.start.line}:${symbol.range.start.character}-${symbol.range.end.line}:${symbol.range.end.character}, selectionRange=${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}-${symbol.selectionRange.end.line}:${symbol.selectionRange.end.character}`,
				);
			}
		}
		documentSymbolCache.set(cacheKey, { version: document.version, symbols });
		return symbols;
	} catch {
		documentSymbolCache.set(cacheKey, { version: document.version, symbols: [] });
		return [];
	}
};

/**
 * Resolves the most specific enclosing block at the given position.
 *
 * Selection rule:
 * - choose the smallest enclosing symbol range that contains the position
 * - tie-break by deeper nesting, then earlier document order
 *
 * Returns a functionId plus an anchorLine (1-based) used to disambiguate duplicates.
 */
const resolveFunctionInfoFromSymbols = (
	symbols: vscode.DocumentSymbol[],
	position: vscode.Position,
	document: vscode.TextDocument,
	logger?: LineHeatLogger,
): FunctionInfo | null => {
	let best:
		| {
			functionId: string;
			anchorLine: number;
			length: number;
			depth: number;
			order: number;
		}
		| undefined;
	let order = 0;

	if (logger && document.uri.fsPath.includes('standalone.ts')) {
		logger.debug(`standalone.ts: resolveFunctionInfo position=${position.line}:${position.character}`);
		logger.debug(`standalone.ts: resolveFunctionInfo symbols count=${symbols.length}`);
	}

	const visit = (symbol: vscode.DocumentSymbol, ancestors: vscode.DocumentSymbol[]) => {
		const currentOrder = order;
		order += 1;
		const nextAncestors = [...ancestors, symbol];
		if (isBlockSymbol(symbol, ancestors) && symbol.range.contains(position)) {
			const length = symbol.range.end.line - symbol.range.start.line;
			const depth = ancestors.length;
			const functionId = buildFunctionId(ancestors, symbol);
			const anchorLine = symbol.selectionRange.start.line + 1;
			const candidate = { functionId, anchorLine, length, depth, order: currentOrder };
			if (!best) {
				best = candidate;
			} else if (candidate.length < best.length) {
				best = candidate;
			} else if (candidate.length === best.length && candidate.depth > best.depth) {
				best = candidate;
			} else if (
				candidate.length === best.length &&
				candidate.depth === best.depth &&
				candidate.order < best.order
			) {
				best = candidate;
			}
		}
		for (const child of symbol.children) {
			visit(child, nextAncestors);
		}
	};
	for (const symbol of symbols) {
		visit(symbol, []);
	}
	for (const symbol of symbols) {
		visit(symbol, []);
	}
	if (!best) {
		return null;
	}
	return { functionId: best.functionId, anchorLine: best.anchorLine };
};

/**
 * Fallback "block" detection for test files (describe/it/test).
 *
 * This does a lightweight text scan to synthesize a stable functionId for the
 * current test case, so edits/presence can still be attributed even when the
 * language symbol provider doesn't expose nested test blocks.
 */
const resolveFunctionInfoFromTestBlocks = (
	position: vscode.Position,
	document: vscode.TextDocument,
): FunctionInfo | null => {
	const maxLine = Math.min(position.line, document.lineCount - 1);
	const getCallName = (text: string, keyword: 'describe' | 'it' | 'test') => {
		const match =
			keyword === 'describe'
				? text.match(/describe\s*\(\s*(["'])([^"']+)\1/)
				: text.match(/(?:it|test)\s*\(\s*(["'])([^"']+)\1/);
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
		const name = getCallName(text, 'describe');
		const openCount = (text.match(/{/g) ?? []).length;
		const closeCount = (text.match(/}/g) ?? []).length;
		const nextDepth = braceDepth + openCount - closeCount;
		if (name) {
			const depth = openCount > 0 ? nextDepth : braceDepth + 1;
			describeStack.push({ name, depth });
		}
		braceDepth = nextDepth;
		while (
			describeStack.length > 0 &&
			describeStack[describeStack.length - 1].depth > braceDepth
		) {
			describeStack.pop();
		}
	}
	const describeNames = describeStack.map((entry) => entry.name);
	const segments = [...describeNames, testName].map((name) => encodeSymbolName(name));
	const anchorLine = position.line === testLine ? testLine : testLine + 1;
	return { functionId: segments.join('/'), anchorLine };
};

/**
 * Resolves function/block info for a position.
 *
 * If the document looks like a test file and a test block can be determined,
 * that takes precedence; otherwise fall back to symbol-based resolution.
 */
export const resolveFunctionInfo = (
	symbols: vscode.DocumentSymbol[],
	position: vscode.Position,
	document: vscode.TextDocument,
	logger?: LineHeatLogger,
): FunctionInfo | null => {
	const symbolInfo = resolveFunctionInfoFromSymbols(symbols, position, document, logger);
	const testInfo = resolveFunctionInfoFromTestBlocks(position, document);
	if (testInfo) {
		return testInfo;
	}
	return symbolInfo;
};

/**
 * Builds an index of all blocks in a document keyed by functionId.
 *
 * Multiple entries can share the same functionId (e.g. duplicate symbol names);
 * we use anchorLine proximity later to pick the best match for CodeLens.
 */
const buildDocumentFunctionIndex = (symbols: vscode.DocumentSymbol[]) => {
	const index = new Map<string, FunctionSymbolEntry[]>();
	const visit = (symbol: vscode.DocumentSymbol, ancestors: vscode.DocumentSymbol[]) => {
		if (isBlockSymbol(symbol, ancestors)) {
			const functionId = buildFunctionId(ancestors, symbol);
			const entry = {
				functionId,
				anchorLine: symbol.selectionRange.start.line + 1,
				range: symbol.range,
			};
			const list = index.get(functionId) ?? [];
			list.push(entry);
			index.set(functionId, list);
		}
		const nextAncestors = [...ancestors, symbol];
		for (const child of symbol.children) {
			visit(child, nextAncestors);
		}
	};
	for (const symbol of symbols) {
		visit(symbol, []);
	}
	return index;
};

export const getDocumentFunctionIndex = async (document: vscode.TextDocument, logger?: LineHeatLogger) => {
	const cacheKey = document.uri.toString();
	const cached = documentFunctionIndexCache.get(cacheKey);
	if (cached && cached.version === document.version) {
		return cached.index;
	}
	const symbols = await getDocumentSymbols(document, logger);
	const index = buildDocumentFunctionIndex(symbols);
	documentFunctionIndexCache.set(cacheKey, { version: document.version, index });
	return index;
};

export const resolveFunctionSymbolEntry = (
	index: Map<string, FunctionSymbolEntry[]>,
	functionId: string,
	anchorLine: number,
) => {
	const entries = index.get(functionId);
	if (!entries || entries.length === 0) {
		return undefined;
	}
	if (entries.length === 1) {
		return entries[0];
	}
	let best = entries[0];
	let bestDistance = Math.abs(entries[0].anchorLine - anchorLine);
	for (const entry of entries.slice(1)) {
		const distance = Math.abs(entry.anchorLine - anchorLine);
		if (distance < bestDistance) {
			best = entry;
			bestDistance = distance;
		}
	}
	return best;
};

export const resetSymbolState = () => {
	for (const timer of documentSymbolDebounceTimers.values()) {
		clearTimeout(timer);
	}
	documentSymbolDebounceTimers.clear();
	documentSymbolCache.clear();
	documentFunctionIndexCache.clear();
};
