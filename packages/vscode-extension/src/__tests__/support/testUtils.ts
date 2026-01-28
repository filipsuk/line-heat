import { execFile } from 'child_process';
import * as vscode from 'vscode';

export type ExtensionApi = {
	logger: {
		lines: string[];
		messages: string[];
	};
};

type CdpTarget = {
	id: string;
	title?: string;
	type?: string;
	url?: string;
	webSocketDebuggerUrl?: string;
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitFor = async (condition: () => boolean, timeoutMs: number, context?: string) => {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (condition()) {
			return;
		}
		await sleep(25);
	}
	throw new Error(`Timed out waiting for condition${context ? `: ${context}` : ''}`);
};

export const waitForAsync = async (
	condition: () => Promise<boolean>,
	timeoutMs: number,
	context?: string,
) => {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await condition()) {
			return;
		}
		await sleep(50);
	}
	throw new Error(`Timed out waiting for condition${context ? `: ${context}` : ''}`);
};

export const runGit = async (args: string[], cwd: string) =>
	new Promise<void>((resolve, reject) => {
		execFile('git', args, { cwd }, (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});

export const editAndWaitForLog = async (
	api: ExtensionApi,
	editor: vscode.TextEditor,
	position: vscode.Position,
	text: string,
	expectedEntry: string,
) => {
	const before = api.logger.lines.length;
	await editor.edit((editBuilder) => {
		editBuilder.insert(position, text);
	});
	await waitFor(() => api.logger.lines.length > before, 4000);
	await waitFor(
		() => api.logger.lines.includes(expectedEntry),
		4000,
		`expected entry "${expectedEntry}" not found. Last 20 log entries:\n${api.logger.lines
			.slice(-20)
			.join('\n')}`,
	);
};

const httpGetJson = async <T>(url: string): Promise<T> => {
	const fetchImpl = (globalThis as any).fetch as undefined | ((...args: any[]) => Promise<any>);
	if (fetchImpl) {
		const response = await fetchImpl(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} for ${url}`);
		}
		return (await response.json()) as T;
	}

	const http = await import('node:http');
	return await new Promise<T>((resolve, reject) => {
		const request = http.request(url, (res) => {
			let data = '';
			res.setEncoding('utf8');
			res.on('data', (chunk) => {
				data += chunk;
			});
			res.on('end', () => {
				try {
					resolve(JSON.parse(data) as T);
				} catch (error) {
					reject(error);
				}
			});
		});
		request.on('error', reject);
		request.end();
	});
};

const pickWorkbenchTarget = (targets: CdpTarget[]): CdpTarget | undefined => {
	const candidates = targets.filter((target) => Boolean(target.webSocketDebuggerUrl));
	const byUrl = candidates.filter((target) => (target.url ?? '').includes('workbench'));
	if (byUrl.length > 0) {
		return byUrl[0];
	}
	const byTitle = candidates.filter((target) =>
		(target.title ?? '').toLowerCase().includes('visual studio code'),
	);
	if (byTitle.length > 0) {
		return byTitle[0];
	}
	return candidates[0];
};

export const cdpCaptureScreenshotPng = async (params: { port: number }): Promise<Buffer> => {
	const targets = await httpGetJson<CdpTarget[]>(`http://127.0.0.1:${params.port}/json/list`);
	const target = pickWorkbenchTarget(targets);
	if (!target?.webSocketDebuggerUrl) {
		throw new Error(
			`Unable to find CDP target. Ensure VS Code started with --remote-debugging-port=${params.port}. ` +
				`Targets seen: ${targets.map((t) => `${t.type ?? '?'} ${(t.url ?? '').slice(0, 60)}`).join(' | ')}`,
		);
	}

	const WebSocketImpl = (globalThis as any).WebSocket as any;
	if (!WebSocketImpl) {
		throw new Error('WebSocket is not available in this Node runtime (required for CDP).');
	}

	const ws = new WebSocketImpl(target.webSocketDebuggerUrl);
	const pending = new Map<number, { resolve: (value: any) => void; reject: (err: unknown) => void }>();
	let nextId = 1;

	const waitOpen = new Promise<void>((resolve, reject) => {
		ws.onopen = () => resolve();
		ws.onerror = (event: unknown) => reject(event);
	});

	ws.onmessage = (event: any) => {
		try {
			const message = JSON.parse(String(event.data));
			if (typeof message.id === 'number') {
				const entry = pending.get(message.id);
				if (!entry) {
					return;
				}
				pending.delete(message.id);
				if (message.error) {
					entry.reject(new Error(message.error.message ?? 'CDP error'));
					return;
				}
				entry.resolve(message.result);
			}
		} catch {
			// ignore
		}
	};

	const send = async <T>(method: string, wsParams?: Record<string, unknown>): Promise<T> => {
		const id = nextId++;
		const payload = { id, method, params: wsParams };
		return await new Promise<T>((resolve, reject) => {
			pending.set(id, { resolve, reject });
			ws.send(JSON.stringify(payload));
		});
	};

	await waitOpen;
	await send('Page.enable');
	const result = await send<{ data: string }>('Page.captureScreenshot', {
		format: 'png',
		fromSurface: true,
	});
	ws.close();

	return Buffer.from(result.data, 'base64');
};
