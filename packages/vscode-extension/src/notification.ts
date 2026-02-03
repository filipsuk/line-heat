import { formatRelativeTime } from './format';

export type NotificationInput = {
	otherPresenceUsers: Array<{ emoji: string; displayName: string }>;
	recentEditors: Array<{ emoji: string; displayName: string; lastEditAt: number }>;
	now: number;
};

export const buildNotificationMessage = (input: NotificationInput): string | null => {
	const { otherPresenceUsers, recentEditors, now } = input;

	const hasOtherPresence = otherPresenceUsers.length > 0;
	const hasRecentActivity = recentEditors.length > 0;

	if (!hasOtherPresence && !hasRecentActivity) {
		return null;
	}

	if (hasOtherPresence) {
		const userLabels = otherPresenceUsers
			.slice(0, 3)
			.map((u) => `${u.emoji} ${u.displayName}`)
			.join(', ');
		const verb = otherPresenceUsers.length === 1 ? 'is' : 'are';
		return `LineHeat: ${userLabels} ${verb} also in this file.`;
	}

	// Changes notification
	const editorLabels = recentEditors
		.slice(0, 3)
		.map((e) => `${e.emoji} ${e.displayName}`)
		.join(', ');

	// Find the most recent edit time
	const mostRecentEditAt = Math.max(...recentEditors.map((e) => e.lastEditAt));
	const timeAgo = formatRelativeTime(now, mostRecentEditAt);

	const verb = recentEditors.length === 1 ? 'made changes' : 'made changes';
	return `LineHeat: ${editorLabels} ${verb} in this file ${timeAgo}.`;
};
