import * as assert from 'assert';
import picomatch from 'picomatch';

// Pure function copied for unit testing without VSCode dependencies
const normalizePath = (path: string): string => {
	let normalized = path.replace(/\\/g, '/');
	if (normalized.endsWith('/') && normalized.length > 1) {
		normalized = normalized.slice(0, -1);
	}
	return normalized;
};

const isRepositoryEnabled = (repoPath: string, patterns: string[]): boolean => {
	if (patterns.length === 0) {
		return true;
	}
	if (!repoPath) {
		return false;
	}
	const normalizedRepoPath = normalizePath(repoPath);
	for (const pattern of patterns) {
		const normalizedPattern = normalizePath(pattern);
		const isMatch = picomatch.isMatch(normalizedRepoPath, normalizedPattern, {
			dot: true,
		});
		if (isMatch) {
			return true;
		}
	}
	return false;
};

describe('repository filtering', function () {
	describe('isRepositoryEnabled', function () {
		it('returns true when patterns array is empty (default: all enabled)', () => {
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project', []), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/hobby', []), true);
			assert.strictEqual(isRepositoryEnabled('C:\\Users\\dev\\project', []), true);
		});

		it('returns true when repo path matches exact pattern', () => {
			const patterns = ['/home/user/work/project'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project', patterns), true);
		});

		it('returns false when repo path does not match any pattern', () => {
			const patterns = ['/home/user/work/*'];
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/hobby', patterns), false);
		});

		it('matches glob pattern with single wildcard', () => {
			const patterns = ['/home/user/work/*'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project-a', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project-b', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/hobby', patterns), false);
		});

		it('matches glob pattern with double wildcard (recursive)', () => {
			const patterns = ['/home/user/work/**'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/work/team/project', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/hobby', patterns), false);
		});

		it('matches glob pattern anywhere in path with **/', () => {
			const patterns = ['**/company-*'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work/company-api', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/projects/company-web', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/my-app', patterns), false);
		});

		it('matches multiple patterns (any match succeeds)', () => {
			const patterns = ['/home/user/work/*', '/home/user/client/*'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work/project', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/client/app', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/personal/hobby', patterns), false);
		});

		it('handles Windows-style paths', () => {
			const patterns = ['C:/Users/dev/work/*'];
			assert.strictEqual(isRepositoryEnabled('C:/Users/dev/work/project', patterns), true);
			assert.strictEqual(isRepositoryEnabled('C:/Users/dev/personal/app', patterns), false);
		});

		it('handles mixed path separators on Windows', () => {
			const patterns = ['C:/Users/dev/work/**'];
			assert.strictEqual(isRepositoryEnabled('C:\\Users\\dev\\work\\project', patterns), true);
			assert.strictEqual(isRepositoryEnabled('C:\\Users\\dev\\personal\\app', patterns), false);
		});

		it('handles case sensitivity appropriately', () => {
			const patterns = ['/home/user/Work/*'];
			assert.strictEqual(isRepositoryEnabled('/home/user/Work/project', patterns), true);
		});

		it('handles trailing slashes in patterns and paths', () => {
			const patterns = ['/home/user/work/'];
			assert.strictEqual(isRepositoryEnabled('/home/user/work', patterns), true);
			assert.strictEqual(isRepositoryEnabled('/home/user/work/', patterns), true);
		});

		it('handles empty repo path gracefully', () => {
			const patterns = ['/home/user/work/*'];
			assert.strictEqual(isRepositoryEnabled('', patterns), false);
		});

		it('handles patterns with special characters', () => {
			const patterns = ['/home/user/my-work/**'];
			assert.strictEqual(isRepositoryEnabled('/home/user/my-work/project', patterns), true);
		});
	});
});
