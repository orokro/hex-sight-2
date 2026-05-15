/*
 * vite.config.js
 * Vite configuration for the hex-sight-game-2 vanilla-JS + Three.js project.
 */

import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	server: {
		// Large model files (~18 MB VRM) — bump the asset size budget so dev
		// server stops emitting noisy warnings.
		fs: { strict: false },
	},
});
