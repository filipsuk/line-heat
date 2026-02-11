import * as vscode from 'vscode';

import { type LineHeatLogger, type LogLevel } from './types';

/** Maximum number of entries kept in the in-memory messages/lines arrays. */
export const MAX_LOG_BUFFER = 5_000;

const logLevelWeight: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

const capArray = (arr: string[]) => {
	if (arr.length > MAX_LOG_BUFFER) {
		arr.splice(0, arr.length - MAX_LOG_BUFFER);
	}
};

export const createLogger = (level: LogLevel): LineHeatLogger => {
	const output = vscode.window.createOutputChannel('LineHeat', { log: true });
	const lines: string[] = [];
	const messages: string[] = [];
	let currentLevel = level;

	const log = (messageLevel: LogLevel, message: string) => {
		const formatted = `lineheat (${messageLevel}): ${message}`;
		messages.push(formatted);
		capArray(messages);
		if (logLevelWeight[messageLevel] <= logLevelWeight[currentLevel]) {
			output.appendLine(formatted);
		}
	};

	return {
		output,
		messages,
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
			capArray(lines);
			log('debug', entry);
		},
	};
};
