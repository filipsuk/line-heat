import * as vscode from 'vscode';

import { encodeSymbolName } from './format';
import {
	isJavaScriptLikeDocument,
	resolveJavaScriptTestBlockFunctionInfo,
} from './langs/javascript/testBlocks';
import { type FunctionInfo, type FunctionSymbolEntry, type LineHeatLogger } from './types';

const documentSymbolCache = new Map<string, { version: number; symbols: vscode.DocumentSymbol[] }>();
const documentFunctionIndexCache = new Map<
	string,
	{ version: number; index: Map<string, FunctionSymbolEntry[]> }
>();

const documentSymbolDebounceTimers = new Map<string, NodeJS.Timeout>();
const symbolDebounceMs = 250;

/**
 * Symbol kinds that represent executable members.
 *
 * We treat these as "level-2" activity anchors when available.
 */
const functionSymbolKinds = new Set<vscode.SymbolKind>([
	vscode.SymbolKind.Function,
	vscode.SymbolKind.Method,
	vscode.SymbolKind.Constructor,
]);

/**
 * Symbol kinds that can start a new "block" scope.
 *
 * This is used only to detect whether a `Variable` is top-level (not nested inside another block),
 * so that `export const foo = () => {}` can serve as the level-2 activity anchor in non-class files.
 */
const blockSymbolKinds = new Set<vscode.SymbolKind>([...functionSymbolKinds, vscode.SymbolKind.Variable]);

/**
 * Activity attribution model: cap at two levels.
 *
 * Goal: when a user edits or moves their cursor inside deeply nested code (callbacks, nested functions,
 * anonymous lambdas, etc.), presence/heat should still be visible at a stable "parent" location.
 *
 * - Level 1 (container): `Class | Namespace | Module`
 * - Level 2 (member): `Method | Constructor | Function` (and in non-class files, a top-level `Variable`
 *   for patterns like `export const foo = () => {}`)
 *
 * Attribution rule:
 * - Prefer the smallest enclosing level-2 symbol.
 * - If none exists, use the smallest enclosing level-1 symbol.
 *
 * This logic is intentionally language-agnostic and uses only `DocumentSymbol` structure.
 */
const activityContainerSymbolKinds = new Set<vscode.SymbolKind>([
	vscode.SymbolKind.Class,
	vscode.SymbolKind.Namespace,
	vscode.SymbolKind.Module,
]);

/**
 * Returns true when a `Variable` symbol should be treated as a level-2 activity anchor.
 *
 * We only allow top-level variables so that nested const arrow functions do not become their own anchors.
 */
const isTopLevelVariableBlock = (symbol: vscode.DocumentSymbol, ancestors: vscode.DocumentSymbol[]) => {
	if (symbol.kind !== vscode.SymbolKind.Variable) {
		return false;
	}
	// Variable is a block only when it is not nested inside another block symbol.
	// This intentionally prevents nested const arrow functions from becoming their own activity blocks.
	return !ancestors.some((ancestor) => blockSymbolKinds.has(ancestor.kind));
};

/**
 * Returns true when the symbol represents a level-1 activity container.
 */
const isActivityContainerSymbol = (symbol: vscode.DocumentSymbol) =>
	activityContainerSymbolKinds.has(symbol.kind);

/**
 * Returns true when the symbol can be a level-2 activity anchor.
 *
 * `hasMemberAncestor` ensures we only ever pick the closest enclosing member, never a deeper one,
 * which effectively enforces the "maximum depth = 2" policy.
 */
const isActivityMemberSymbol = (
	symbol: vscode.DocumentSymbol,
	ancestors: vscode.DocumentSymbol[],
	hasMemberAncestor: boolean,
) => {
	if (hasMemberAncestor) {
		return false;
	}
	if (functionSymbolKinds.has(symbol.kind)) {
		return true;
	}
	if (symbol.kind === vscode.SymbolKind.Variable) {
		// Class members should attribute to the class/method level, not to a Variable symbol.
		if (ancestors.some((ancestor) => ancestor.kind === vscode.SymbolKind.Class)) {
			return false;
		}
		return isTopLevelVariableBlock(symbol, ancestors);
	}
	return false;
};

