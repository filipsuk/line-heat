import { formatRelativeTime } from './format';

export type NotificationInput = {
	otherPresenceUsers: Array<{ emoji: string; displayName: string }>;
	recentEditors: Array<{ emoji: string; displayName: string; lastEditAt: number }>;
	now: number;
	filename: string;
	functionName?: string;
	anchorLine?: number;
};

export type NotificationResult = {
	message: string;
	anchorLine: number;
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
	const { otherPresenceUsers, recentEditors, now, filename, functionName, anchorLine } = input;

	const hasOtherPresence = otherPresenceUsers.length > 0;
	const hasRecentActivity = recentEditors.length > 0;

	if (!hasOtherPresence && !hasRecentActivity) {
		return null;
	}

	let message: string;

	if (hasOtherPresence) {
		const userLabels = otherPresenceUsers
			.slice(0, 3)
			.map((u) => `${u.emoji} ${u.displayName}`)
			.join(', ');

		if (functionName) {
			// With function name: "is in validateForm in UserForm.ts"
			const verb = otherPresenceUsers.length === 1 ? 'is' : 'are';
			message = `LineHeat: ${userLabels} ${verb} in ${functionName} in ${filename}.`;
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

		if (functionName) {
			// With function name: "made changes to validateForm in UserForm.ts 5m ago"
			message = `LineHeat: ${editorLabels} made changes to ${functionName} in ${filename} ${timeAgo}.`;
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
