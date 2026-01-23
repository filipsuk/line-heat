import * as vscode from 'vscode';

type LineHeatLogger = {
	output: vscode.OutputChannel;
	lines: string[];
	log: (entry: string) => void;
};

let activeLogger: LineHeatLogger | undefined;

const createLogger = (): LineHeatLogger => {
	const output = vscode.window.createOutputChannel('Line Heat');
	const lines: string[] = [];
	return {
		output,
		lines,
		log: (entry: string) => {
			lines.push(entry);
			output.appendLine(entry);
		},
	};
};

export function activate(context: vscode.ExtensionContext) {
	const logger = createLogger();
	activeLogger = logger;

	const disposable = vscode.workspace.onDidChangeTextDocument((event) => {
		if (event.contentChanges.length === 0) {
			return;
		}

		const filePath = event.document.uri.fsPath || event.document.uri.toString();
		const changedLines = new Set<number>();
		for (const change of event.contentChanges) {
			changedLines.add(change.range.start.line + 1);
		}

		for (const line of changedLines) {
			logger.log(`${filePath}:${line}`);
		}
	});

	context.subscriptions.push(logger.output, disposable);
	return { logger };
}

export function getLoggerForTests(): LineHeatLogger | undefined {
	return activeLogger;
}

export function deactivate() {
	activeLogger = undefined;
}
