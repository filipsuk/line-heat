import * as assert from 'assert';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { listTrackedFiles } from '../repo';

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

suite('listTrackedFiles excludes gitignored files', function () {
	this.timeout(10_000);
	let tempDir: string;

	setup(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'line-heat-gitignore-'));
		await runGit(['init'], tempDir);
		await runGit(['config', 'user.email', 'test@test.com'], tempDir);
		await runGit(['config', 'user.name', 'Test'], tempDir);
		await fs.writeFile(path.join(tempDir, '.gitignore'), 'ignored.txt\n*.log\nbuild/\n');
		await fs.writeFile(path.join(tempDir, 'tracked.txt'), 'content');
		await runGit(['add', '.'], tempDir);
		await runGit(['commit', '-m', 'init'], tempDir);
	});

	teardown(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test('includes tracked files', async () => {
		const files = await listTrackedFiles(tempDir, noopLogger);
		const names = files.map((f) => path.basename(f));
		assert.ok(names.includes('tracked.txt'));
		assert.ok(names.includes('.gitignore'));
	});

	test('excludes file matching exact .gitignore entry', async () => {
		await fs.writeFile(path.join(tempDir, 'ignored.txt'), 'content');
		const files = await listTrackedFiles(tempDir, noopLogger);
		const names = files.map((f) => path.basename(f));
		assert.ok(!names.includes('ignored.txt'));
	});

	test('excludes file matching glob pattern in .gitignore', async () => {
		await fs.writeFile(path.join(tempDir, 'debug.log'), 'content');
		const files = await listTrackedFiles(tempDir, noopLogger);
		const names = files.map((f) => path.basename(f));
		assert.ok(!names.includes('debug.log'));
	});

	test('excludes file inside gitignored directory', async () => {
		await fs.mkdir(path.join(tempDir, 'build'), { recursive: true });
		await fs.writeFile(path.join(tempDir, 'build', 'output.js'), 'content');
		const files = await listTrackedFiles(tempDir, noopLogger);
		const names = files.map((f) => path.basename(f));
		assert.ok(!names.includes('output.js'));
	});

	test('returns empty array outside a git repo', async () => {
		const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), 'no-git-'));
		try {
			const files = await listTrackedFiles(nonGitDir, noopLogger);
			assert.strictEqual(files.length, 0);
		} finally {
			await fs.rm(nonGitDir, { recursive: true, force: true });
		}
	});
});
