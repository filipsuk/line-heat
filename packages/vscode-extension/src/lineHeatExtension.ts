import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { io, Socket } from 'socket.io-client';

import {
	type FileDeltaPayload,
	type FunctionInfo,
	type LineHeatLogger,
	type LineHeatSettings,
	type PresenceState,
	type ProtocolModule,
	type RepoState,
	type RoomContext,
	type RoomKey,
	type RoomSnapshotPayload,
	type RoomState,
	type ServerHelloPayload,
	type ServerIncompatiblePayload,
} from './types';

import {
	formatFunctionLabel,
	formatRelativeTime,
} from './format';
import { createLogger } from './logger';
import { hasRequiredSettings, readSettings } from './settings';
import {
	getDocumentSymbols,
	resetSymbolState,
	resolveFunctionInfo,
} from './symbols';
import { resolveRepoContext } from './repo';
import { HeatCodeLensProvider, type ActivityLensData } from './heatCodeLensProvider';

const USER_ID_KEY = 'lineheat.userId';

let activeLogger: LineHeatLogger | undefined;
let activeSocket: Socket | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let userId: string | undefined;
let retentionDays: number = 7;
let currentSettings: LineHeatSettings | undefined;
let missingConfigLogged = false;
let protocolIncompatPopupShown = false;
let protocolModule: ProtocolModule | undefined;
let activeRepoState: RepoState = { status: 'unknown' };
let noGitLogged = false;

let activeRoomContext: RoomContext | undefined;
let desiredRooms = new Map<RoomKey, RoomContext>();
let joinedRooms = new Map<RoomKey, RoomContext>();
let openRoomCounts = new Map<RoomKey, number>();
let mruRooms: RoomKey[] = [];
let desiredPresence: PresenceState | undefined;
let activePresence: PresenceState | undefined;
let presenceKeepaliveTimer: NodeJS.Timeout | undefined;

const roomStateByKey = new Map<RoomKey, RoomState>();
const maxSubscribedRooms = 10;

let heatCodeLensProvider: HeatCodeLensProvider | undefined;

const isSameRoom = (left: RoomContext | undefined, right: RoomContext | undefined) =>
	left?.repoId === right?.repoId && left?.filePath === right?.filePath;

const isSamePresence = (left: PresenceState | undefined, right: PresenceState | undefined) =>
	left?.repoId === right?.repoId &&
	left?.filePath === right?.filePath &&
	left?.functionId === right?.functionId &&
	left?.anchorLine === right?.anchorLine;

const getRoomKey = (room: RoomContext): RoomKey => `${room.repoId}:${room.filePath}`;

const emitRoomJoin = (logger: LineHeatLogger, room: RoomContext) => {
	if (!activeSocket?.connected || !protocolModule) {
		return;
	}
	activeSocket.emit(protocolModule.EVENT_ROOM_JOIN, room);
	logger.debug(`lineheat: room:join repoId=${room.repoId} filePath=${room.filePath}`);
};

const emitRoomLeave = (logger: LineHeatLogger, room: RoomContext) => {
	if (!activeSocket?.connected || !protocolModule) {
		return;
	}
	activeSocket.emit(protocolModule.EVENT_ROOM_LEAVE, room);
	logger.debug(`lineheat: room:leave repoId=${room.repoId} filePath=${room.filePath}`);
};

const emitPresenceSet = (logger: LineHeatLogger, payload: PresenceState) => {
	if (!activeSocket?.connected || !protocolModule) {
		return;
	}
	activeSocket.emit(protocolModule.EVENT_PRESENCE_SET, payload);
	logger.debug('lineheat: presence:set');
};

const emitPresenceClear = (logger: LineHeatLogger, payload: RoomContext) => {
	if (!activeSocket?.connected || !protocolModule) {
		return;
	}
	activeSocket.emit(protocolModule.EVENT_PRESENCE_CLEAR, payload);
	logger.debug('lineheat: presence:clear');
};