const containerSymbolKinds = new Set<vscode.SymbolKind>([
	vscode.SymbolKind.Class,
	vscode.SymbolKind.Namespace,
	vscode.SymbolKind.Module,
	vscode.SymbolKind.Function,
	vscode.SymbolKind.Variable,
]);

const isMeaningfulSymbolName = (name: string) => {
	const trimmed = name.trim();
	if (!trimmed) {
		return false;
	}
	// Some providers can return spurious symbols with name "/" which causes functionId "%2F".
	// These don't represent a meaningful code block and should never be used for presence/heat.
	return trimmed !== '/';
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
		.filter((ancestor) => containerSymbolKinds.has(ancestor.kind) && isMeaningfulSymbolName(ancestor.name))
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
		documentSymbolCache.set(cacheKey, { version: document.version, symbols });
		return symbols;
	} catch {
		documentSymbolCache.set(cacheKey, { version: document.version, symbols: [] });
		return [];
	}
};

/**
 * Resolves the activity anchor for a position using the 2-level attribution model.
 *
 * We collect all enclosing activity symbols and choose:
 * - the smallest enclosing level-2 member symbol, if present
 * - otherwise the smallest enclosing level-1 container symbol
 *
 * Selection rule within each group:
 * - choose the smallest enclosing `symbol.range` that contains the position
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
	/**
	 * Some symbol providers report member symbols with a `range` that covers only the header/identifier
	 * (not the full body/initializer). If we use `range.contains(position)` strictly, presence/heat can
	 * become "lost" when the user is inside the body.
	 *
	 * For level-2 member symbols we fall back to treating the symbol as spanning from its
	 * `selectionRange.start.line` until the next sibling's `selectionRange.start.line` (or the end of
	 * the current list).
	 */
	const getVariableMemberFallbackEndLineExclusive = (
		symbol: vscode.DocumentSymbol,
		nextSiblingStartLine: number | undefined,
		listEndLineExclusive: number,
	) => {
		const startLine = symbol.selectionRange.start.line;
		const endLineExclusive = nextSiblingStartLine ?? listEndLineExclusive;
		// Ensure we never produce an empty/negative range.
		return Math.max(startLine + 1, endLineExclusive);
	};

	let bestMember:
		| {
			functionId: string;
			anchorLine: number;
			length: number;
			depth: number;
			order: number;
		}
		| undefined;
	let bestContainer:
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

	const consider = (
		current:
			| {
				functionId: string;
				anchorLine: number;
				length: number;
				depth: number;
				order: number;
			}
			| undefined,
		candidate: {
			functionId: string;
			anchorLine: number;
			length: number;
			depth: number;
			order: number;
		},
	) => {
		if (!current) {
			return candidate;
		}
		if (candidate.length < current.length) {
			return candidate;
		}
		if (candidate.length === current.length && candidate.depth > current.depth) {
			return candidate;
		}
		if (
			candidate.length === current.length &&
			candidate.depth === current.depth &&
			candidate.order < current.order
		) {
			return candidate;
		}
		return current;
	};

	const visitList = (
		list: vscode.DocumentSymbol[],
		ancestors: vscode.DocumentSymbol[],
		hasMemberAncestor: boolean,
		listEndLineExclusive: number,
	) => {
		for (let i = 0; i < list.length; i += 1) {
			const symbol = list[i];
			const nextSiblingStartLine = list[i + 1]?.selectionRange.start.line;
			visitSymbol(symbol, ancestors, hasMemberAncestor, nextSiblingStartLine, listEndLineExclusive);
		}
	};

	const visitSymbol = (
		symbol: vscode.DocumentSymbol,
		ancestors: vscode.DocumentSymbol[],
		hasMemberAncestor: boolean,
		nextSiblingStartLine: number | undefined,
		listEndLineExclusive: number,
	) => {
		const currentOrder = order;
		order += 1;
		const isMember = isActivityMemberSymbol(symbol, ancestors, hasMemberAncestor);
		const isContainer = isActivityContainerSymbol(symbol);
		const hasMeaningfulName = isMeaningfulSymbolName(symbol.name);
		const nextAncestors = [...ancestors, symbol];
		const nextHasMemberAncestor = hasMemberAncestor || isMember;

		let containsPosition = symbol.range.contains(position);
		let length = symbol.range.end.line - symbol.range.start.line;
		if (!containsPosition && isMember) {
			const endLineExclusive = getVariableMemberFallbackEndLineExclusive(
				symbol,
				nextSiblingStartLine,
				listEndLineExclusive,
			);
			containsPosition =
				position.line >= symbol.selectionRange.start.line && position.line < endLineExclusive;
			length = endLineExclusive - symbol.selectionRange.start.line;
		}

		if ((isMember || isContainer) && hasMeaningfulName && containsPosition) {
			const depth = ancestors.length;
			const functionId = buildFunctionId(ancestors, symbol);
			const anchorLine = symbol.selectionRange.start.line + 1;
			const candidate = { functionId, anchorLine, length, depth, order: currentOrder };
			if (isMember) {
				bestMember = consider(bestMember, candidate);
			} else {
				bestContainer = consider(bestContainer, candidate);
			}
		}
		visitList(symbol.children, nextAncestors, nextHasMemberAncestor, symbol.range.end.line + 1);
	};
	visitList(symbols, [], false, document.lineCount);
	const best = bestMember ?? bestContainer;
	if (!best) {
		return null;
	}
	return { functionId: best.functionId, anchorLine: best.anchorLine };
};

