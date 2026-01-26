import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/__tests__/**/*.test.js',
	mocha: {
		ui: 'tdd',
		timeout: 10000,
		grep: ''
	}
});
