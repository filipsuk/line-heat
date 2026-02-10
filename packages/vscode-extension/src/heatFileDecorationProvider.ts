import * as vscode from 'vscode';

import { computeHeatIntensity } from './format';
import { type LineHeatLogger, type LineHeatSettings } from './types';

type HeatFileDecorationDeps = {
	getLogger: () => LineHeatLogger | undefined;
	getSettings: () => LineHeatSettings | undefined;
	getRepoHeatMap: () => Map<string, Map<string, number>> | undefined;
	// outer key = hashed repoId, inner key = hashed filePath, value = lastEditAt
	getHashIndex: () => Map<string, Map<string, vscode.Uri>> | undefined;
	// outer key = hashed repoId, inner key = hashed filePath, value = workspace URI
};

const HEAT_THRESHOLD = 0.75;

export class HeatFileDecorationProvider implements vscode.FileDecorationProvider {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	public readonly onDidChangeFileDecorations = this.onDidChangeEmitter.event;
	private readonly deps: HeatFileDecorationDeps;

	public constructor(deps?: HeatFileDecorationDeps) {
		if (!deps) {
			throw new Error('HeatFileDecorationProvider deps required');
		}
		this.deps = deps;
	}

	refresh() {
		this.onDidChangeEmitter.fire(undefined);
	}

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		const settings = this.deps.getSettings();
		if (!settings?.explorerDecorations) {
			return undefined;
		}
		if (uri.scheme !== 'file') {
			return undefined;
		}

		const repoHeatMap = this.deps.getRepoHeatMap();
		const hashIndex = this.deps.getHashIndex();
		if (!repoHeatMap || !hashIndex) {
			return undefined;
		}

		const decayHours = settings.heatDecayHours ?? 24;
		const decayMs = decayHours > 0 ? decayHours * 60 * 60 * 1000 : 0;
		if (decayMs <= 0) {
			return undefined;
		}

		const now = Date.now();

		// Check if this is a file decoration
		const fileDecoration = this.resolveFileDecoration(uri, repoHeatMap, hashIndex, now, decayMs);
		if (fileDecoration) {
			return fileDecoration;
		}

		// Check if this is a folder decoration (propagation handles this via propagate: true on files)
		// Folder decoration is a separate code path for future customization
		return this.resolveFolderDecoration(uri, repoHeatMap, hashIndex, now, decayMs);
	}

	private resolveFileDecoration(
		uri: vscode.Uri,
		repoHeatMap: Map<string, Map<string, number>>,
		hashIndex: Map<string, Map<string, vscode.Uri>>,
		now: number,
		decayMs: number,
	): vscode.FileDecoration | undefined {
		// Reverse lookup: find the hashed repoId + hashed filePath for this URI
		for (const [hashedRepoId, fileMap] of hashIndex.entries()) {
			for (const [hashedFilePath, indexedUri] of fileMap.entries()) {
				if (indexedUri.fsPath !== uri.fsPath) {
					continue;
				}
				// Found match — look up heat
				const repoHeat = repoHeatMap.get(hashedRepoId);
				if (!repoHeat) {
					return undefined;
				}
				const lastEditAt = repoHeat.get(hashedFilePath);
				if (lastEditAt === undefined) {
					return undefined;
				}
				const intensity = computeHeatIntensity(now, lastEditAt, decayMs);
				if (intensity >= HEAT_THRESHOLD) {
					const decoration = new vscode.FileDecoration(
						'\u{1F525}',
						'Teammates edited recently',
					);
					decoration.propagate = true;
					return decoration;
				}
				return undefined;
			}
		}
		return undefined;
	}

	private resolveFolderDecoration(
		_uri: vscode.Uri,
		_repoHeatMap: Map<string, Map<string, number>>,
		_hashIndex: Map<string, Map<string, vscode.Uri>>,
		_now: number,
		_decayMs: number,
	): vscode.FileDecoration | undefined {
		// Folder decoration is handled by propagate: true on file decorations
		// This is a separate code path for future customization (e.g. aggregate folder heat)
		return undefined;
	}
}
