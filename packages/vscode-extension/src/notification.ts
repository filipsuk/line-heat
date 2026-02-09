import { formatRelativeTime } from './format';

export type NotificationInput = {
	otherPresenceUsers: Array<{ emoji: string; displayName: string }>;
	recentEditors: Array<{ emoji: string; displayName: string; lastEditAt: number }>;
	now: number;
	filename: string;
	functionName?: string;
	anchorLine?: number;
	decayMs?: number;
};

export type NotificationResult = {
	message: string;
	anchorLine: number;
};

/**
 * Extracts the last segment of a function path (the method name).
 * e.g., "ClassName/methodName" -> "methodName"
 *       "UserForm/Component/render" -> "render"
 *       "calculateTotal" -> "calculateTotal"
 */
const extractMethodName = (functionName: string): string => {
	const lastSlashIndex = functionName.lastIndexOf('/');
	if (lastSlashIndex >= 0) {
		return functionName.slice(lastSlashIndex + 1);
	}
	return functionName;
};

/**
 * Builds a notification message for presence or recent edit activity.
 *
 * @returns
 *   - `null` if no activity to notify about
 *   - `string` if no anchorLine provided (backward compat)
 *   - `NotificationResult` if anchorLine is provided (for navigation)
 */
export const buildNotificationMessage = (
	input: NotificationInput,
): string | NotificationResult | null => {
	const { otherPresenceUsers, now, filename, functionName, anchorLine, decayMs } = input;
	let { recentEditors } = input;

	// Filter editors by decay time if decayMs is provided
	if (decayMs !== undefined) {
		recentEditors = recentEditors.filter((e) => now - e.lastEditAt <= decayMs);
	}

	const hasOtherPresence = otherPresenceUsers.length > 0;
	const hasRecentActivity = recentEditors.length > 0;

	if (!hasOtherPresence && !hasRecentActivity) {
		return null;
	}

	// Extract only the method name from the function path
	const methodName = functionName ? extractMethodName(functionName) : undefined;

	let message: string;

	if (hasOtherPresence) {
		const userLabels = otherPresenceUsers
			.slice(0, 3)
			.map((u) => `${u.emoji} ${u.displayName}`)
			.join(', ');

		if (methodName) {
			// With function name: "is in `validateForm` in UserForm.ts"
			const verb = otherPresenceUsers.length === 1 ? 'is' : 'are';
			message = `LineHeat: ${userLabels} ${verb} in \`${methodName}\` in ${filename}.`;
		} else {
			// Without function name: "is also in UserForm.ts"
			const verb = otherPresenceUsers.length === 1 ? 'is' : 'are';
			message = `LineHeat: ${userLabels} ${verb} also in ${filename}.`;
		}
	} else {
		// Changes notification
		const editorLabels = recentEditors
			.slice(0, 3)
			.map((e) => `${e.emoji} ${e.displayName}`)
			.join(', ');

		// Find the most recent edit time
		const mostRecentEditAt = Math.max(...recentEditors.map((e) => e.lastEditAt));
		const timeAgo = formatRelativeTime(now, mostRecentEditAt);

		if (methodName) {
			// With function name: "made changes to `validateForm` in UserForm.ts 5m ago"
			message = `LineHeat: ${editorLabels} made changes to \`${methodName}\` in ${filename} ${timeAgo}.`;
		} else {
			// Without function name: "made changes in UserForm.ts 5m ago"
			message = `LineHeat: ${editorLabels} made changes in ${filename} ${timeAgo}.`;
		}
	}

	// Return object with anchorLine if provided, otherwise just string
	if (anchorLine !== undefined) {
		return { message, anchorLine };
	}

	return message;
};
