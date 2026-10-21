import { defineConfig, devices } from '@playwright/test';

const base = process.env.VITE_BASE && process.env.VITE_BASE !== './' ? process.env.VITE_BASE : '/';
// Cloud sessions ship a Chromium that may not match the installed @playwright/test.
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  // Every test stands alone, so CI's shards split them evenly, not by whole files.
  fullyParallel: true,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:4173${base}`,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    // Plain English: metric units (a test switches to en-US for miles).
    locale: 'en',
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    {
      name: 'dark',
      grep: /renders|searches/,
      use: { ...devices['Pixel 7'], colorScheme: 'dark' },
    },
  ],
});
