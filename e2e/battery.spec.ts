import { expect, test } from '@playwright/test';
import { CENTER } from './fixtures/scene';
import { idle, jump, inWorld, watchPages } from './helpers';

watchPages();

test.describe('battery', () => {
  inWorld();

  test('rests what is not seen: no camera move for GPS jitter, no pulse or compass off view', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation', 'accelerometer', 'gyroscope', 'magnetometer']);
    const at = (dlat: number) =>
      context.setGeolocation({ latitude: CENTER.lat + dlat, longitude: CENTER.lng, accuracy: 10 });
    await at(0);
    // Orientation listeners attached now, and each camera move.
    await page.evaluate(() => {
      const w = window as unknown as { sensors: number; moves: number };
      w.sensors = 0;
      w.moves = 0;
      const add = window.addEventListener.bind(window);
      const remove = window.removeEventListener.bind(window);
      const counted = (type: string) => type.startsWith('deviceorientation');
      window.addEventListener = ((type: string, ...rest: [never]) => {
        if (counted(type)) w.sensors++;
        return add(type, ...rest);
      }) as typeof window.addEventListener;
      window.removeEventListener = ((type: string, ...rest: [never]) => {
        if (counted(type)) w.sensors--;
        return remove(type, ...rest);
      }) as typeof window.removeEventListener;
      window.kosmos!.on('movestart', () => w.moves++);
    });
    const read = () =>
      page.evaluate(() => {
        const w = window as unknown as { sensors: number; moves: number };
        return { sensors: w.sensors, moves: w.moves };
      });
    const locate = page.locator('.controls > button').first();
    await locate.click();
    await expect(locate).toHaveAttribute('data-follow', 'position');
    await idle(page);
    // One sensor, not two: Chromium's relative one says nothing of north.
    await expect.poll(async () => (await read()).sensors).toBe(1);

    // GPS jitter of a few centimetres: the dot stays, and so does the camera.
    const before = (await read()).moves;
    for (const d of [0.0000003, -0.0000002, 0.0000004]) {
      await at(d);
      await page.waitForTimeout(400);
    }
    expect((await read()).moves).toBe(before);
    // A real step still moves it.
    await at(0.0003);
    await expect.poll(async () => (await read()).moves).toBeGreaterThan(before);

    // The dot out of view: its pulse and the compass rest; back in view, both again.
    const me = page.locator('.me');
    await jump(page, { lng: CENTER.lng + 0.05, lat: CENTER.lat, zoom: 15 });
    await expect(me).toHaveClass(/\baway\b/);
    expect(
      await page.locator('.me-dot').evaluate((e) => getComputedStyle(e, '::after').animationName),
    ).toBe('none');
    await expect.poll(async () => (await read()).sensors).toBe(0);
    await jump(page, { ...CENTER, zoom: 15 });
    await expect(me).not.toHaveClass(/\baway\b/);
    await expect.poll(async () => (await read()).sensors).toBe(1);
  });
});
