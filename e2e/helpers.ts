import { writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { CENTER } from './fixtures/scene';
import { liveTrip, offlineWorld, tileset } from './fixtures/offline-world';

declare global {
  interface Window {
    kosmos?: import('maplibre-gl').Map;
  }
}

/** Attaches a screenshot to the report; `SHOTS=<dir>` also writes it there for design review. */
export async function shot(page: Page, info: TestInfo, name: string) {
  const body = await page.screenshot();
  await info.attach(name, { body, contentType: 'image/png' });
  if (process.env.SHOTS)
    writeFileSync(`${process.env.SHOTS}/${info.project.name}-${name}.png`, body);
}

const consoleErrors = new WeakMap<Page, string[]>();

/** Waits for a settled map; on timeout, fails with the page's errors (e.g. no WebGL) instead. */
export async function idle(page: Page) {
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

/**
 * Resets the fixtures' state and collects page errors for `idle`. Every spec file calls it:
 * a hook in this shared module itself would only reach the first file a worker loads.
 */
export function watchPages() {
  test.beforeEach(({ page }) => {
    liveTrip.cancelled = false;
    tileset.build = '20261001_001001_pt';
    const errors: string[] = [];
    consoleErrors.set(page, errors);
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
  });
}

/** Waits until both points are on screen and not hidden under the panel. */
export async function routeInView(page: Page, a: [number, number], b: [number, number]) {
  await page.waitForFunction(
    ([a, b]) => {
      const m = window.kosmos!;
      if (m.isMoving()) return false;
      const card = document.querySelector('.panel')!.getBoundingClientRect();
      return [a, b].every(([lng, lat]) => {
        const p = m.project([lng, lat]);
        const inMap = p.x >= 0 && p.x <= innerWidth && p.y >= 0 && p.y <= innerHeight;
        const underCard =
          p.x >= card.left && p.x <= card.right && p.y >= card.top && p.y <= card.bottom;
        return inMap && !underCard;
      });
    },
    [a, b],
    { timeout: 15_000, polling: 250 },
  );
}

export async function jump(
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

/**
 * Wide screens: the map the user sees lies beside the panel, and category distances count from
 * its middle. Puts the view's centre there, as a user looking at it would.
 */
export async function centreBeside(page: Page) {
  await page.evaluate(() => {
    if (!matchMedia('(min-width: 900px), (orientation: landscape) and (min-width: 560px)').matches)
      return;
    const left = document.querySelector('.panel')!.getBoundingClientRect().right;
    window.kosmos!.panBy([-left / 2, 0], { duration: 0 });
  });
  await idle(page);
}

export async function screenAt(page: Page, lng: number, lat: number) {
  const p = await page.evaluate(([x, y]) => window.kosmos!.project([x, y]), [lng, lat]);
  return { x: p.x, y: p.y };
}
/** From the user's location (north-east of CENTER) to the search hit, route card open. */
export async function openRoute(page: Page, context: BrowserContext) {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: CENTER.lat + 0.01, longitude: CENTER.lng + 0.01 });
  await page.getByRole('combobox').fill('brandenburger');
  await page.getByRole('option').first().click();
  await page
    .locator('.card')
    .getByRole('button', { name: /^Route$/ })
    .click();
  const card = page.locator('.card.route');
  await expect(card.locator('.summary strong')).toHaveText(/min/);
  return card;
}

/** The app over the synthetic world, without its service worker, settled and error-free. */
export function inWorld() {
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ context, page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await offlineWorld(context);
    await page.goto('./');
    await idle(page);
    expect(errors).toEqual([]);
  });
}

/**
 * The rows of the results sheet (what a search put on the map), opened first when it starts as
 * a strip, as on a phone.
 */
export async function resultRows(page: Page) {
  const sheet = page.locator('.results-sheet');
  await expect(sheet).toBeVisible();
  const peek = sheet.locator('.peek');
  if (await peek.isVisible()) await peek.click();
  return sheet.locator('.results-list button');
}

/**
 * A finger's drag from one point to another (Chromium's touch input, as on a phone): steps of
 * real touch events, so the page decides between its own drag and scrolling.
 */
export async function swipe(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: point(from.x, from.y),
  });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x, y) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
