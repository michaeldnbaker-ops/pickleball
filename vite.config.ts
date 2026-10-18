import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
const BUILD = new Date().toISOString();
const version = { name: 'version-json', closeBundle() { try { writeFileSync('dist/version.json', JSON.stringify({ build: BUILD })); } catch { /* test runs */ } } };
export default defineConfig({ base: './', define: { __BUILD__: JSON.stringify(BUILD) }, plugins: [react(), version], test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'] } } as never);
