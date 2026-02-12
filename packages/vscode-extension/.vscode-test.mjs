import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/__tests__/**/*.test.js',
	launchArgs: [
		'--disable-extensions',
		'--disable-gpu',
		'--remote-debugging-address=127.0.0.1',
		`--remote-debugging-port=${process.env.VSCODE_REMOTE_DEBUGGING_PORT ?? '9222'}`,
	],
});
