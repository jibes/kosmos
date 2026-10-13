import { writeFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { CENTER } from './fixtures/scene';
import { SEARCH_HIT, offlineWorld } from './fixtures/offline-world';

declare global {
  interface Window {
    kosmos?: import('maplibre-gl').Map;
  }
}

/** Attaches a screenshot to the report; `SHOTS=<dir>` also writes it there for design review. */
async function shot(page: Page, info: TestInfo, name: string) {
  const body = await page.screenshot();
  await info.attach(name, { body, contentType: 'image/png' });
  if (process.env.SHOTS)
    writeFileSync(`${process.env.SHOTS}/${info.project.name}-${name}.png`, body);
}

const consoleErrors = new WeakMap<Page, string[]>();

/** Waits for a settled map; on timeout, fails with the page's errors (e.g. no WebGL) instead. */
async function idle(page: Page) {
  try {
    await page.waitForFunction(
      () => {
        const m = window.kosmos;
        return !!m && m.loaded() && m.areTilesLoaded() && !m.isMoving();
      },
      undefined,
      { timeout: 20_000 },
    );
  } catch (e) {
    const errors = consoleErrors.get(page) ?? [];
    throw new Error(`map never settled; page errors:\n${errors.join('\n') || '(none)'}`, {
      cause: e,
    });
  }
  // Symbol placement fades in after the map reports idle.
  await page.waitForTimeout(400);
}

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
});

async function jump(
  page: Page,
  view: { lng: number; lat: number; zoom: number; pitch?: number; bearing?: number },
) {
  await page.evaluate((v) => {
    window.kosmos!.jumpTo({
      center: [v.lng, v.lat],
      zoom: v.zoom,
      pitch: v.pitch ?? 0,
      bearing: v.bearing ?? 0,
    });
  }, view);
  await idle(page);
}

async function screenAt(page: Page, lng: number, lat: number) {
  const p = await page.evaluate(([x, y]) => window.kosmos!.project([x, y]), [lng, lat]);
  return { x: p.x, y: p.y };
}

test.describe('map', () => {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ context, page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await offlineWorld(context);
    await page.goto('./');
    await idle(page);
    expect(errors).toEqual([]);
  });

  test('renders the globe and a city', async ({ page }, info) => {
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
    await shot(page, info, 'globe');
    await jump(page, { ...CENTER, zoom: 15.2 });
    await shot(page, info, 'city');
    await jump(page, { ...CENTER, zoom: 16.2, pitch: 60, bearing: -25 });
    await expect(page.getByRole('button', { name: /north|Norden/ })).toBeVisible();
    await shot(page, info, 'city-3d');
  });

  test('searches and selects a place', async ({ page }, info) => {
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    const option = page.getByRole('option').first();
    await expect(option).toContainText(SEARCH_HIT.name);
    await shot(page, info, 'results');
    await option.click();
    const card = page.locator('.card');
    await expect(card.getByRole('heading')).toHaveText(SEARCH_HIT.name);
    await expect(card).toContainText('Pariser Platz, Mitte, Berlin, Deutschland');
    await idle(page);
    const c = await page.evaluate(() => window.kosmos!.getZoom());
    expect(c).toBeGreaterThanOrEqual(16);
    await expect(page.locator('.pin')).toHaveCount(1);
    await shot(page, info, 'selected');
    await card.getByRole('button', { name: /close|schließen/i }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.pin')).toHaveCount(0);
  });

  test('drops a pin and looks up the address', async ({ page }) => {
    await jump(page, { ...CENTER, zoom: 16 });
    const box = page.viewportSize()!;
    await page.mouse.click(box.width / 2, box.height / 3, { button: 'right' });
    const card = page.locator('.card');
    await expect(card.getByRole('heading')).toHaveText('Unter den Linden 5');
    await expect(card).toContainText('Berlin, Deutschland');
    await expect(card.locator('.coords')).toContainText('° N');
  });

  test('taps a label to select it', async ({ page }) => {
    const cafe = { lng: CENTER.lng + 140 / 67800, lat: CENTER.lat - 170 / 111200 };
    await jump(page, { ...cafe, zoom: 17 });
    const at = await screenAt(page, cafe.lng, cafe.lat);
    await page.mouse.click(at.x, at.y);
    await expect(page.locator('.card').getByRole('heading')).toHaveText('Café Einstein');
  });

  test('opens the about sheet with credits', async ({ page }) => {
    await page.getByRole('button', { name: '© OpenStreetMap' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('OpenStreetMap');
    await expect(dialog).toContainText('GPL-3.0-or-later');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});

test('works offline after the first visit', async ({ context, page }) => {
  await offlineWorld(context);
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await idle(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('combobox')).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
});
