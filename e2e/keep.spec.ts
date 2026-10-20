import { expect, test } from '@playwright/test';
import { CENTER } from './fixtures/scene';
import { SEARCH_HIT, offlineWorld } from './fixtures/offline-world';
import { idle, inWorld, jump, openRoute, watchPages } from './helpers';

watchPages();

test.describe('the map kept on the device', () => {
  inWorld();

  test('keeps the way of a trip as it starts, and shows it without a connection', async ({
    page,
    context,
  }) => {
    // The usage log says when the way is kept (nothing shows it on the map).
    await page.evaluate(() => localStorage.setItem('kosmos.logging.v1', '1'));
    await page.reload();
    await idle(page);
    const card = await openRoute(page, context);
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('kosmos.log.v1') ?? ''), {
        timeout: 20_000,
      })
      .toContain('"tiles.trip"');
    // No connection now: every tile request fails.
    await context.route(/tiles\.openfreemap\.org\/planet\//, (route) => route.abort());
    // Along the way, near the end: drawn from what was kept.
    await page.evaluate(
      ([lng, lat]) => window.kosmos!.jumpTo({ center: [lng, lat], zoom: 15, pitch: 0 }),
      [SEARCH_HIT.lng + 0.002, SEARCH_HIT.lat],
    );
    await idle(page);
    const roads = await page.evaluate(
      () =>
        window.kosmos!.queryRenderedFeatures().filter((f) => f.sourceLayer === 'transportation')
          .length,
    );
    expect(roads).toBeGreaterThan(0);
  });

  test('keeps the whole world at low zoom, once, without asking', async ({ page }) => {
    // Automated browsers only when asked, and here only to zoom 1: five tiles.
    await page.evaluate(() => localStorage.setItem('kosmos.worldtest.v1', '1'));
    await page.reload();
    await idle(page);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('kosmos.world.v1')), { timeout: 15_000 })
      .toMatch(/"z":1/);
    // Shown again, offline, from the device: no tile request reaches the network.
    let asked = 0;
    await page.context().route(/tiles\.openfreemap\.org\/planet\//, (route) => {
      asked++;
      return route.abort();
    });
    await jump(page, { ...CENTER, zoom: 1 });
    expect(asked).toBe(0);
    // About says so, and how much is kept.
    await page.getByRole('button', { name: '© OpenStreetMap' }).click();
    const about = page.locator('.offline-map');
    await expect(about).toContainText('kept on this device');
    await expect(about).toContainText('The whole world (zoom 0–1) kept on');
    // Areas viewed can go, on a second tap; the world stays and serves offline still.
    const clear = about.getByRole('button', { name: 'Remove areas viewed' });
    await clear.click();
    await about.getByRole('button', { name: /Tap again to remove/ }).click();
    await expect(clear).toBeVisible();
    await expect(about).toContainText('The whole world (zoom 0–1) kept on');
    const left = await page.evaluate(
      () =>
        new Promise<string[]>((ok) => {
          const req = indexedDB.open('kosmos-tiles');
          req.onsuccess = () => {
            const all = req.result.transaction('meta').objectStore('meta').getAll();
            all.onsuccess = () =>
              ok((all.result as { k: string; keep?: boolean }[]).map((m) => String(!!m.keep)));
          };
        }),
    );
    expect(left.length).toBeGreaterThan(0);
    expect(left).not.toContain('false');
  });
});

test.describe('the first start', () => {
  test.use({ serviceWorkers: 'block' });

  test('waits for a slow TileJSON when none is kept yet', async ({ page, context }) => {
    test.slow();
    await offlineWorld(context);
    // Slower than the 4 s after which a kept one would serve; none is kept on a first start.
    await context.route('https://tiles.openfreemap.org/planet', async (route) => {
      await new Promise((go) => setTimeout(go, 6000));
      await route.fallback();
    });
    await page.goto('./');
    await idle(page);
    const drawn = await page.evaluate(() => window.kosmos!.queryRenderedFeatures().length);
    expect(drawn).toBeGreaterThan(0);
  });
});
