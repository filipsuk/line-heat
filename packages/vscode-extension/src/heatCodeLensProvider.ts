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
} from './types';
import { getDocumentFunctionIndex, resolveFunctionSymbolEntry } from './symbols';
import { resolveRepoContext } from './repo';

export type ActivityLensData = {
	functionId: string;
	lastEditAt?: number;
	editors: string[];
	presence: string[];
};

type HeatCodeLensProviderDeps = {
	getLogger: () => LineHeatLogger | undefined;
	getSettings: () => LineHeatSettings | undefined;
	getUserId: () => string | undefined;
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
		const now = Date.now();
		const selfUserId = this.deps.getUserId();

		const lenses: vscode.CodeLens[] = [];
		const functionIds = new Set<string>([
			...roomState.heatByFunctionId.keys(),
			...roomState.presenceByFunctionId.keys(),
		]);
		for (const functionId of functionIds) {
			const heat = roomState.heatByFunctionId.get(functionId);
			const presence = roomState.presenceByFunctionId.get(functionId);
			const anchorLine = heat?.anchorLine ?? presence?.anchorLine;
			if (!anchorLine) {
				continue;
			}
			const entry = resolveFunctionSymbolEntry(index, functionId, anchorLine);
			if (!entry) {
				continue;
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
			if (heat && decayMs > 0 && heatEditorsText) {
				const intensity = computeHeatIntensity(now, heat.lastEditAt, decayMs);
				if (intensity > 0) {
					heatEmoji = getHeatEmojiFromIntensity(intensity);
					heatAge = formatRelativeTime(now, heat.lastEditAt);
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

			const data: ActivityLensData = {
				functionId,
				lastEditAt: heat?.lastEditAt,
				editors: heatEditorsAll,
				presence: presenceUsersAll,
			};

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
					command: 'lineheat.showHeatDetails',
					arguments: [data],
					tooltip: tooltipParts.join('\n'),
				}),
			);
		}
		return lenses;
	}
}
