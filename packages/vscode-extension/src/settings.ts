import { execFile } from 'child_process';
import * as os from 'os';
import * as vscode from 'vscode';
import picomatch from 'picomatch';

import { type LineHeatSettings, type LogLevel } from './types';

const normalizeString = (value: string | undefined) => value?.trim() ?? '';

// Cached git user name, initialized at activation
let cachedGitUserName: string | undefined;

const getGitUserNameSync = (): string | undefined => cachedGitUserName;

export const initGitUserName = (): Promise<void> =>
	new Promise((resolve) => {
		execFile(
			'git',
			['config', '--global', 'user.name'],
			{ timeout: 1500 },
			(error, stdout) => {
				if (!error && stdout) {
					cachedGitUserName = stdout.trim() || undefined;
				}
				resolve();
			},
		);
	});

export const readSettings = (): LineHeatSettings => {
	const config = vscode.workspace.getConfiguration('lineheat');
	const displayNameSetting = normalizeString(config.get<string>('displayName'));
	const emojiSetting = normalizeString(config.get<string>('emoji'));

	return {
		serverUrl: normalizeString(config.get<string>('serverUrl')),
		token: normalizeString(config.get<string>('token')),
		displayName: displayNameSetting || getGitUserNameSync() || os.userInfo().username,
		emoji: emojiSetting || '🙂',
		heatDecayHours: config.get<number>('heatDecayHours', 24),
		logLevel: config.get<LogLevel>('logLevel', 'info'),
		presenceNotificationCooldownMinutes: config.get<number>('presenceNotificationCooldownMinutes', 15),
		enabledRepositories: config.get<string[]>('enabledRepositories', []),
	};
};

export const hasRequiredSettings = (settings: LineHeatSettings) =>
	settings.serverUrl.length > 0 && settings.token.length > 0;

const normalizePath = (path: string): string => {
	// Normalize backslashes to forward slashes for cross-platform matching
	let normalized = path.replace(/\\/g, '/');
	// Remove trailing slash for consistent matching
	if (normalized.endsWith('/') && normalized.length > 1) {
		normalized = normalized.slice(0, -1);
	}
	return normalized;
};

export const isRepositoryEnabled = (repoPath: string, patterns: string[]): boolean => {
	// Empty patterns means all repositories are enabled
	if (patterns.length === 0) {
		return true;
	}

	// Empty path can't match any pattern
	if (!repoPath) {
		return false;
	}

	const normalizedRepoPath = normalizePath(repoPath);

	for (const pattern of patterns) {
		const normalizedPattern = normalizePath(pattern);
		const isMatch = picomatch.isMatch(normalizedRepoPath, normalizedPattern, {
			dot: true,
		});
		if (isMatch) {
			return true;
		}
	}

	return false;
};
