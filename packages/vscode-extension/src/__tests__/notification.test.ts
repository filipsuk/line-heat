import * as assert from 'assert';
import { buildNotificationMessage } from '../notification';

suite('notification utilities', function () {
	suite('buildNotificationMessage for presence', function () {
		test('returns null when no presence and no activity', () => {
			const result = buildNotificationMessage({
				otherPresenceUsers: [],
				recentEditors: [],
				now: Date.now(),
				filename: 'UserForm.ts',
			});
			assert.strictEqual(result, null);
		});

		test('returns singular message for one user with presence including filename', () => {
			const result = buildNotificationMessage({
				otherPresenceUsers: [{ emoji: '🦄', displayName: 'Alice' }],
				recentEditors: [],
				now: Date.now(),
				filename: 'UserForm.ts',
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice is also in UserForm.ts.');
		});

		test('returns singular message with function name when provided', () => {
			const result = buildNotificationMessage({
				otherPresenceUsers: [{ emoji: '🦄', displayName: 'Alice' }],
				recentEditors: [],
				now: Date.now(),
				filename: 'UserForm.ts',
				functionName: 'validateForm',
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice is in validateForm in UserForm.ts.');
		});

		test('returns plural message for two users with presence', () => {
			const result = buildNotificationMessage({
				otherPresenceUsers: [
					{ emoji: '🦄', displayName: 'Alice' },
					{ emoji: '🐱', displayName: 'Bob' },
				],
				recentEditors: [],
				now: Date.now(),
				filename: 'UserForm.ts',
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice, 🐱 Bob are also in UserForm.ts.');
		});

		test('returns plural message with function name when provided', () => {
			const result = buildNotificationMessage({
				otherPresenceUsers: [
					{ emoji: '🦄', displayName: 'Alice' },
					{ emoji: '🐱', displayName: 'Bob' },
				],
				recentEditors: [],
				now: Date.now(),
				filename: 'UserForm.ts',
				functionName: 'validateForm',
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice, 🐱 Bob are in validateForm in UserForm.ts.');
		});

		test('truncates to 3 users for presence', () => {
			const result = buildNotificationMessage({
				otherPresenceUsers: [
					{ emoji: '🦄', displayName: 'Alice' },
					{ emoji: '🐱', displayName: 'Bob' },
					{ emoji: '🐶', displayName: 'Carol' },
					{ emoji: '🦊', displayName: 'Dave' },
				],
				recentEditors: [],
				now: Date.now(),
				filename: 'UserForm.ts',
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice, 🐱 Bob, 🐶 Carol are also in UserForm.ts.');
		});
	});

	suite('buildNotificationMessage for changes', function () {
		test('returns singular message for one user with changes including filename', () => {
			const now = Date.now();
			const fiveMinutesAgo = now - 5 * 60 * 1000;
			const result = buildNotificationMessage({
				otherPresenceUsers: [],
				recentEditors: [{ emoji: '🦄', displayName: 'Alice', lastEditAt: fiveMinutesAgo }],
				now,
				filename: 'UserForm.ts',
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice made changes in UserForm.ts 5m ago.');
		});

		test('returns singular message with function name when provided', () => {
			const now = Date.now();
			const fiveMinutesAgo = now - 5 * 60 * 1000;
			const result = buildNotificationMessage({
				otherPresenceUsers: [],
				recentEditors: [{ emoji: '🦄', displayName: 'Alice', lastEditAt: fiveMinutesAgo }],
				now,
				filename: 'UserForm.ts',
				functionName: 'validateForm',
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice made changes to validateForm in UserForm.ts 5m ago.');
		});

		test('returns plural message for two users with changes showing most recent time', () => {
			const now = Date.now();
			const fiveMinutesAgo = now - 5 * 60 * 1000;
			const tenMinutesAgo = now - 10 * 60 * 1000;
			const result = buildNotificationMessage({
				otherPresenceUsers: [],
				recentEditors: [
					{ emoji: '🦄', displayName: 'Alice', lastEditAt: tenMinutesAgo },
					{ emoji: '🐱', displayName: 'Bob', lastEditAt: fiveMinutesAgo },
				],
				now,
				filename: 'UserForm.ts',
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice, 🐱 Bob made changes in UserForm.ts 5m ago.');
		});

		test('uses most recent time across all editors', () => {
			const now = Date.now();
			const twoMinutesAgo = now - 2 * 60 * 1000;
			const thirtyMinutesAgo = now - 30 * 60 * 1000;
			const oneHourAgo = now - 60 * 60 * 1000;
			const result = buildNotificationMessage({
				otherPresenceUsers: [],
				recentEditors: [
					{ emoji: '🦄', displayName: 'Alice', lastEditAt: oneHourAgo },
					{ emoji: '🐱', displayName: 'Bob', lastEditAt: twoMinutesAgo },
					{ emoji: '🐶', displayName: 'Carol', lastEditAt: thirtyMinutesAgo },
				],
				now,
				filename: 'UserForm.ts',
				functionName: 'submitHandler',
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice, 🐱 Bob, 🐶 Carol made changes to submitHandler in UserForm.ts 2m ago.');
		});

		test('shows "now" for very recent changes', () => {
			const now = Date.now();
			const tenSecondsAgo = now - 10 * 1000;
			const result = buildNotificationMessage({
				otherPresenceUsers: [],
				recentEditors: [{ emoji: '🦄', displayName: 'Alice', lastEditAt: tenSecondsAgo }],
				now,
				filename: 'UserForm.ts',
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice made changes in UserForm.ts now.');
		});

		test('truncates to 3 users for changes', () => {
			const now = Date.now();
			const fiveMinutesAgo = now - 5 * 60 * 1000;
			const result = buildNotificationMessage({
				otherPresenceUsers: [],
				recentEditors: [
					{ emoji: '🦄', displayName: 'Alice', lastEditAt: fiveMinutesAgo },
					{ emoji: '🐱', displayName: 'Bob', lastEditAt: fiveMinutesAgo },
					{ emoji: '🐶', displayName: 'Carol', lastEditAt: fiveMinutesAgo },
					{ emoji: '🦊', displayName: 'Dave', lastEditAt: fiveMinutesAgo },
				],
				now,
				filename: 'UserForm.ts',
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice, 🐱 Bob, 🐶 Carol made changes in UserForm.ts 5m ago.');
		});
	});

	suite('buildNotificationMessage priority', function () {
		test('presence takes priority over changes', () => {
			const now = Date.now();
			const fiveMinutesAgo = now - 5 * 60 * 1000;
			const result = buildNotificationMessage({
				otherPresenceUsers: [{ emoji: '🦄', displayName: 'Alice' }],
				recentEditors: [{ emoji: '🐱', displayName: 'Bob', lastEditAt: fiveMinutesAgo }],
				now,
				filename: 'UserForm.ts',
				functionName: 'validateForm',
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice is in validateForm in UserForm.ts.');
		});
	});

	suite('buildNotificationMessage returns navigation info', function () {
		test('returns anchorLine for navigation when provided', () => {
			const now = Date.now();
			const fiveMinutesAgo = now - 5 * 60 * 1000;
			const result = buildNotificationMessage({
				otherPresenceUsers: [],
				recentEditors: [{ emoji: '🦄', displayName: 'Alice', lastEditAt: fiveMinutesAgo }],
				now,
				filename: 'UserForm.ts',
				functionName: 'validateForm',
				anchorLine: 42,
			});
			assert.ok(result !== null && typeof result === 'object');
			assert.strictEqual(result.message, 'LineHeat: 🦄 Alice made changes to validateForm in UserForm.ts 5m ago.');
			assert.strictEqual(result.anchorLine, 42);
		});

		test('returns anchorLine for presence notification', () => {
			const result = buildNotificationMessage({
				otherPresenceUsers: [{ emoji: '🦄', displayName: 'Alice' }],
				recentEditors: [],
				now: Date.now(),
				filename: 'UserForm.ts',
				functionName: 'validateForm',
				anchorLine: 15,
			});
			assert.ok(result !== null && typeof result === 'object');
			assert.strictEqual(result.message, 'LineHeat: 🦄 Alice is in validateForm in UserForm.ts.');
			assert.strictEqual(result.anchorLine, 15);
		});

		test('returns string when no anchorLine provided (backward compatibility)', () => {
			const result = buildNotificationMessage({
				otherPresenceUsers: [{ emoji: '🦄', displayName: 'Alice' }],
				recentEditors: [],
				now: Date.now(),
				filename: 'UserForm.ts',
			});
			// When no anchorLine, returns just the string for backward compat
			assert.strictEqual(result, 'LineHeat: 🦄 Alice is also in UserForm.ts.');
		});
	});
});
