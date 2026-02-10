import * as assert from 'assert';

import {
	checkAndShowOnboarding,
	openSettings,
	ONBOARDING_DISMISSED_KEY,
	ONBOARDING_LATER_TIMESTAMP_KEY,
	REMINDER_HOURS,
	type OnboardingDeps,
} from '../onboarding';
import { type LineHeatLogger, type LineHeatSettings } from '../types';

const createMockLogger = (): LineHeatLogger & { logs: string[] } => {
	const logs: string[] = [];
	const messages: string[] = [];
	const lines: string[] = [];
	return {
		logs,
		messages,
		lines,
		output: {} as LineHeatLogger['output'],
		debug: (msg: string) => { logs.push(`debug: ${msg}`); },
		info: (msg: string) => { logs.push(`info: ${msg}`); },
		warn: (msg: string) => { logs.push(`warn: ${msg}`); },
		error: (msg: string) => { logs.push(`error: ${msg}`); },
		setLevel: () => {},
		logEdit: () => {},
	};
};

const createMockContext = (initialState: Record<string, unknown> = {}) => {
	const state = new Map<string, unknown>(Object.entries(initialState));
	return {
		globalState: {
			get: <T>(key: string): T | undefined => state.get(key) as T | undefined,
			update: async (key: string, value: unknown) => {
				if (value === undefined) {
					state.delete(key);
				} else {
					state.set(key, value);
				}
			},
			keys: () => Array.from(state.keys()),
		},
		_state: state,
	};
};

const createMockSettings = (overrides: Partial<LineHeatSettings> = {}): LineHeatSettings => ({
	serverUrl: 'https://example.com',
	token: '',
	displayName: 'testuser',
	emoji: '🙂',
	heatDecayHours: 72,
	logLevel: 'info',
	presenceNotificationCooldownMinutes: 15,
	enabledRepositories: [],
	explorerDecorations: true,
	...overrides,
});

const createMockDeps = (overrides: Partial<OnboardingDeps> = {}): OnboardingDeps => ({
	getSettings: () => createMockSettings(),
	hasRequiredSettings: (settings) => settings.serverUrl.length > 0 && settings.token.length > 0,
	showNotification: async () => undefined,
	executeCommand: async () => undefined,
	now: () => Date.now(),
	...overrides,
});

