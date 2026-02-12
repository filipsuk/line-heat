import * as assert from 'assert';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { isFileGitIgnored } from '../repo';

const noopLogger = {
	output: {} as any,
	messages: [] as string[],
	lines: [] as string[],
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	setLevel: () => {},
	logEdit: () => {},
};

const runGit = (args: string[], cwd: string) =>
	new Promise<void>((resolve, reject) => {
		execFile('git', args, { cwd }, (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});

suite('isFileGitIgnored', function () {
	this.timeout(10_000);
	let tempDir: string;

	setup(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-gitignore-'));
		await runGit(['init'], tempDir);
		await runGit(['config', 'user.email', 'test@test.com'], tempDir);
		await runGit(['config', 'user.name', 'Test'], tempDir);
		await fs.writeFile(path.join(tempDir, '.gitignore'), 'ignored.txt\n*.log\nbuild/\n');
		await runGit(['add', '.gitignore'], tempDir);
		await runGit(['commit', '-m', 'init'], tempDir);
	});

	teardown(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test('returns true for a file matching .gitignore', async () => {
		const filePath = path.join(tempDir, 'ignored.txt');
		await fs.writeFile(filePath, 'content');
		assert.strictEqual(await isFileGitIgnored(filePath, noopLogger), true);
	});

	test('returns false for a file not in .gitignore', async () => {
		const filePath = path.join(tempDir, 'tracked.txt');
		await fs.writeFile(filePath, 'content');
		assert.strictEqual(await isFileGitIgnored(filePath, noopLogger), false);
	});

	test('returns true for a file matching a glob pattern in .gitignore', async () => {
		const filePath = path.join(tempDir, 'debug.log');
		await fs.writeFile(filePath, 'content');
		assert.strictEqual(await isFileGitIgnored(filePath, noopLogger), true);
	});

	test('returns true for a file inside a gitignored directory', async () => {
		await fs.mkdir(path.join(tempDir, 'build'), { recursive: true });
		const filePath = path.join(tempDir, 'build', 'output.js');
		await fs.writeFile(filePath, 'content');
		assert.strictEqual(await isFileGitIgnored(filePath, noopLogger), true);
	});

	test('returns false for a file outside a git repo', async () => {
		const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'no-git-'));
		const filePath = path.join(nonGitDir, 'file.txt');
		await fs.writeFile(filePath, 'content');
		try {
			assert.strictEqual(await isFileGitIgnored(filePath, noopLogger), false);
		} finally {
			await fs.rm(nonGitDir, { recursive: true, force: true });
		}
	});

	test('caches the result for repeated calls', async () => {
		const filePath = path.join(tempDir, 'ignored.txt');
		await fs.writeFile(filePath, 'content');
		const result1 = isFileGitIgnored(filePath, noopLogger);
		const result2 = isFileGitIgnored(filePath, noopLogger);
		assert.strictEqual(result1, result2);
		assert.strictEqual(await result1, true);
	});
});
