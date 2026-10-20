import { expect, test } from '@playwright/test';
import { CENTER } from './fixtures/scene';
import { inWorld, openRoute, shot, watchPages } from './helpers';

watchPages();

test.describe('picture-in-picture', () => {
  inWorld();

  test('as a small window over another app: the next turn and the map, nothing else', async ({
    page,
    context,
  }, info) => {
    const card = await openRoute(page, context);
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    const banner = page.locator('.nav-banner');
    await expect(banner.locator('strong')).toHaveText(/km$|m$/);
    // Android shrinks the app and says so (`MainActivity`, as Capacitor sends window events).
    const pip = (on: boolean) =>
      page.evaluate((on) => {
        window.dispatchEvent(Object.assign(new Event('kosmospip'), { on }));
      }, on);
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: 240, height: 320 });
    await pip(true);
    await expect(banner).toBeVisible();
    await expect(banner.locator('strong')).toBeVisible();
    for (const hidden of ['.nav-bar', '.controls', '.nav-then', '.credit']) {
      await expect(page.locator(hidden)).toBeHidden();
    }
    // The banner leaves most of the window to the map.
    const b = (await banner.boundingBox())!;
    expect(b.height).toBeLessThan(110);
    await shot(page, info, 'pip');
    // Full size again: everything back.
    await page.setViewportSize(size);
    await pip(false);
    await expect(page.locator('.nav-bar')).toBeVisible();
    await expect(page.locator('.controls')).toBeVisible();
  });

  test('out of sight while guiding, guidance goes on and nothing is drawn', async ({
    page,
    context,
  }) => {
    const card = await openRoute(page, context);
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    const distance = page.locator('.nav-banner strong');
    await expect(distance).toHaveText(/km$|m$/);
    await page.waitForTimeout(1500);
    // The app put away, the page kept running (`KosmosWebView`, `kosmosaway`).
    const away = (out: boolean) =>
      page.evaluate((away) => {
        window.dispatchEvent(Object.assign(new Event('kosmosaway'), { away }));
      }, out);
    await away(true);
    const centre = () => page.evaluate(() => window.kosmos!.getCenter().lat);
    const before = { text: await distance.textContent(), lat: await centre() };
    // 300 m on down the first street.
    await context.setGeolocation({
      latitude: CENTER.lat + 0.01 - 0.0027,
      longitude: CENTER.lng + 0.01,
      accuracy: 5,
    });
    await expect(distance).not.toHaveText(before.text!);
    await page.waitForTimeout(800);
    expect(await centre()).toBe(before.lat);
    // Back in sight: the map catches up with the next fix.
    await away(false);
    await context.setGeolocation({
      latitude: CENTER.lat + 0.01 - 0.0029,
      longitude: CENTER.lng + 0.01,
      accuracy: 5,
    });
    await expect.poll(centre).toBeLessThan(before.lat - 0.002);
  });
});
