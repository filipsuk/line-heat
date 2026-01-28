import { context } from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildLogPlugin = {
	name: 'esbuild-log',
	setup(build) {
		build.onStart(() => {
			if (watch) {
				console.log('[watch] build started');
			}
		});
		build.onEnd((result) => {
			for (const { text, location } of result.errors) {
				console.error(`✘ [ERROR] ${text}`);
				if (location == null) continue;
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			}
			if (watch) {
				console.log('[watch] build finished');
			}
		});
	},
};

async function main() {
	const ctx = await context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'out/extension.js',
		external: ['vscode'],
		logLevel: 'warning',
		plugins: [esbuildLogPlugin],
	});

	if (watch) {
		await ctx.watch();
		return;
	}

	await ctx.rebuild();
	await ctx.dispose();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