const updateStatusBar = () => {
	if (!statusBarItem || !currentSettings) {
		return;
	}

	if (!hasRequiredSettings(currentSettings)) {
		statusBarItem.text = '🚫🔥';
		statusBarItem.tooltip = 'LineHeat is disabled. Configure server URL and token.';
		return;
	}

	if (activeRepoState.status === 'nogit') {
		statusBarItem.text = '🚫🔥';
		statusBarItem.tooltip = 'LineHeat is disabled (no git remote detected).';
		return;
	}

	if (activeSocket?.connected) {
		statusBarItem.text = '🔥';
		statusBarItem.tooltip = `LineHeat connected (retention ${retentionDays} days). Click to open settings.`;
		return;
	}

	statusBarItem.text = '🚫🔥';
	statusBarItem.tooltip = 'LineHeat is disconnected. Click to open settings.';
};

const getDefaultRetentionDays = () => protocolModule?.DEFAULT_RETENTION_DAYS ?? 7;

const disconnectSocket = () => {
	if (!activeSocket) {
		return;
	}

	activeSocket.removeAllListeners();
	activeSocket.disconnect();
	activeSocket = undefined;
	joinedRooms.clear();
	activePresence = undefined;
	roomStateByKey.clear();
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
		void updateOpenRoomsFromTabs(logger);
		void updateActiveEditorState(logger, vscode.window.activeTextEditor);
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
		if (!protocolIncompatPopupShown) {
			protocolIncompatPopupShown = true;
			void vscode.window.showWarningMessage(
				`LineHeat protocol incompatible. Please update the extension. ${payload.message}`,
			);
		}
		socket.disconnect();
		updateStatusBar();
	});

	socket.on(protocol.EVENT_ROOM_SNAPSHOT, (payload: RoomSnapshotPayload) => {
		updateRoomStateFromSnapshot(payload);
		heatCodeLensProvider?.refresh();
	});

	socket.on(protocol.EVENT_FILE_DELTA, (payload: FileDeltaPayload) => {
		updateRoomStateFromDelta(payload);
		heatCodeLensProvider?.refresh();
	});

	socket.on('disconnect', (reason) => {
		logger.warn(`disconnected: ${reason}`);
		retentionDays = getDefaultRetentionDays();
		joinedRooms.clear();
		activePresence = undefined;
		roomStateByKey.clear();
		heatCodeLensProvider?.refresh();
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

const logNoGitOnce = (logger: LineHeatLogger) => {
	if (noGitLogged) {
		return;
	}
	logger.info('disabled (no git)');
	noGitLogged = true;
};

const refreshActiveRepoState = async (
	logger: LineHeatLogger,
	editor: vscode.TextEditor | undefined,
) => {
	if (!editor) {
		activeRepoState = { status: 'unknown' };
		activeRoomContext = undefined;
		updateStatusBar();
		return undefined;
	}
	if (editor.document.uri.scheme !== 'file') {
		activeRepoState = { status: 'unknown' };
		activeRoomContext = undefined;
		updateStatusBar();
		return undefined;
	}
	const filePath = editor.document.uri.fsPath;
	const context = await resolveRepoContext(filePath, logger);
	if (!context) {
		activeRepoState = { status: 'nogit' };
		activeRoomContext = undefined;
		updateStatusBar();
		logNoGitOnce(logger);
		return undefined;
	}
	activeRepoState = { status: 'ready', context };
	activeRoomContext = { repoId: context.repoId, filePath: context.filePath };
	logger.debug(`active repo ${JSON.stringify({ repoId: context.repoId, filePath: context.filePath })}`);
	updateStatusBar();
	return context;
};

const applyRoomLimit = (orderedRooms: RoomKey[], activeRoomKey: RoomKey | undefined) => {
	const limitedRooms = [...orderedRooms];
	const evictedRooms: RoomKey[] = [];
	while (limitedRooms.length > maxSubscribedRooms) {
		let index = limitedRooms.length - 1;
		while (index >= 0 && limitedRooms[index] === activeRoomKey) {
			index -= 1;
		}
		if (index < 0) {
			break;
		}
		const [evicted] = limitedRooms.splice(index, 1);
		if (evicted) {
			evictedRooms.push(evicted);
		}
	}
	return { limitedRooms, evictedRooms };
};

const syncRoomsWithSocket = (logger: LineHeatLogger) => {
	if (!activeSocket?.connected || !protocolModule) {
		return;
	}
	const activeRoomKey = activeRoomContext ? getRoomKey(activeRoomContext) : undefined;
	const orderedRooms = mruRooms.filter((roomKey) => desiredRooms.has(roomKey));
	const { limitedRooms, evictedRooms } = applyRoomLimit(orderedRooms, activeRoomKey);
	const targetRooms = new Set(limitedRooms);
	const evictedSet = new Set(evictedRooms);
	for (const [roomKey, room] of Array.from(joinedRooms.entries())) {
		if (!targetRooms.has(roomKey)) {
			if (evictedSet.has(roomKey)) {
				logger.debug(`lineheat: room:evict repoId=${room.repoId} filePath=${room.filePath}`);
			}
			emitRoomLeave(logger, room);
			joinedRooms.delete(roomKey);
			roomStateByKey.delete(roomKey);
		}
	}
	for (const roomKey of limitedRooms) {
		if (joinedRooms.has(roomKey)) {
			continue;
		}
		const room = desiredRooms.get(roomKey);
		if (!room) {
			continue;
		}
		emitRoomJoin(logger, room);
		joinedRooms.set(roomKey, room);
	}
};

const syncPresenceWithSocket = (logger: LineHeatLogger) => {
	if (!activeSocket?.connected || !protocolModule) {
		return;
	}
	const activeRoomKey = activeRoomContext ? getRoomKey(activeRoomContext) : undefined;
	const isActiveRoomJoined = activeRoomKey ? joinedRooms.has(activeRoomKey) : false;
	if (activePresence && (!desiredPresence || !isSamePresence(activePresence, desiredPresence))) {
		emitPresenceClear(logger, {
			repoId: activePresence.repoId,
			filePath: activePresence.filePath,
		});
		activePresence = undefined;
	}
	if (desiredPresence && isActiveRoomJoined && !isSamePresence(activePresence, desiredPresence)) {
		emitPresenceSet(logger, desiredPresence);
		activePresence = desiredPresence;
	}
};

const updateDesiredPresenceFromEditor = async (editor: vscode.TextEditor | undefined, logger?: LineHeatLogger) => {
	if (!editor || editor.document.uri.scheme !== 'file') {
		desiredPresence = undefined;
		return;
	}
	if (!activeRoomContext) {
		desiredPresence = undefined;
		return;
	}
	const symbols = await getDocumentSymbols(editor.document, logger);
	const functionInfo = resolveFunctionInfo(symbols, editor.selection.active, editor.document, logger);
	if (!functionInfo) {
		desiredPresence = undefined;
		return;
	}
	desiredPresence = {
		repoId: activeRoomContext.repoId,
		filePath: activeRoomContext.filePath,
		functionId: functionInfo.functionId,
		anchorLine: functionInfo.anchorLine,
	};
};

const updateOpenRoomsFromTabs = async (logger: LineHeatLogger) => {
	try {
		const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
		const roomResults = await Promise.all(
			tabs.map(async (tab) => {
				if (!(tab.input instanceof vscode.TabInputText)) {
					return undefined;
				}
				const uri = tab.input.uri;
				if (uri.scheme !== 'file') {
					return undefined;
				}
				const context = await resolveRepoContext(uri.fsPath, logger);
				if (!context) {
					return undefined;
				}
				return { repoId: context.repoId, filePath: context.filePath } as RoomContext;
			}),
		);
		const nextDesiredRooms = new Map<RoomKey, RoomContext>();
		const nextCounts = new Map<RoomKey, number>();
		const orderedRooms: RoomKey[] = [];
		const seen = new Set<RoomKey>();
		for (const room of roomResults) {
			if (!room) {
				continue;
			}
			const roomKey = getRoomKey(room);
			nextDesiredRooms.set(roomKey, room);
			nextCounts.set(roomKey, (nextCounts.get(roomKey) ?? 0) + 1);
			if (!seen.has(roomKey)) {
				seen.add(roomKey);
				orderedRooms.push(roomKey);
			}
		}
		desiredRooms = nextDesiredRooms;
		openRoomCounts = nextCounts;
		if (mruRooms.length === 0) {
			mruRooms = orderedRooms;
		} else {
			mruRooms = mruRooms.filter((roomKey) => desiredRooms.has(roomKey));
			for (const roomKey of orderedRooms) {
				if (!mruRooms.includes(roomKey)) {
					mruRooms.push(roomKey);
				}
			}
		}
		const activeRoomKey = activeRoomContext ? getRoomKey(activeRoomContext) : undefined;
		if (activeRoomKey && desiredRooms.has(activeRoomKey)) {
			mruRooms = [activeRoomKey, ...mruRooms.filter((roomKey) => roomKey !== activeRoomKey)];
		}
		syncRoomsWithSocket(logger);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'unknown error';
		logger.debug(`tab room refresh failed: ${message}`);
	}
};

const updateActiveEditorState = async (
	logger: LineHeatLogger,
	editor: vscode.TextEditor | undefined,
) => {
	const previousRoom = activeRoomContext;
	await refreshActiveRepoState(logger, editor);
	if (!isSameRoom(previousRoom, activeRoomContext)) {
		desiredPresence = undefined;
	}
	syncPresenceWithSocket(logger);
	const activeRoomKey = activeRoomContext ? getRoomKey(activeRoomContext) : undefined;
	if (activeRoomKey && desiredRooms.has(activeRoomKey)) {
		mruRooms = [activeRoomKey, ...mruRooms.filter((roomKey) => roomKey !== activeRoomKey)];
	}
	syncRoomsWithSocket(logger);
	await updateDesiredPresenceFromEditor(editor, logger);
	syncPresenceWithSocket(logger);
};

const ensurePresenceKeepalive = (logger: LineHeatLogger) => {
	if (presenceKeepaliveTimer) {
		return;
	}
	presenceKeepaliveTimer = setInterval(() => {
		if (!activePresence || !activeSocket?.connected || !protocolModule) {
			return;
		}
		emitPresenceSet(logger, activePresence);
	}, 5000);
};

const updateRoomStateFromSnapshot = (payload: RoomSnapshotPayload) => {
	const roomKey = getRoomKey({ repoId: payload.repoId, filePath: payload.filePath });
	const heatByFunctionId = new Map<string, RoomSnapshotPayload['functions'][number]>();
	const presenceByFunctionId = new Map<string, RoomSnapshotPayload['presence'][number]>();
	for (const heat of payload.functions) {
		heatByFunctionId.set(heat.functionId, heat);
	}
	for (const presence of payload.presence) {
		if (presence.users.length > 0) {
			presenceByFunctionId.set(presence.functionId, presence);
		}
	}
	roomStateByKey.set(roomKey, { heatByFunctionId, presenceByFunctionId });
};

const updateRoomStateFromDelta = (payload: FileDeltaPayload) => {
	const roomKey = getRoomKey({ repoId: payload.repoId, filePath: payload.filePath });
	const current = roomStateByKey.get(roomKey) ?? {
		heatByFunctionId: new Map<string, RoomSnapshotPayload['functions'][number]>(),
		presenceByFunctionId: new Map<string, RoomSnapshotPayload['presence'][number]>(),
	};
	const heatUpdates = payload.updates.heat ?? [];
	const presenceUpdates = payload.updates.presence ?? [];
	for (const heat of heatUpdates) {
		current.heatByFunctionId.set(heat.functionId, heat);
	}
	for (const presence of presenceUpdates) {
		if (presence.users.length > 0) {
			current.presenceByFunctionId.set(presence.functionId, presence);
		} else {
			current.presenceByFunctionId.delete(presence.functionId);
		}
	}
	roomStateByKey.set(roomKey, current);
};

export function activate(context: vscode.ExtensionContext) {
	const settings = readSettings();
	const logger = createLogger(settings.logLevel);
	activeLogger = logger;
	currentSettings = settings;
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = '🚫🔥';
	statusBarItem.tooltip = 'LineHeat';
	statusBarItem.command = { command: 'workbench.action.openSettings', arguments: ['lineheat'], title: 'Open LineHeat settings'};
	statusBarItem.show();

	heatCodeLensProvider = new HeatCodeLensProvider({
		getLogger: () => activeLogger,
		getSettings: () => currentSettings,
		getUserId: () => userId,
		getRoomState: (roomKey) => roomStateByKey.get(roomKey),
	});
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, heatCodeLensProvider),
		vscode.commands.registerCommand('lineheat.showHeatDetails', (data: ActivityLensData) => {
			const label = formatFunctionLabel(data.functionId);
			const age = data.lastEditAt ? formatRelativeTime(Date.now(), data.lastEditAt) : undefined;
			const editors = data.editors.length > 0 ? data.editors.join(' ') : 'unknown';
			const live = data.presence.length > 0 ? data.presence.join(' ') : 'none';
			void vscode.window.showInformationMessage(
				`LineHeat: ${label}${age ? ` · ${age}` : ''} · edit: ${editors} · live: ${live}`,
			);
		}),
		{ dispose: () => {
			heatCodeLensProvider = undefined;
		} },
	);

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
			}
			const symbols = await getDocumentSymbols(event.document, logger);
			const changesByLine = new Map<number, FunctionInfo | null>();
			const functionUpdates = new Map<string, FunctionInfo>();
			for (const change of event.contentChanges) {
				const line = change.range.start.line + 1;
					if (!changesByLine.has(line)) {
						const functionInfo = resolveFunctionInfo(symbols, change.range.start, event.document, logger);
						changesByLine.set(line, functionInfo);
						if (functionInfo && !functionUpdates.has(functionInfo.functionId)) {
							functionUpdates.set(functionInfo.functionId, functionInfo);
						}
				}
			}
			const roomKey = context ? getRoomKey({ repoId: context.repoId, filePath: context.filePath }) : undefined;
			if (context && activeSocket?.connected && protocolModule && roomKey && joinedRooms.has(roomKey)) {
				for (const functionInfo of functionUpdates.values()) {
					activeSocket.emit(protocolModule.EVENT_EDIT_PUSH, {
						repoId: context.repoId,
						filePath: context.filePath,
						functionId: functionInfo.functionId,
						anchorLine: functionInfo.anchorLine,
					});
					logger.debug(`lineheat: edit:push functionId=${functionInfo.functionId}`);
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
		heatCodeLensProvider?.refresh();
	});

	const onEditorDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
		void updateActiveEditorState(logger, editor);
	});

	const onTabDisposable = vscode.window.tabGroups.onDidChangeTabs(() => {
		void updateOpenRoomsFromTabs(logger);
	});

	const onSelectionDisposable = vscode.window.onDidChangeTextEditorSelection((event) => {
		if (event.textEditor.document.uri.scheme !== 'file') {
			return;
		}
		if (event.textEditor !== vscode.window.activeTextEditor) {
			return;
		}
		void (async () => {
			await updateDesiredPresenceFromEditor(event.textEditor, logger);
			syncPresenceWithSocket(logger);
		})();
	});

	void ensureUserId(context).then(async () => {
		await loadProtocol();
		refreshConnection(logger);
	});
	updateStatusBar();
	void updateActiveEditorState(logger, vscode.window.activeTextEditor);
	void updateOpenRoomsFromTabs(logger);
	ensurePresenceKeepalive(logger);

	context.subscriptions.push(
		logger.output,
		statusBarItem,
		onEditDisposable,
		onConfigDisposable,
		onEditorDisposable,
		onTabDisposable,
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
	activeRoomContext = undefined;
	desiredRooms.clear();
	joinedRooms.clear();
	openRoomCounts.clear();
	mruRooms = [];
	desiredPresence = undefined;
	activePresence = undefined;
	roomStateByKey.clear();
	resetSymbolState();
	if (presenceKeepaliveTimer) {
		clearInterval(presenceKeepaliveTimer);
		presenceKeepaliveTimer = undefined;
	}
	heatCodeLensProvider = undefined;
}
