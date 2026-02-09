export const encodeSymbolName = (name: string) => encodeURIComponent(name.trim());

export const formatFunctionLabel = (functionId: string) =>
	functionId
		.split('/')
		.map((segment) => {
			try {
				return decodeURIComponent(segment);
			} catch {
				return segment;
			}
		})
		.join('/');

export const formatRelativeTime = (now: number, timestamp: number) => {
	const diffMs = Math.max(0, now - timestamp);
	const seconds = Math.floor(diffMs / 1000);
	if (seconds < 60) {
		return 'now';
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
};

export const formatUserLabel = (user: { emoji: string; displayName: string }) =>
	`${user.emoji} ${user.displayName}`.trim();

export const computeHeatIntensity = (now: number, lastEditAt: number, decayMs: number) => {
	if (decayMs <= 0) {
		return 0;
	}
	const ageMs = Math.max(0, now - lastEditAt);
	return Math.min(1, Math.max(0, 1 - ageMs / decayMs));
};

export const getHeatEmojiFromIntensity = (intensity: number) => {
	if (intensity >= 0.75) {
		return '🔥🔥🔥';
	}
	if (intensity >= 0.5) {
		return '🔥🔥';
	}
	if (intensity >= 0.25) {
		return '🔥';
	}
	return '❄️';
};

export const formatTopLabels = (labels: string[], max: number) => {
	const top = labels.slice(0, max);
	const remaining = Math.max(0, labels.length - top.length);
	return top.length > 0
		? `${top.join(' ')}${remaining > 0 ? ` +${remaining}` : ''}`
		: '';
};