/**
 * Resolves function/block info for a position.
 *
 * Priority order:
 * 1) Language-agnostic symbol resolution.
 * 2) Language-specific fallbacks (last resort).
 */
export const resolveFunctionInfo = (
	symbols: vscode.DocumentSymbol[],
	position: vscode.Position,
	document: vscode.TextDocument,
	logger?: LineHeatLogger,
): FunctionInfo | null => {
	const symbolInfo = resolveFunctionInfoFromSymbols(symbols, position, document, logger);
	if (symbolInfo && symbolInfo.functionId !== '%2F') {
		return symbolInfo;
	}
	if (isJavaScriptLikeDocument(document)) {
		const testInfo = resolveJavaScriptTestBlockFunctionInfo(position, document);
		if (testInfo) {
			return testInfo;
		}
	}
	return symbolInfo;
};

/**
 * Builds an index of activity anchors in a document keyed by functionId.
 *
 * This index is used for CodeLens placement. Multiple entries can share the same functionId
 * (e.g. duplicates); `resolveFunctionSymbolEntry` uses anchorLine proximity to pick the best match.
 */
const buildDocumentFunctionIndex = (symbols: vscode.DocumentSymbol[]) => {
	const index = new Map<string, FunctionSymbolEntry[]>();
	const visit = (
		symbol: vscode.DocumentSymbol,
		ancestors: vscode.DocumentSymbol[],
		hasMemberAncestor: boolean,
	) => {
		const isMember = isActivityMemberSymbol(symbol, ancestors, hasMemberAncestor);
		const isContainer = isActivityContainerSymbol(symbol);
		if ((isContainer || isMember) && isMeaningfulSymbolName(symbol.name)) {
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
		const nextHasMemberAncestor = hasMemberAncestor || isMember;
		for (const child of symbol.children) {
			visit(child, nextAncestors, nextHasMemberAncestor);
		}
	};
	for (const symbol of symbols) {
		visit(symbol, [], false);
	}
	return index;
};

/**
 * Returns (and caches) the document's activity-anchor index.
 */
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

/**
 * Picks the best matching entry for a functionId when the index contains duplicates.
 *
 * We use anchorLine proximity because symbols can be duplicated (same name) and the server payload
 * includes both functionId and anchorLine.
 */
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
