import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const sha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
})();
const epoch = process.env.SOURCE_DATE_EPOCH;
const build = {
  version: pkg.version,
  sha,
  time: (epoch ? new Date(Number(epoch) * 1000) : new Date()).toISOString(),
};

const DAY = 24 * 60 * 60;

export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  define: { __BUILD__: JSON.stringify(build) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  worker: { format: 'es' },
  plugins: [
    react(),
    {
      name: 'version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(build) });
      },
    },
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // UpdateToast registers, web only
      manifest: {
        id: './',
        name: 'kOSMos',
        short_name: 'kOSMos',
        description: 'A quiet, fast map of the world, made from OpenStreetMap.',
        lang: 'en',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#121417',
        background_color: '#121417',
        categories: ['navigation', 'travel', 'utilities'],
        icons: [
          { src: 'icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        clientsClaim: true,
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        // Map label fonts load on demand; UI fonts for other scripts likewise.
        globIgnores: ['**/inter-{cyrillic,greek,vietnamese}*'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // Tiles are immutable per planet build; the TileJSON names the current build.
            urlPattern: ({ url }) =>
              url.origin === 'https://tiles.openfreemap.org' && /\.pbf$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'kosmos-tiles-v1',
              expiration: { maxEntries: 4000, maxAgeSeconds: 45 * DAY, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://tiles.openfreemap.org',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'kosmos-tilejson-v1',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 8, maxAgeSeconds: 45 * DAY },
            },
          },
        ],
      },
    }),
  ],
});