suite('onboarding', function () {
	suite('checkAndShowOnboarding', function () {
		test('does not show notification when token is already configured (existing user)', async () => {
			const logger = createMockLogger();
			const context = createMockContext();
			let notificationShown = false;

			const deps = createMockDeps({
				getSettings: () => createMockSettings({ token: 'my-token' }),
				showNotification: async () => {
					notificationShown = true;
					return undefined;
				},
			});

			await checkAndShowOnboarding(context as any, logger, deps);

			assert.strictEqual(notificationShown, false, 'Notification should not be shown for configured users');
			assert.ok(
				logger.logs.some((log) => log.includes('already-configured')),
				'Should log skip reason as already-configured'
			);
		});

		test('shows notification when token is not configured (new user)', async () => {
			const logger = createMockLogger();
			const context = createMockContext();
			let notificationShown = false;

			const deps = createMockDeps({
				getSettings: () => createMockSettings({ token: '' }),
				showNotification: async () => {
					notificationShown = true;
					return undefined;
				},
			});

			await checkAndShowOnboarding(context as any, logger, deps);

			assert.strictEqual(notificationShown, true, 'Notification should be shown for new users');
			assert.ok(
				logger.logs.some((log) => log.includes('not-configured')),
				'Should log show reason as not-configured'
			);
		});

		test('does not show notification when permanently dismissed', async () => {
			const logger = createMockLogger();
			const context = createMockContext({
				[ONBOARDING_DISMISSED_KEY]: true,
			});
			let notificationShown = false;

			const deps = createMockDeps({
				showNotification: async () => {
					notificationShown = true;
					return undefined;
				},
			});

			await checkAndShowOnboarding(context as any, logger, deps);

			assert.strictEqual(notificationShown, false, 'Notification should not be shown when dismissed');
			assert.ok(
				logger.logs.some((log) => log.includes('permanently-dismissed')),
				'Should log skip reason as permanently-dismissed'
			);
		});

		test('does not show notification within 24 hours of clicking Later', async () => {
			const logger = createMockLogger();
			const now = Date.now();
			const twelveHoursAgo = now - 12 * 60 * 60 * 1000;

			const context = createMockContext({
				[ONBOARDING_LATER_TIMESTAMP_KEY]: twelveHoursAgo,
			});
			let notificationShown = false;

			const deps = createMockDeps({
				now: () => now,
				showNotification: async () => {
					notificationShown = true;
					return undefined;
				},
			});

			await checkAndShowOnboarding(context as any, logger, deps);

			assert.strictEqual(notificationShown, false, 'Notification should not be shown within 24h cooldown');
			assert.ok(
				logger.logs.some((log) => log.includes('reminder-cooldown')),
				'Should log skip reason as reminder-cooldown'
			);
		});

		test('shows notification after 24 hours of clicking Later', async () => {
			const logger = createMockLogger();
			const now = Date.now();
			const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000;

			const context = createMockContext({
				[ONBOARDING_LATER_TIMESTAMP_KEY]: twentyFiveHoursAgo,
			});
			let notificationShown = false;

			const deps = createMockDeps({
				now: () => now,
				showNotification: async () => {
					notificationShown = true;
					return undefined;
				},
			});

			await checkAndShowOnboarding(context as any, logger, deps);

			assert.strictEqual(notificationShown, true, 'Notification should be shown after 24h cooldown');
			// Timestamp should be cleared
			assert.strictEqual(
				context.globalState.get(ONBOARDING_LATER_TIMESTAMP_KEY),
				undefined,
				'Later timestamp should be cleared'
			);
		});

		test('opens settings when user clicks "Open Settings"', async () => {
			const logger = createMockLogger();
			const context = createMockContext();
			let settingsOpened = false;
			let executedCommand = '';
			let executedArgs: unknown[] = [];

			const deps = createMockDeps({
				showNotification: async () => 'Open Settings',
				executeCommand: async (command: string, ...args: unknown[]) => {
					executedCommand = command;
					executedArgs = args;
					settingsOpened = true;
				},
			});

			await checkAndShowOnboarding(context as any, logger, deps);

			assert.strictEqual(settingsOpened, true, 'Settings should be opened');
			assert.strictEqual(executedCommand, 'workbench.action.openSettings');
			assert.strictEqual(executedArgs[0], 'lineheat.');
			assert.ok(
				logger.logs.some((log) => log.includes('open-settings')),
				'Should log action as open-settings'
			);
		});

		test('stores timestamp when user clicks "Later"', async () => {
			const logger = createMockLogger();
			const context = createMockContext();
			const now = 1700000000000;

			const deps = createMockDeps({
				now: () => now,
				showNotification: async () => 'Later',
			});

			await checkAndShowOnboarding(context as any, logger, deps);

			assert.strictEqual(
				context.globalState.get(ONBOARDING_LATER_TIMESTAMP_KEY),
				now,
				'Should store current timestamp'
			);
			assert.ok(
				logger.logs.some((log) => log.includes('action=later')),
				'Should log action as later'
			);
		});

		test('sets dismissed flag when user clicks "Don\'t show again"', async () => {
			const logger = createMockLogger();
			const context = createMockContext();

			const deps = createMockDeps({
				showNotification: async () => 'Don\'t show again',
			});

			await checkAndShowOnboarding(context as any, logger, deps);

			assert.strictEqual(
				context.globalState.get(ONBOARDING_DISMISSED_KEY),
				true,
				'Should set dismissed flag to true'
			);
			assert.ok(
				logger.logs.some((log) => log.includes('action=dismissed')),
				'Should log action as dismissed'
			);
		});

		test('does nothing when user dismisses notification without selection', async () => {
			const logger = createMockLogger();
			const context = createMockContext();

			const deps = createMockDeps({
				showNotification: async () => undefined,
			});

			await checkAndShowOnboarding(context as any, logger, deps);

			assert.strictEqual(
				context.globalState.get(ONBOARDING_DISMISSED_KEY),
				undefined,
				'Should not set dismissed flag'
			);
			assert.strictEqual(
				context.globalState.get(ONBOARDING_LATER_TIMESTAMP_KEY),
				undefined,
				'Should not set later timestamp'
			);
		});

		test('respects exact 24 hour boundary for reminder', async () => {
			const logger = createMockLogger();
			const now = Date.now();

			// Exactly 24 hours ago - should NOT show (need to exceed, not equal)
			const exactly24HoursAgo = now - REMINDER_HOURS * 60 * 60 * 1000;
			const context = createMockContext({
				[ONBOARDING_LATER_TIMESTAMP_KEY]: exactly24HoursAgo,
			});
			let notificationShown = false;

			const deps = createMockDeps({
				now: () => now,
				showNotification: async () => {
					notificationShown = true;
					return undefined;
				},
			});

			await checkAndShowOnboarding(context as any, logger, deps);

			// At exactly 24 hours, hoursSinceLater < REMINDER_HOURS is false (24 < 24 is false)
			// So notification SHOULD be shown
			assert.strictEqual(notificationShown, true, 'Notification should be shown at exactly 24h boundary');
		});
	});

	suite('openSettings', function () {
		test('executes openSettings command with lineheat query', async () => {
			let executedCommand = '';
			let executedArgs: unknown[] = [];

			const deps = {
				executeCommand: async (command: string, ...args: unknown[]) => {
					executedCommand = command;
					executedArgs = args;
				},
			};

			await openSettings(deps);

			assert.strictEqual(executedCommand, 'workbench.action.openSettings');
			assert.strictEqual(executedArgs[0], 'lineheat.');
		});
	});

	suite('constants', function () {
		test('REMINDER_HOURS is 24', () => {
			assert.strictEqual(REMINDER_HOURS, 24);
		});
	});
});
