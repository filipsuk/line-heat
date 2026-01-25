import * as assert from 'assert';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

type ExtensionApi = {
	logger: {
		lines: string[];
	};
};

const waitFor = async (condition: () => boolean, timeoutMs: number) => {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error('Timed out waiting for condition');
};

const runGit = async (args: string[], cwd: string) =>
	new Promise<void>((resolve, reject) => {
		execFile('git', args, { cwd }, (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});

const editAndWaitForLog = async (
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
	await waitFor(() => api.logger.lines.includes(expectedEntry), 4000);
};

suite('Line Heat Extension', function () {
	this.timeout(10000);
	test('logs changed line number across open files', async () => {
		const extension = vscode.extensions.getExtension<ExtensionApi>('lineheat.vscode-extension');
		assert.ok(extension, 'Extension not found');

		const api = await extension?.activate();
		assert.ok(api?.logger, 'Extension did not return logger');

		api?.logger.lines.splice(0, api.logger.lines.length);

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-'));
		try {
			const dirA = path.join(tempDir, 'alpha');
			const dirB = path.join(tempDir, 'beta');
			await runGit(['init'], tempDir);
			await runGit(['remote', 'add', 'origin', 'https://github.com/Acme/LineHeat.git'], tempDir);
			await fs.mkdir(dirA, { recursive: true });
			await fs.mkdir(dirB, { recursive: true });

			const fileAPath = path.join(dirA, 'one.txt');
			const fileBPath = path.join(dirB, 'two.txt');
			const fileAUri = vscode.Uri.file(fileAPath);
			const fileBUri = vscode.Uri.file(fileBPath);

			await fs.writeFile(fileAPath, 'first\nsecond\nthird\n', 'utf8');
			await fs.writeFile(fileBPath, 'uno\ndos\ntres\n', 'utf8');

			const docA = await vscode.workspace.openTextDocument(fileAUri);
			const docB = await vscode.workspace.openTextDocument(fileBUri);

			const editorA = await vscode.window.showTextDocument(docA, { preview: false });
			const expectedA1 = `${fileAUri.fsPath}:2`;
			await editAndWaitForLog(api, editorA, new vscode.Position(1, 0), 'edit ', expectedA1);

			const editorB = await vscode.window.showTextDocument(docB, { preview: false });
			const expectedB1 = `${fileBUri.fsPath}:1`;
			await editAndWaitForLog(api, editorB, new vscode.Position(0, 0), 'change ', expectedB1);

			const editorA2 = await vscode.window.showTextDocument(docA, { preview: false });
			const expectedA2 = `${fileAUri.fsPath}:3`;
			await editAndWaitForLog(api, editorA2, new vscode.Position(2, 0), 'update ', expectedA2);

			const expectedEntries = [expectedA1, expectedB1, expectedA2];
			for (const entry of expectedEntries) {
				assert.ok(api?.logger.lines.includes(entry), `Missing log entry: ${entry}`);
			}
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
