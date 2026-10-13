// Renders public/icons/*.png from the SVG mark. Run after changing the mark: `npm run icons`.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
// Maskable: full-bleed background, mark inside the 80% safe zone (it already is).
const maskable = svg.replace(/ rx="\d+"/, '');

const targets = [
  ['192.png', svg, 192],
  ['512.png', svg, 512],
  ['maskable-512.png', maskable, 512],
  ['apple-touch-icon.png', maskable, 180],
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
for (const [name, src, size] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${src}`,
  );
  writeFileSync(`public/icons/${name}`, await page.screenshot({ omitBackground: true }));
}
await browser.close();
