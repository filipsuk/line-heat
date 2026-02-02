import * as vscode from 'vscode';

import { hasRequiredSettings, readSettings } from './settings';
import { type LineHeatLogger, type LineHeatSettings } from './types';

export const ONBOARDING_DISMISSED_KEY = 'lineheat.onboardingDismissed';
export const ONBOARDING_LATER_TIMESTAMP_KEY = 'lineheat.onboardingLaterTimestamp';
export const WALKTHROUGH_ID = 'filipsuk.lineheat-vscode#lineheat.getStarted';
export const REMINDER_HOURS = 24;

export interface OnboardingDeps {
	getSettings: () => LineHeatSettings;
	hasRequiredSettings: (settings: LineHeatSettings) => boolean;
	showNotification: (
		message: string,
		...items: string[]
	) => Thenable<string | undefined>;
	executeCommand: (command: string, ...args: unknown[]) => Thenable<unknown>;
	now: () => number;
}

const defaultDeps: OnboardingDeps = {
	getSettings: readSettings,
	hasRequiredSettings,
	showNotification: vscode.window.showInformationMessage.bind(vscode.window),
	executeCommand: vscode.commands.executeCommand.bind(vscode.commands),
	now: () => Date.now(),
};

export const checkAndShowOnboarding = async (
	context: vscode.ExtensionContext,
	logger: LineHeatLogger,
	deps: OnboardingDeps = defaultDeps,
): Promise<void> => {
	const settings = deps.getSettings();

	// Skip if already configured (existing users with token set)
	if (deps.hasRequiredSettings(settings)) {
		logger.debug('lineheat: onboarding:skip reason=already-configured');
		return;
	}

	// Skip if user permanently dismissed onboarding
	const dismissed = context.globalState.get<boolean>(ONBOARDING_DISMISSED_KEY);
	if (dismissed) {
		logger.debug('lineheat: onboarding:skip reason=permanently-dismissed');
		return;
	}

	// Check if user clicked "Later" and if 24h have passed
	const laterTimestamp = context.globalState.get<number>(ONBOARDING_LATER_TIMESTAMP_KEY);
	if (laterTimestamp) {
		const hoursSinceLater = (deps.now() - laterTimestamp) / (1000 * 60 * 60);
		if (hoursSinceLater < REMINDER_HOURS) {
			logger.debug(`lineheat: onboarding:skip reason=reminder-cooldown hours=${hoursSinceLater.toFixed(1)}`);
			return;
		}
		// Clear the timestamp so we show the notification again
		await context.globalState.update(ONBOARDING_LATER_TIMESTAMP_KEY, undefined);
	}

	logger.info('lineheat: onboarding:show reason=not-configured');

	const selection = await deps.showNotification(
		'LineHeat: Set up your token to see who\'s working on the same code.',
		'Open Setup Guide',
		'Later',
		'Don\'t show again',
	);

	if (selection === 'Open Setup Guide') {
		logger.info('lineheat: onboarding:action=open-walkthrough');
		await openWalkthrough(deps);
	} else if (selection === 'Later') {
		logger.info('lineheat: onboarding:action=later');
		await context.globalState.update(ONBOARDING_LATER_TIMESTAMP_KEY, deps.now());
	} else if (selection === 'Don\'t show again') {
		logger.info('lineheat: onboarding:action=dismissed');
		await context.globalState.update(ONBOARDING_DISMISSED_KEY, true);
	}
};

export const openWalkthrough = async (deps: Pick<OnboardingDeps, 'executeCommand'> = defaultDeps): Promise<void> => {
	await deps.executeCommand(
		'workbench.action.openWalkthrough',
		WALKTHROUGH_ID,
		false,
	);
};
