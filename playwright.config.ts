import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'e2e', timeout: 90000, webServer: process.env.BASE ? undefined : { command: 'npx vite preview --port 4173', port: 4173, reuseExistingServer: true } });
