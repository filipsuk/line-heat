import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

import { type LineHeatLogger, type RepoContext } from './types';

const gitTimeoutMs = 1500;

const gitRootCache = new Map<string, Promise<string | undefined>>();
const repoIdCache = new Map<string, Promise<string | undefined>>();
const fileRepoCache = new Map<string, Promise<RepoContext | undefined>>();

const execFileWithTimeout = async (
	command: string,
	args: string[],
	options: { cwd?: string; timeoutMs?: number } = {},
) =>
	new Promise<string>((resolve, reject) => {
		execFile(
			command,
			args,
			{
				cwd: options.cwd,
				timeout: options.timeoutMs ?? gitTimeoutMs,
				maxBuffer: 1024 * 1024,
			},
			(error, stdout) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(stdout);
			},
		);
	});

const normalizeRepoPath = (value: string) => {
	let cleaned = value.replace(/\\/g, '/');
	cleaned = cleaned.replace(/^\/+/, '').replace(/\/+$/, '');
	if (cleaned.toLowerCase().endsWith('.git')) {
		cleaned = cleaned.slice(0, -4);
		cleaned = cleaned.replace(/\/+$/, '');
	}
	if (!cleaned) {
		return undefined;
	}
	return cleaned.toLowerCase();
};

const normalizeRepoId = (hostPart: string, pathPart: string) => {
	const normalizedPath = normalizeRepoPath(pathPart);
	if (!normalizedPath) {
		return undefined;
	}
	return `${hostPart.toLowerCase()}/${normalizedPath}`;
};

const normalizeRemoteUrl = (remoteUrl: string) => {
	const trimmed = remoteUrl.trim();
	if (!trimmed) {
		return undefined;
	}
	if (trimmed.startsWith('file://')) {
		return undefined;
	}
	if (trimmed.includes('://')) {
		try {
			const parsed = new URL(trimmed);
			if (parsed.protocol === 'file:') {
				return undefined;
			}
			const scheme = parsed.protocol.replace(':', '').toLowerCase();
			const defaultPorts: Record<string, number> = {
				ssh: 22,
				https: 443,
				http: 80,
				git: 9418,
			};
			const host = parsed.hostname.toLowerCase();
			if (!host) {
				return undefined;
			}
			let port = parsed.port ? Number(parsed.port) : undefined;
			if (Number.isNaN(port)) {
				port = undefined;
			}
			const defaultPort = defaultPorts[scheme];
			if (port && defaultPort === port) {
				port = undefined;
			}
			const hostPart = port ? `${host}:${port}` : host;
			return normalizeRepoId(hostPart, parsed.pathname);
		} catch {
			return undefined;
		}
	}

	const scpMatch = trimmed.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
	if (!scpMatch) {
		return undefined;
	}
	return normalizeRepoId(scpMatch[1], scpMatch[2]);
};

const resolveGitRoot = (filePath: string, logger: LineHeatLogger) => {
	const directory = path.dirname(filePath);
	const cached = gitRootCache.get(directory);
	if (cached) {
		return cached;
	}
	const promise = execFileWithTimeout('git', ['rev-parse', '--show-toplevel'], {
		cwd: directory,
	})
		.then((stdout) => stdout.trim())
		.then(async (root) => {
			if (!root) {
				return undefined;
			}
			const resolved = path.resolve(root);
			try {
				return await fs.realpath(resolved);
			} catch {
				return resolved;
			}
		})
		.catch((error: Error) => {
			logger.debug(`git root lookup failed: ${error.message}`);
			return undefined;
		});
	gitRootCache.set(directory, promise);
	return promise;
};

const resolveRemoteUrl = async (gitRoot: string, logger: LineHeatLogger) => {
	const originUrl = await execFileWithTimeout('git', ['config', '--get', 'remote.origin.url'], {
		cwd: gitRoot,
	})
		.then((stdout) => stdout.trim())
		.catch((error: Error) => {
			logger.debug(`git origin lookup failed: ${error.message}`);
			return '';
		});
	if (originUrl) {
		return originUrl;
	}

	const remotes = await execFileWithTimeout('git', ['remote', '-v'], {
		cwd: gitRoot,
	})
		.then((stdout) => stdout.trim())
		.catch((error: Error) => {
			logger.debug(`git remote lookup failed: ${error.message}`);
			return '';
		});
	if (!remotes) {
		return '';
	}
	const firstLine = remotes.split(/\r?\n/)[0];
	const parts = firstLine.trim().split(/\s+/);
	if (parts.length < 2) {
		return '';
	}
	return parts[1];
};

const resolveRepoId = (gitRoot: string, logger: LineHeatLogger) => {
	const cached = repoIdCache.get(gitRoot);
	if (cached) {
		return cached;
	}
	const promise = resolveRemoteUrl(gitRoot, logger)
		.then((remote) => normalizeRemoteUrl(remote))
		.catch(() => undefined);
	repoIdCache.set(gitRoot, promise);
	return promise;
};

export const resolveRepoContext = (filePath: string, logger: LineHeatLogger) => {
	const cached = fileRepoCache.get(filePath);
	if (cached) {
		return cached;
	}
	const promise = resolveGitRoot(filePath, logger)
		.then(async (gitRoot) => {
			if (!gitRoot) {
				return undefined;
			}
			const repoId = await resolveRepoId(gitRoot, logger);
			if (!repoId) {
				return undefined;
			}
			const resolvedFilePath = await fs.realpath(filePath).catch(() => filePath);
			const relative = path.relative(gitRoot, resolvedFilePath);
			const normalized = relative.split(path.sep).join('/');
			if (!normalized || normalized === '..' || normalized.startsWith('../')) {
				return undefined;
			}
			return { gitRoot, repoId, filePath: normalized };
		})
		.catch(() => undefined);
	fileRepoCache.set(filePath, promise);
	return promise;
};
