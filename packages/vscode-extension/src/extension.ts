import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ServerHelloPayload, ServerIncompatiblePayload } from '@line-heat/protocol' with {
	'resolution-mode': 'require',
};
import { io, Socket } from 'socket.io-client';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

type ProtocolModule = {
	DEFAULT_RETENTION_DAYS: number;
	PROTOCOL_VERSION: string;
	EVENT_SERVER_HELLO: string;
	EVENT_SERVER_INCOMPATIBLE: string;
};

type LineHeatSettings = {
	serverUrl: string;
	token: string;
	displayName: string;
	emoji: string;
	heatDecayHours: number;
	logLevel: LogLevel;
};

type LineHeatLogger = {
	output: vscode.LogOutputChannel;
	lines: string[];
	debug: (message: string) => void;
	info: (message: string) => void;
	warn: (message: string) => void;
	error: (message: string) => void;
	setLevel: (level: LogLevel) => void;
	logEdit: (entry: string) => void;
};

type RepoContext = {
	gitRoot: string;
	repoId: string;
	filePath: string;
};

type RepoState = {
	status: 'unknown' | 'nogit' | 'ready';
	context?: RepoContext;
};

type FunctionInfo = {
	functionId: string;
	anchorLine: number;
};

const USER_ID_KEY = 'lineheat.userId';

const logLevelWeight: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

let activeLogger: LineHeatLogger | undefined;
let activeSocket: Socket | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let userId: string | undefined;
let retentionDays: number = 7;
let currentSettings: LineHeatSettings | undefined;
let missingConfigLogged = false;
let protocolModule: ProtocolModule | undefined;
let activeRepoState: RepoState = { status: 'unknown' };
let noGitLogged = false;

const gitRootCache = new Map<string, Promise<string | undefined>>();
const repoIdCache = new Map<string, Promise<string | undefined>>();
const fileRepoCache = new Map<string, Promise<RepoContext | undefined>>();

const documentSymbolCache = new Map<string, { version: number; symbols: vscode.DocumentSymbol[] }>();

const functionSymbolKinds = new Set<vscode.SymbolKind>([
	vscode.SymbolKind.Function,
	vscode.SymbolKind.Method,
	vscode.SymbolKind.Constructor,
]);

const containerSymbolKinds = new Set<vscode.SymbolKind>([
	vscode.SymbolKind.Class,
	vscode.SymbolKind.Namespace,
	vscode.SymbolKind.Module,
	vscode.SymbolKind.Function,
]);

const gitTimeoutMs = 1500;

const createLogger = (level: LogLevel): LineHeatLogger => {
	const output = vscode.window.createOutputChannel('LineHeat', { log: true });
	const lines: string[] = [];
	let currentLevel = level;
	const log = (messageLevel: LogLevel, message: string) => {
		if (logLevelWeight[messageLevel] <= logLevelWeight[currentLevel]) {
			output.appendLine(`lineheat (${messageLevel}): ${message}`);
		}
	};
	return {
		output,
		lines,
		debug: (message) => log('debug', message),
		info: (message) => log('info', message),
		warn: (message) => log('warn', message),
		error: (message) => log('error', message),
		setLevel: (newLevel) => {
			currentLevel = newLevel;
		},
		logEdit: (entry) => {
			lines.push(entry);
			if (logLevelWeight.debug <= logLevelWeight[currentLevel]) {
				output.appendLine(`lineheat (debug): ${entry}`);
			}
		},
	};
};

const normalizeString = (value: string | undefined) => value?.trim() ?? '';

const encodeSymbolName = (name: string) => encodeURIComponent(name.trim());

const isDocumentSymbol = (
	symbol: vscode.DocumentSymbol | vscode.SymbolInformation,
): symbol is vscode.DocumentSymbol => 'selectionRange' in symbol;

const getDocumentSymbols = async (document: vscode.TextDocument) => {
	const cacheKey = document.uri.toString();
	const cached = documentSymbolCache.get(cacheKey);
	if (cached && cached.version === document.version) {
		return cached.symbols;
	}
	try {
		const results = await vscode.commands.executeCommand<
			(vscode.DocumentSymbol | vscode.SymbolInformation)[]
		>('vscode.executeDocumentSymbolProvider', document.uri);
		const symbols = (results ?? []).filter(isDocumentSymbol);
		documentSymbolCache.set(cacheKey, { version: document.version, symbols });
		return symbols;
	} catch {
		documentSymbolCache.set(cacheKey, { version: document.version, symbols: [] });
		return [];
	}
};

