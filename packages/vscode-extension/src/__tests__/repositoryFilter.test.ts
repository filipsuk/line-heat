import * as assert from 'assert';
import { isRepositoryEnabled } from '../settings';

suite('repository filtering', function () {
	suite('isRepositoryEnabled', function () {
		test('returns true when patterns array is empty (default: all enabled)', () => {
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project', []), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/hobby', []), true);
			assert.strictEqual(isRepositoryEnabled('C:\\Users\\dev\\project', []), true);
		});

		test('returns true when repo path matches exact pattern', () => {
			const patterns = ['/home/user/work/project'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project', patterns), true);
		});

		test('returns false when repo path does not match any pattern', () => {
			const patterns = ['/home/user/work/*'];
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/hobby', patterns), false);
		});

		test('matches glob pattern with single wildcard', () => {
			const patterns = ['/home/user/work/*'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project-a', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project-b', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/hobby', patterns), false);
		});

		test('matches glob pattern with double wildcard (recursive)', () => {
			const patterns = ['/home/user/work/**'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/work/team/project', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/hobby', patterns), false);
		});

		test('matches glob pattern anywhere in path with **/', () => {
			const patterns = ['**/company-*'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work/company-api', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/projects/company-web', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/my-app', patterns), false);
		});

		test('matches glob pattern with ** at beginning and path after', () => {
			const patterns = ['**/company/*'];
			assert.strictEqual(isRepositoryEnabled('/home/user/company/project-a', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/work/company/api', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/other/project', patterns), false);
		});

		test('matches glob pattern with ** prefix for any nested path', () => {
			const patterns = ['**/work/**'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/work/team/nested/deep', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/var/work/app', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/project', patterns), false);
		});

		test('matches glob pattern with wildcard prefix for folder name', () => {
			const patterns = ['**/*-internal'];
			assert.strictEqual(isRepositoryEnabled('/home/user/api-internal', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/projects/web-internal', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/api-external', patterns), false);
		});

		test('matches multiple patterns (any match succeeds)', () => {
			const patterns = ['/home/user/work/*', '/home/user/client/*'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/client/app', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/hobby', patterns), false);
		});

		test('handles Windows-style paths', () => {
			const patterns = ['C:/Users/dev/work/*'];
			assert.strictEqual(isRepositoryEnabled('C:/Users/dev/work/project', patterns), true);
			assert.strictEqual(isRepositoryEnabled('C:/Users/dev/personal/app', patterns), false);
		});

		test('handles mixed path separators on Windows', () => {
			const patterns = ['C:/Users/dev/work/**'];
			// Backslashes should be normalized to forward slashes
			assert.strictEqual(isRepositoryEnabled('C:\\Users\\dev\\work\\project', patterns), true);
			assert.strictEqual(isRepositoryEnabled('C:\\Users\\dev\\personal\\app', patterns), false);
		});

		test('handles case sensitivity appropriately', () => {
			const patterns = ['/home/user/Work/*'];
			// On Unix, paths are case-sensitive
			// The function should match case-sensitively by default
			assert.strictEqual(isRepositoryEnabled('/home/user/Work/project', patterns), true);
		});

		test('handles trailing slashes in patterns and paths', () => {
			const patterns = ['/home/user/work/'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/work/', patterns), true);
		});

		test('handles empty repo path gracefully', () => {
			const patterns = ['/home/user/work/*'];
			assert.strictEqual(isRepositoryEnabled('', patterns), false);
		});

		test('handles patterns with special characters', () => {
			const patterns = ['/home/user/my-work/**'];
			assert.strictEqual(isRepositoryEnabled('/home/user/my-work/project', patterns), true);
		});
	});
});
