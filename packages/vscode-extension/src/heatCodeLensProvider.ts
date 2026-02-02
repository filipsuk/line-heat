import * as vscode from 'vscode';

import {
	computeHeatIntensity,
	formatRelativeTime,
	formatTopLabels,
	formatUserLabel,
	getHeatEmojiFromIntensity,
} from './format';
import {
	type LineHeatLogger,
	type LineHeatSettings,
	type RoomState,
	type FunctionSymbolEntry,
} from './types';
import { getDocumentFunctionIndex } from './symbols';
import { resolveRepoContext } from './repo';

type HeatCodeLensProviderDeps = {
	getLogger: () => LineHeatLogger | undefined;
	getSettings: () => LineHeatSettings | undefined;
	getUserId: () => string | undefined;
	getHasher: () => ((value: string) => string) | undefined;
	getRoomState: (roomKey: string) => RoomState | undefined;
};

export class HeatCodeLensProvider implements vscode.CodeLensProvider {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses = this.onDidChangeEmitter.event;
	private readonly deps: HeatCodeLensProviderDeps;

	public constructor(deps?: HeatCodeLensProviderDeps) {
		if (!deps) {
			throw new Error('HeatCodeLensProvider deps required');
		}
		this.deps = deps;
	}

	refresh() {
		this.onDidChangeEmitter.fire();
	}

	async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
		const logger = this.deps.getLogger();
		if (!logger) {
			return [];
		}
		if (document.uri.scheme !== 'file') {
			return [];
		}
		const repoContext = await resolveRepoContext(document.uri.fsPath, logger);
		if (!repoContext) {
			return [];
		}
		const roomKey = `${repoContext.repoId}:${repoContext.filePath}`;
		const roomState = this.deps.getRoomState(roomKey);
		if (!roomState) {
			return [];
		}
		const index = await getDocumentFunctionIndex(document, logger);
		if (index.size === 0) {
			return [];
		}
		const decayHours = this.deps.getSettings()?.heatDecayHours ?? 24;
		const decayMs = decayHours > 0 ? decayHours * 60 * 60 * 1000 : 0;
		if (decayMs <= 0) {
			return [];
		}
		const hashValue = this.deps.getHasher();
		if (!hashValue) {
			return [];
		}
		const now = Date.now();
		const selfUserId = this.deps.getUserId();

		const lenses: vscode.CodeLens[] = [];
		const entriesByHash = new Map<string, FunctionSymbolEntry[]>();
		for (const [functionId, entries] of index.entries()) {
			const functionIdHash = hashValue(functionId);
			const list = entriesByHash.get(functionIdHash) ?? [];
			list.push(...entries);
			entriesByHash.set(functionIdHash, list);
		}
		const functionIdHashes = new Set<string>([
			...roomState.heatByFunctionId.keys(),
			...roomState.presenceByFunctionId.keys(),
		]);
		for (const functionIdHash of functionIdHashes) {
			const heat = roomState.heatByFunctionId.get(functionIdHash);
			const presence = roomState.presenceByFunctionId.get(functionIdHash);
			const anchorLine = heat?.anchorLine ?? presence?.anchorLine;
			if (!anchorLine) {
				continue;
			}
			const entries = entriesByHash.get(functionIdHash);
			if (!entries || entries.length === 0) {
				continue;
			}
			const [firstEntry, ...restEntries] = entries;
			if (!firstEntry) {
				continue;
			}
			let entry = firstEntry;
			let bestDistance = Math.abs(firstEntry.anchorLine - anchorLine);
			for (const candidate of restEntries) {
				const distance = Math.abs(candidate.anchorLine - anchorLine);
				if (distance < bestDistance) {
					entry = candidate;
					bestDistance = distance;
				}
			}

			let heatEmoji: string | undefined;
			let heatAge: string | undefined;
			const heatEditorsAll = (heat?.topEditors ?? [])
				.filter(
					(editorEntry) =>
						decayMs > 0 &&
						now - editorEntry.lastEditAt <= decayMs &&
						editorEntry.userId !== selfUserId,
				)
				.map(formatUserLabel);
			const heatEditorsText = formatTopLabels(heatEditorsAll, 3);
			
			// Compute the most recent non-self edit timestamp for age preservation
			const heatEditorsNonSelf = (heat?.topEditors ?? [])
				.filter(
					(editorEntry) =>
						decayMs > 0 &&
						now - editorEntry.lastEditAt <= decayMs &&
						editorEntry.userId !== selfUserId,
				);
			const lastNonSelfEditAt = heatEditorsNonSelf.length > 0 
				? Math.max(...heatEditorsNonSelf.map(editor => editor.lastEditAt))
				: undefined;
			
			if (heat && decayMs > 0 && heatEditorsText) {
				const ageTimestamp = lastNonSelfEditAt ?? heat.lastEditAt;
				const intensity = computeHeatIntensity(now, ageTimestamp, decayMs);
				if (intensity > 0) {
					heatEmoji = getHeatEmojiFromIntensity(intensity);
					heatAge = formatRelativeTime(now, ageTimestamp);
				}
			}

			const presenceUsersAll = (presence?.users ?? [])
				.filter((presenceUser) => presenceUser.userId !== selfUserId)
				.map(formatUserLabel);
			const presenceText = formatTopLabels(presenceUsersAll, 3);

			if (!heatEmoji && !presenceText) {
				continue;
			}

			const titleParts: string[] = [];
			if (heatEmoji && heatAge) {
				titleParts.push(`${heatEmoji} ${heatAge}`, `edit: ${heatEditorsText}`);
			}
			if (presenceText) {
				titleParts.push(`live: ${presenceText}`);
			}
			const title = titleParts.join(' · ');

			const tooltipParts: string[] = [];
			if (heatEmoji && heatAge) {
				tooltipParts.push(`Last edit: ${heatAge}`, `Editors: ${heatEditorsText}`);
			}
			if (presenceText) {
				tooltipParts.push(`Live: ${presenceText}`);
			}

			const line = Math.max(0, entry.anchorLine - 1);
			const range = new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, 0));
			lenses.push(
				new vscode.CodeLens(range, {
					title,
					command: '',
					tooltip: tooltipParts.join('\n'),
				}),
			);
		}
		return lenses;
	}
}