const resolveFunctionInfoFromSymbols = (
	symbols: vscode.DocumentSymbol[],
	position: vscode.Position,
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
	const visit = (symbol: vscode.DocumentSymbol, ancestors: vscode.DocumentSymbol[]) => {
		const currentOrder = order;
		order += 1;
		const nextAncestors = [...ancestors, symbol];
		if (functionSymbolKinds.has(symbol.kind) && symbol.range.contains(position)) {
			const length = symbol.range.end.line - symbol.range.start.line;
			const depth = ancestors.length;
			const containerSegments = ancestors
				.filter((ancestor) => containerSymbolKinds.has(ancestor.kind))
				.map((ancestor) => encodeSymbolName(ancestor.name));
			const functionName = encodeSymbolName(symbol.name);
			const functionId =
				containerSegments.length > 0
					? `${containerSegments.join('/')}/${functionName}`
					: functionName;
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
	if (!best) {
		return null;
	}
	return { functionId: best.functionId, anchorLine: best.anchorLine };
};

const readSettings = (): LineHeatSettings => {
	const config = vscode.workspace.getConfiguration('lineheat');
	const displayNameSetting = normalizeString(config.get<string>('displayName'));
	const emojiSetting = normalizeString(config.get<string>('emoji'));
	return {
		serverUrl: normalizeString(config.get<string>('serverUrl')),
		token: normalizeString(config.get<string>('token')),
		displayName: displayNameSetting || os.userInfo().username,
		emoji: emojiSetting || '🙂',
		heatDecayHours: config.get<number>('heatDecayHours', 24),
		logLevel: config.get<LogLevel>('logLevel', 'info'),
	};
};

const hasRequiredSettings = (settings: LineHeatSettings) =>
	settings.serverUrl.length > 0 && settings.token.length > 0;

const updateStatusBar = () => {
	if (!statusBarItem || !currentSettings) {
		return;
	}

	if (!hasRequiredSettings(currentSettings)) {
		statusBarItem.text = 'LineHeat: Off';
		statusBarItem.tooltip = 'LineHeat is disabled. Configure server URL and token.';
		return;
	}

	if (activeRepoState.status === 'nogit') {
		statusBarItem.text = 'LineHeat: No git';
		statusBarItem.tooltip = 'LineHeat is disabled (no git remote detected).';
		return;
	}

	if (activeSocket?.connected) {
		statusBarItem.text = `LineHeat: ${retentionDays}d`;
		statusBarItem.tooltip = `LineHeat connected (retention ${retentionDays} days).`;
		return;
	}

	statusBarItem.text = 'LineHeat: Off';
	statusBarItem.tooltip = 'LineHeat is disconnected.';
};

const getDefaultRetentionDays = () => protocolModule?.DEFAULT_RETENTION_DAYS ?? 7;

const disconnectSocket = () => {
	if (!activeSocket) {
		return;
	}

	activeSocket.removeAllListeners();
	activeSocket.disconnect();
	activeSocket = undefined;
	retentionDays = getDefaultRetentionDays();
};

const connectSocket = (
	settings: LineHeatSettings,
	logger: LineHeatLogger,
	protocol: ProtocolModule,
) => {
	if (!userId) {
		logger.error('Cannot connect: userId not initialized.');
		return;
	}

	const socket = io(settings.serverUrl, {
		autoConnect: false,
		auth: {
			token: settings.token,
			clientProtocolVersion: protocol.PROTOCOL_VERSION,
			userId,
			displayName: settings.displayName,
			emoji: settings.emoji,
		},
	});

	socket.on('connect', () => {
		logger.info('connected');
		missingConfigLogged = false;
		updateStatusBar();
	});

	socket.on('connect_error', (error) => {
		logger.error(`connect_error: ${error.message}`);
		updateStatusBar();
	});

	socket.on(protocol.EVENT_SERVER_HELLO, (payload: ServerHelloPayload) => {
		retentionDays = payload.serverRetentionDays;
		logger.info(`server:hello retentionDays=${payload.serverRetentionDays}`);
		updateStatusBar();
	});

	socket.on(protocol.EVENT_SERVER_INCOMPATIBLE, (payload: ServerIncompatiblePayload) => {
		logger.warn(
			`server:incompatible server=${payload.serverProtocolVersion} minClient=${payload.minClientProtocolVersion}`,
		);
		void vscode.window.showWarningMessage(
			`LineHeat protocol incompatible. Please update the extension. ${payload.message}`,
		);
		socket.disconnect();
		updateStatusBar();
	});

	socket.on('disconnect', (reason) => {
		logger.warn(`disconnected: ${reason}`);
		retentionDays = getDefaultRetentionDays();
		updateStatusBar();
	});

	activeSocket = socket;
	socket.connect();
};

const ensureUserId = async (context: vscode.ExtensionContext) => {
	const existing = context.globalState.get<string>(USER_ID_KEY);
	if (existing) {
		userId = existing;
		return;
	}

	const generated = crypto.randomUUID();
	await context.globalState.update(USER_ID_KEY, generated);
	userId = generated;
};

const logMissingSettingsOnce = (settings: LineHeatSettings, logger: LineHeatLogger) => {
	if (missingConfigLogged) {
		return;
	}

	const missing: string[] = [];
	if (!settings.serverUrl) {
		missing.push('serverUrl');
	}
	if (!settings.token) {
		missing.push('token');
	}
	if (missing.length > 0) {
		logger.info(`disabled (missing ${missing.join(', ')})`);
		missingConfigLogged = true;
	}
};

const refreshConnection = (logger: LineHeatLogger) => {
	if (!protocolModule) {
		return;
	}

	const settings = readSettings();
	const previous = currentSettings;
	currentSettings = settings;
	logger.setLevel(settings.logLevel);
	updateStatusBar();

	if (!hasRequiredSettings(settings)) {
		disconnectSocket();
		logMissingSettingsOnce(settings, logger);
		return;
	}

	const requiresReconnect =
		!previous ||
		previous.serverUrl !== settings.serverUrl ||
		previous.token !== settings.token ||
		previous.displayName !== settings.displayName ||
		previous.emoji !== settings.emoji;

	if (!requiresReconnect && activeSocket?.connected) {
		return;
	}

	disconnectSocket();
	connectSocket(settings, logger, protocolModule);
};

const loadProtocol = async () => {
	if (protocolModule) {
		return protocolModule;
	}
	protocolModule = (await import('@line-heat/protocol')) as ProtocolModule;
	retentionDays = protocolModule.DEFAULT_RETENTION_DAYS;
	return protocolModule;
};

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

const logNoGitOnce = (logger: LineHeatLogger) => {
	if (noGitLogged) {
		return;
	}
	logger.info('disabled (no git)');
	noGitLogged = true;
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

const resolveRepoContext = (filePath: string, logger: LineHeatLogger) => {
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

const refreshActiveRepoState = async (
	logger: LineHeatLogger,
	editor: vscode.TextEditor | undefined,
) => {
	if (!editor) {
		activeRepoState = { status: 'unknown' };
		updateStatusBar();
		return;
	}
	if (editor.document.uri.scheme !== 'file') {
		activeRepoState = { status: 'unknown' };
		updateStatusBar();
		return;
	}
	const filePath = editor.document.uri.fsPath;
	const context = await resolveRepoContext(filePath, logger);
	if (!context) {
		activeRepoState = { status: 'nogit' };
		updateStatusBar();
		logNoGitOnce(logger);
		return;
	}
	activeRepoState = { status: 'ready', context };
	logger.debug(`active repo ${JSON.stringify({ repoId: context.repoId, filePath: context.filePath })}`);
	updateStatusBar();
};

export function activate(context: vscode.ExtensionContext) {
	const settings = readSettings();
	const logger = createLogger(settings.logLevel);
	activeLogger = logger;
	currentSettings = settings;
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.text = 'LineHeat: Off';
	statusBarItem.show();

	const onEditDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
		if (event.contentChanges.length === 0) {
			return;
		}
		if (event.document.uri.scheme !== 'file') {
			return;
		}

		void (async () => {
			const context = await resolveRepoContext(event.document.uri.fsPath, logger);
			if (!context) {
				logNoGitOnce(logger);
				return;
			}
			const symbols = await getDocumentSymbols(event.document);
			const changesByLine = new Map<number, FunctionInfo | null>();
			for (const change of event.contentChanges) {
				const line = change.range.start.line + 1;
				if (!changesByLine.has(line)) {
					const functionInfo = resolveFunctionInfoFromSymbols(symbols, change.range.start);
					changesByLine.set(line, functionInfo);
					logger.debug(
						`lineheat: edit functionId=${functionInfo?.functionId ?? 'null'}`,
					);
				}
			}
			for (const [line, functionInfo] of changesByLine.entries()) {
				const entry = functionInfo
					? `${event.document.uri.fsPath}:${line} functionId=${functionInfo.functionId} anchorLine=${
							functionInfo.anchorLine
						}`
					: `${event.document.uri.fsPath}:${line}`;
				logger.logEdit(entry);
			}
		})();
	});

	const onConfigDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
		if (!event.affectsConfiguration('lineheat')) {
			return;
		}
		refreshConnection(logger);
	});

	const onEditorDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
		void refreshActiveRepoState(logger, editor);
	});

	const onSelectionDisposable = vscode.window.onDidChangeTextEditorSelection((event) => {
		if (event.textEditor.document.uri.scheme !== 'file') {
			return;
		}
		void (async () => {
			const context = await resolveRepoContext(event.textEditor.document.uri.fsPath, logger);
			if (!context) {
				logNoGitOnce(logger);
				return;
			}
			const symbols = await getDocumentSymbols(event.textEditor.document);
			const functionInfo = resolveFunctionInfoFromSymbols(
				symbols,
				event.textEditor.selection.active,
			);
			logger.debug(
				`lineheat: presence functionId=${functionInfo?.functionId ?? 'null'}`,
			);
		})();
	});

	void ensureUserId(context).then(async () => {
		await loadProtocol();
		refreshConnection(logger);
	});
	updateStatusBar();
	void refreshActiveRepoState(logger, vscode.window.activeTextEditor);

	context.subscriptions.push(
		logger.output,
		statusBarItem,
		onEditDisposable,
		onConfigDisposable,
		onEditorDisposable,
		onSelectionDisposable,
	);
	return { logger: { lines: logger.lines } };
}

export function getLoggerForTests(): { lines: string[] } | undefined {
	return activeLogger ? { lines: activeLogger.lines } : undefined;
}

export function deactivate() {
	disconnectSocket();
	activeLogger = undefined;
}
