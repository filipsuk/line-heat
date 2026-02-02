import * as vscode from 'vscode';

import { hasRequiredSettings, readSettings } from './settings';
import { type LineHeatLogger } from './types';

const ONBOARDING_DISMISSED_KEY = 'lineheat.onboardingDismissed';
const ONBOARDING_LATER_TIMESTAMP_KEY = 'lineheat.onboardingLaterTimestamp';
const WALKTHROUGH_ID = 'filipsuk.lineheat-vscode#lineheat.getStarted';

const REMINDER_HOURS = 24;

export const checkAndShowOnboarding = async (
	context: vscode.ExtensionContext,
	logger: LineHeatLogger,
): Promise<void> => {
	const settings = readSettings();

	// Skip if already configured
	if (hasRequiredSettings(settings)) {
		return;
	}

	// Skip if user permanently dismissed onboarding
	const dismissed = context.globalState.get<boolean>(ONBOARDING_DISMISSED_KEY);
	if (dismissed) {
		return;
	}

	// Check if user clicked "Later" and if 24h have passed
	const laterTimestamp = context.globalState.get<number>(ONBOARDING_LATER_TIMESTAMP_KEY);
	if (laterTimestamp) {
		const hoursSinceLater = (Date.now() - laterTimestamp) / (1000 * 60 * 60);
		if (hoursSinceLater < REMINDER_HOURS) {
			logger.debug(`lineheat: onboarding:skip reason=reminder-cooldown hours=${hoursSinceLater.toFixed(1)}`);
			return;
		}
		// Clear the timestamp so we show the notification again
		await context.globalState.update(ONBOARDING_LATER_TIMESTAMP_KEY, undefined);
	}

	logger.info('lineheat: onboarding:show reason=not-configured');

	const selection = await vscode.window.showInformationMessage(
		'LineHeat: Set up your token to see who\'s working on the same code.',
		'Open Setup Guide',
		'Later',
		'Don\'t show again',
	);

	if (selection === 'Open Setup Guide') {
		logger.info('lineheat: onboarding:action=open-walkthrough');
		await openWalkthrough();
	} else if (selection === 'Later') {
		logger.info('lineheat: onboarding:action=later');
		await context.globalState.update(ONBOARDING_LATER_TIMESTAMP_KEY, Date.now());
	} else if (selection === 'Don\'t show again') {
		logger.info('lineheat: onboarding:action=dismissed');
		await context.globalState.update(ONBOARDING_DISMISSED_KEY, true);
	}
};

export const openWalkthrough = async (): Promise<void> => {
	await vscode.commands.executeCommand(
		'workbench.action.openWalkthrough',
		WALKTHROUGH_ID,
		false,
	);
};
