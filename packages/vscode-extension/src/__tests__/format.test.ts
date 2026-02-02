import * as assert from 'assert';
import { formatRelativeTime } from '../format';

suite('format utilities', function () {
	test('formatRelativeTime returns "now" for timestamps less than 60 seconds ago', () => {
		const now = Date.now();
		
		// Test boundary cases for <60s
		assert.strictEqual(formatRelativeTime(now, now), 'now'); // 0s
		assert.strictEqual(formatRelativeTime(now, now - 1000), 'now'); // 1s
		assert.strictEqual(formatRelativeTime(now, now - 59000), 'now'); // 59s
	});

	test('formatRelativeTime returns minutes for timestamps between 60s and 59m 59s', () => {
		const now = Date.now();
		
		// Test boundary cases for minutes
		assert.strictEqual(formatRelativeTime(now, now - 60000), '1m ago'); // 60s = 1m
		assert.strictEqual(formatRelativeTime(now, now - 61000), '1m ago'); // 61s
		assert.strictEqual(formatRelativeTime(now, now - 3599000), '59m ago'); // 59m 59s
	});

	test('formatRelativeTime returns hours for timestamps between 60m and 23h 59m', () => {
		const now = Date.now();
		
		// Test boundary cases for hours
		assert.strictEqual(formatRelativeTime(now, now - 3600000), '1h ago'); // 60m = 1h
		assert.strictEqual(formatRelativeTime(now, now - 3660000), '1h ago'); // 61m
		assert.strictEqual(formatRelativeTime(now, now - 86340000), '23h ago'); // 23h 59m
	});

	test('formatRelativeTime returns days for timestamps 24h or more', () => {
		const now = Date.now();
		
		// Test boundary cases for days
		assert.strictEqual(formatRelativeTime(now, now - 86400000), '1d ago'); // 24h = 1d
		assert.strictEqual(formatRelativeTime(now, now - 90000000), '1d ago'); // 25h
		assert.strictEqual(formatRelativeTime(now, now - 172800000), '2d ago'); // 48h
	});

	test('formatRelativeTime handles future timestamps gracefully', () => {
		const now = Date.now();
		const future = now + 5000; // 5s in future
		
		// Should return "now" since diffMs will be 0 (Math.max(0, now - timestamp))
		assert.strictEqual(formatRelativeTime(now, future), 'now');
	});

	test('formatRelativeTime handles edge cases precisely', () => {
		const now = Date.now();
		
		// Exact boundary tests
		assert.strictEqual(formatRelativeTime(now, now - 59999), 'now'); // 59.999s
		assert.strictEqual(formatRelativeTime(now, now - 60000), '1m ago'); // exactly 60s
		assert.strictEqual(formatRelativeTime(now, now - 3599999), '59m ago'); // 59m 59.999s
		assert.strictEqual(formatRelativeTime(now, now - 3600000), '1h ago'); // exactly 60m
		assert.strictEqual(formatRelativeTime(now, now - 86399999), '23h ago'); // 23h 59m 59.999s
		assert.strictEqual(formatRelativeTime(now, now - 86400000), '1d ago'); // exactly 24h
	});
});