import * as assert from 'assert';
import { buildNotificationMessage } from '../notification';

suite('notification utilities', function () {
	suite('buildNotificationMessage for presence', function () {
		test('returns null when no presence and no activity', () => {
			const result = buildNotificationMessage({
				otherPresenceUsers: [],
				recentEditors: [],
				now: Date.now(),
			});
			assert.strictEqual(result, null);
		});

		test('returns singular message for one user with presence', () => {
			const result = buildNotificationMessage({
				otherPresenceUsers: [{ emoji: '🦄', displayName: 'Alice' }],
				recentEditors: [],
				now: Date.now(),
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice is also in this file.');
		});

		test('returns plural message for two users with presence', () => {
			const result = buildNotificationMessage({
				otherPresenceUsers: [
					{ emoji: '🦄', displayName: 'Alice' },
					{ emoji: '🐱', displayName: 'Bob' },
				],
				recentEditors: [],
				now: Date.now(),
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice, 🐱 Bob are also in this file.');
		});

		test('returns plural message for three users with presence', () => {
			const result = buildNotificationMessage({
				otherPresenceUsers: [
					{ emoji: '🦄', displayName: 'Alice' },
					{ emoji: '🐱', displayName: 'Bob' },
					{ emoji: '🐶', displayName: 'Carol' },
				],
				recentEditors: [],
				now: Date.now(),
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice, 🐱 Bob, 🐶 Carol are also in this file.');
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
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice, 🐱 Bob, 🐶 Carol are also in this file.');
		});
	});

	suite('buildNotificationMessage for changes', function () {
		test('returns singular message for one user with changes', () => {
			const now = Date.now();
			const fiveMinutesAgo = now - 5 * 60 * 1000;
			const result = buildNotificationMessage({
				otherPresenceUsers: [],
				recentEditors: [{ emoji: '🦄', displayName: 'Alice', lastEditAt: fiveMinutesAgo }],
				now,
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice made changes in this file 5m ago.');
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
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice, 🐱 Bob made changes in this file 5m ago.');
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
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice, 🐱 Bob, 🐶 Carol made changes in this file 2m ago.');
		});

		test('shows "now" for very recent changes', () => {
			const now = Date.now();
			const tenSecondsAgo = now - 10 * 1000;
			const result = buildNotificationMessage({
				otherPresenceUsers: [],
				recentEditors: [{ emoji: '🦄', displayName: 'Alice', lastEditAt: tenSecondsAgo }],
				now,
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice made changes in this file now.');
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
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice, 🐱 Bob, 🐶 Carol made changes in this file 5m ago.');
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
			});
			assert.strictEqual(result, 'LineHeat: 🦄 Alice is also in this file.');
		});
	});
});
