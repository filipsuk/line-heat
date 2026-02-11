import * as assert from 'assert';

import { createLogger, MAX_LOG_BUFFER } from '../logger';

suite('Logger buffer cap', function () {
	test('caps messages array at MAX_LOG_BUFFER', () => {
		const logger = createLogger('debug');
		for (let i = 0; i < MAX_LOG_BUFFER + 500; i++) {
			logger.info(`message ${i}`);
		}
		assert.ok(
			logger.messages.length <= MAX_LOG_BUFFER,
			`messages length ${logger.messages.length} exceeds cap ${MAX_LOG_BUFFER}`,
		);
		// oldest entries should have been trimmed, newest retained
		assert.ok(
			logger.messages[logger.messages.length - 1].includes(`message ${MAX_LOG_BUFFER + 499}`),
			'last message should be the most recent',
		);
		logger.output.dispose();
	});

	test('caps lines array at MAX_LOG_BUFFER', () => {
		const logger = createLogger('debug');
		for (let i = 0; i < MAX_LOG_BUFFER + 200; i++) {
			logger.logEdit(`file.ts:${i} functionId=fn${i} anchorLine=${i}`);
		}
		assert.ok(
			logger.lines.length <= MAX_LOG_BUFFER,
			`lines length ${logger.lines.length} exceeds cap ${MAX_LOG_BUFFER}`,
		);
		logger.output.dispose();
	});

	test('does not trim arrays below the cap', () => {
		const logger = createLogger('debug');
		for (let i = 0; i < 10; i++) {
			logger.info(`message ${i}`);
		}
		assert.strictEqual(logger.messages.length, 10);
		logger.output.dispose();
	});
});
