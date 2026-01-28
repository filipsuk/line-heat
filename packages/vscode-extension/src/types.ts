import * as vscode from 'vscode';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export type HeatEntry = {
	functionId: string;
	anchorLine: number;
	lastEditAt: number;
	topEditors: Array<{ lastEditAt: number; emoji: string; displayName: string; userId: string }>;
};

export type PresenceEntry = {
	functionId: string;
	anchorLine: number;
	users: Array<{ userId: string; emoji: string; displayName: string }>;
};

export type FileDeltaPayload = {
	repoId: string;
	filePath: string;
	updates: {
		heat?: HeatEntry[];
		presence?: PresenceEntry[];
	};
};

export type RoomSnapshotPayload = {
	repoId: string;
	filePath: string;
	functions: HeatEntry[];
	presence: PresenceEntry[];
};

export type ServerHelloPayload = {
	serverRetentionDays: number;
};

export type ServerIncompatiblePayload = {
	serverProtocolVersion: string;
	minClientProtocolVersion: string;
	message: string;
};

export type ProtocolModule = {
	DEFAULT_RETENTION_DAYS: number;
	PROTOCOL_VERSION: string;
	EVENT_ROOM_JOIN: string;
	EVENT_ROOM_LEAVE: string;
	EVENT_EDIT_PUSH: string;
	EVENT_PRESENCE_SET: string;
	EVENT_PRESENCE_CLEAR: string;
	EVENT_SERVER_HELLO: string;
	EVENT_SERVER_INCOMPATIBLE: string;
	EVENT_ROOM_SNAPSHOT: string;
	EVENT_FILE_DELTA: string;
};

export type LineHeatSettings = {
	serverUrl: string;
	token: string;
	displayName: string;
	emoji: string;
	heatDecayHours: number;
	logLevel: LogLevel;
};

export type LineHeatLogger = {
	output: vscode.LogOutputChannel;
	/**
	 * In-memory copy of output messages (primarily for tests).
	 *
	 * Format matches the Output channel prefix, e.g. `lineheat (debug): ...`.
	 */
	messages: string[];
	lines: string[];
	debug: (message: string) => void;
	info: (message: string) => void;
	warn: (message: string) => void;
	error: (message: string) => void;
	setLevel: (level: LogLevel) => void;
	logEdit: (entry: string) => void;
};

export type RepoContext = {
	gitRoot: string;
	repoId: string;
	filePath: string;
};

export type RoomContext = {
	repoId: string;
	filePath: string;
};

export type RoomKey = string;

export type RepoState = {
	status: 'unknown' | 'nogit' | 'ready';
	context?: RepoContext;
};

export type FunctionInfo = {
	functionId: string;
	anchorLine: number;
};

export type PresenceState = {
	repoId: string;
	filePath: string;
	functionId: string;
	anchorLine: number;
};

export type RoomState = {
	heatByFunctionId: Map<string, RoomSnapshotPayload['functions'][number]>;
	presenceByFunctionId: Map<string, RoomSnapshotPayload['presence'][number]>;
};

export type FunctionSymbolEntry = {
	functionId: string;
	anchorLine: number;
	range: vscode.Range;
};
