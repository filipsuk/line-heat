import * as crypto from 'crypto';
import * as os from 'os';
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

const hasWorkspaceFolders = () =>
	(vscode.workspace.workspaceFolders ?? []).some((folder) => folder.uri.scheme === 'file');

const updateStatusBar = () => {
	if (!statusBarItem || !currentSettings) {
		return;
	}

	if (!hasRequiredSettings(currentSettings)) {
		statusBarItem.text = 'LineHeat: Off';
		statusBarItem.tooltip = 'LineHeat is disabled. Configure server URL and token.';
		return;
	}

	if (!hasWorkspaceFolders()) {
		statusBarItem.text = 'LineHeat: No git';
		statusBarItem.tooltip = 'LineHeat is disabled (no git workspace detected).';
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

		const filePath = event.document.uri.fsPath || event.document.uri.toString();
		const changedLines = new Set<number>();
		for (const change of event.contentChanges) {
			changedLines.add(change.range.start.line + 1);
		}

		for (const line of changedLines) {
			logger.logEdit(`${filePath}:${line}`);
		}
	});

	const onConfigDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
		if (!event.affectsConfiguration('lineheat')) {
			return;
		}
		refreshConnection(logger);
	});

	const onEditorDisposable = vscode.window.onDidChangeActiveTextEditor(() => {
		updateStatusBar();
	});

	void ensureUserId(context).then(async () => {
		await loadProtocol();
		refreshConnection(logger);
	});
	updateStatusBar();

	context.subscriptions.push(
		logger.output,
		statusBarItem,
		onEditDisposable,
		onConfigDisposable,
		onEditorDisposable,
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
