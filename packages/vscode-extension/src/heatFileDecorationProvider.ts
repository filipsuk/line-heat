import * as path from 'path';
import * as vscode from 'vscode';

import { computeHeatIntensity, formatRelativeTime } from './format';
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

/** Collect ancestor directory paths up to (but not including) the filesystem root. */
const getAncestorPaths = (fsPath: string): string[] => {
	const ancestors: string[] = [];
	let dir = path.dirname(fsPath);
	while (dir !== path.dirname(dir)) {
		ancestors.push(dir);
		dir = path.dirname(dir);
	}
	return ancestors;
};

export class HeatFileDecorationProvider implements vscode.FileDecorationProvider {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	public readonly onDidChangeFileDecorations = this.onDidChangeEmitter.event;
	private readonly deps: HeatFileDecorationDeps;
	// Tracks lastEditAt per file fsPath from the previous refresh, so we only
	// fire change events for URIs whose decoration actually changed.
	private lastHeatByFile = new Map<string, number>();

	public constructor(deps?: HeatFileDecorationDeps) {
		if (!deps) {
			throw new Error('HeatFileDecorationProvider deps required');
		}
		this.deps = deps;
	}

	refresh() {
		const repoHeatMap = this.deps.getRepoHeatMap();
		const hashIndex = this.deps.getHashIndex();
		const settings = this.deps.getSettings();
		const decayHours = settings?.heatDecayHours ?? 24;
		const decayMs = decayHours > 0 ? decayHours * 60 * 60 * 1000 : 0;
		const now = Date.now();

		// Build the current heat snapshot: fsPath → lastEditAt for hot files only
		const currentHeat = new Map<string, number>();
		if (repoHeatMap && hashIndex && settings?.explorerDecorations && decayMs > 0) {
			for (const [hashedRepoId, fileMap] of hashIndex.entries()) {
				const repoHeat = repoHeatMap.get(hashedRepoId);
				if (!repoHeat) {
					continue;
				}
				for (const [hashedFilePath, indexedUri] of fileMap.entries()) {
					const lastEditAt = repoHeat.get(hashedFilePath);
					if (lastEditAt === undefined) {
						continue;
					}
					const intensity = computeHeatIntensity(now, lastEditAt, decayMs);
					if (intensity >= HEAT_THRESHOLD) {
						currentHeat.set(indexedUri.fsPath, lastEditAt);
					}
				}
			}
		}

		// Diff against previous state to find changed file paths
		const changedPaths = new Set<string>();
		for (const [fsPath, lastEditAt] of currentHeat) {
			if (this.lastHeatByFile.get(fsPath) !== lastEditAt) {
				changedPaths.add(fsPath);
			}
		}
		for (const [fsPath] of this.lastHeatByFile) {
			if (!currentHeat.has(fsPath)) {
				changedPaths.add(fsPath);
			}
		}

		this.lastHeatByFile = currentHeat;

		if (changedPaths.size === 0) {
			return;
		}

		// Also invalidate ancestor folders of changed files
		const changedFsPaths = new Set<string>(changedPaths);
		for (const fsPath of changedPaths) {
			for (const ancestor of getAncestorPaths(fsPath)) {
				changedFsPaths.add(ancestor);
			}
		}

		this.onDidChangeEmitter.fire([...changedFsPaths].map((p) => vscode.Uri.file(p)));
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
					return new vscode.FileDecoration(
						'\u{1F525}',
						`Teammates edited ${formatRelativeTime(now, lastEditAt)}`,
					);
				}
				return undefined;
			}
		}
		return undefined;
	}

	private resolveFolderDecoration(
		uri: vscode.Uri,
		repoHeatMap: Map<string, Map<string, number>>,
		hashIndex: Map<string, Map<string, vscode.Uri>>,
		now: number,
		decayMs: number,
	): vscode.FileDecoration | undefined {
		const folderPath = uri.fsPath + '/';
		let mostRecentEditAt: number | undefined;

		for (const [hashedRepoId, fileMap] of hashIndex.entries()) {
			const repoHeat = repoHeatMap.get(hashedRepoId);
			if (!repoHeat) {
				continue;
			}
			for (const [hashedFilePath, indexedUri] of fileMap.entries()) {
				if (!indexedUri.fsPath.startsWith(folderPath)) {
					continue;
				}
				const lastEditAt = repoHeat.get(hashedFilePath);
				if (lastEditAt === undefined) {
					continue;
				}
				const intensity = computeHeatIntensity(now, lastEditAt, decayMs);
				if (intensity >= HEAT_THRESHOLD) {
					if (mostRecentEditAt === undefined || lastEditAt > mostRecentEditAt) {
						mostRecentEditAt = lastEditAt;
					}
				}
			}
		}

		if (mostRecentEditAt === undefined) {
			return undefined;
		}

		return new vscode.FileDecoration(
			'\u{00B7}',
			`Teammates edited ${formatRelativeTime(now, mostRecentEditAt)}`,
		);
	}
}
