import { build } from 'esbuild';

await build({
	entryPoints: ['src/extension.ts'],
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: ['node16'],
	outfile: 'out/extension.js',
	sourcemap: true,
	external: ['vscode'],
});
