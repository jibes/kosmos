import { expect, test } from '@playwright/test';
import { CENTER } from './fixtures/scene';
import { SEARCH_HIT, lookupRequests, offlineWorld, tileset } from './fixtures/offline-world';
import { shot, idle, jump, screenAt, inWorld, watchPages } from './helpers';

watchPages();

test.describe('map', () => {
  inWorld();

  test('renders the globe and a city', async ({ page }, info) => {
    await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
    // Frosted glass, in Chromium too (a minifier once kept only the -webkit- form).
    expect(
      await page.locator('.bar').evaluate((e) => getComputedStyle(e).backdropFilter),
    ).toContain('blur');
    await shot(page, info, 'globe');
    await jump(page, { ...CENTER, zoom: 15.2 });
    await shot(page, info, 'city');
    await jump(page, { ...CENTER, zoom: 16.2, pitch: 60, bearing: -25 });
    await expect(page.getByRole('button', { name: /north|Norden/ })).toBeVisible();
    await shot(page, info, 'city-3d');
  });

  test('renders labels with diacritics', async ({ page }, info) => {
    await jump(page, { lng: 30, lat: 42, zoom: 3.6 });
    await shot(page, info, 'diacritics');
  });

  test('shows opening hours and contacts, asking once per place', async ({ page }, info) => {
    const asked = lookupRequests.length;
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    const card = page.locator('.card');
    const hours = card.locator('.hours summary');
    await expect(hours).toHaveText(/^(Open · closes|Closed · opens) /);
    await expect(card.getByRole('link', { name: '+49 30 1234567' })).toHaveAttribute(
      'href',
      'tel:+49301234567',
    );
    await expect(card.getByRole('link', { name: 'example.org' })).toHaveAttribute(
      'href',
      'https://www.example.org/tor',
    );
    await hours.click();
    // The week in the user's language and clock, not OpenStreetMap's syntax; today stands out.
    await expect(card.locator('.hours li')).toHaveText([
      /^Mon–Fri 9:00\sAM–6:00\sPM$/,
      /^Sat 10:00\sAM–2:00\sPM$/,
      'Sun closed',
    ]);
    await expect(card.locator('.hours li[data-today]')).toHaveCount(1);
    await shot(page, info, 'hours');
    expect(lookupRequests.length).toBe(asked + 1);
    expect(lookupRequests.at(-1)!.get('osm_ids')).toBe('W518071791');

    // Again: from the cache, no second request.
    await card.getByRole('button', { name: /close/i }).click();
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await expect(page.locator('.card .hours summary')).toBeVisible();
    expect(lookupRequests.length).toBe(asked + 1);
  });

  test('pulls a card down to a strip and back', async ({ page }, info) => {
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    const card = page.locator('.card');
    await expect(card.getByRole('heading')).toHaveText(SEARCH_HIT.name);
    // The card rises into place; measured mid-animation, the grab bar is not where it ends up.
    await card.evaluate((e) =>
      Promise.all(e.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    const grab = card.locator('.grab');
    const box = (await grab.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 60, { steps: 4 });
    await page.mouse.move(x, y + 140, { steps: 4 });
    await page.mouse.up();
    await expect(card).toHaveAttribute('data-min');
    await expect(card.locator('.peek')).toHaveText(SEARCH_HIT.name);
    await expect(card.getByRole('heading')).toHaveCount(0);
    await shot(page, info, 'minimised');
    await card.locator('.peek').click();
    await expect(card.getByRole('heading')).toHaveText(SEARCH_HIT.name);
  });

  test('keeps the map buttons low, just above the panel', async ({ page }) => {
    const locate = (await page.locator('.controls > button').first().boundingBox())!;
    const compass = (await page.locator('.controls .compass').boundingBox())!;
    // The location button nearest the thumb, the compass above it.
    expect(compass.y).toBeLessThan(locate.y);
    const view = page.viewportSize()!;
    expect(locate.y).toBeGreaterThan(view.height * 0.5);
    if (view.width < 600) {
      const bar = (await page.locator('.bar').boundingBox())!;
      expect(locate.y + locate.height).toBeLessThanOrEqual(bar.y);
    }
  });

  test('shows the location on opening where it is already allowed', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat, longitude: CENTER.lng, accuracy: 20 });
    await page.evaluate(() => localStorage.removeItem('kosmos.view.v1'));
    await page.goto('./');
    await expect(page.locator('.me')).toBeVisible();
    // From the globe it flies there; the button is not switched to following.
    await expect.poll(() => page.evaluate(() => window.kosmos!.getZoom())).toBeGreaterThan(14);
    await expect(page.locator('.controls > button').first()).toHaveAttribute('data-follow', 'off');
  });

  test('says how to drop a pin once, the first time the map shows streets', async ({ page }) => {
    // From the globe, where a pin means nothing: no note.
    await jump(page, { ...CENTER, zoom: 2 });
    await page.evaluate(() => localStorage.removeItem('kosmos.hinted.v1'));
    // The fixture marks every other test as hinted already.
    await page.goto('./?hint');
    await idle(page);
    const note = page.locator('.toast');
    await page.waitForTimeout(2000);
    await expect(note).toHaveCount(0);

    // Streets: the note comes, stays long enough to try it, and lets taps through to the map.
    await jump(page, { ...CENTER, zoom: 16 });
    await expect(note).toHaveText(/(Long-press|Right-click) anywhere to drop a pin/);
    await page.waitForTimeout(4000);
    await expect(note).toBeVisible();
    expect(await note.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    // Doing it opens a card, and the note goes.
    const at = await screenAt(page, CENTER.lng, CENTER.lat);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await expect(page.locator('.card').getByRole('heading')).toBeVisible();
    await expect(note).toHaveCount(0);

    // Said once.
    await page.reload();
    await idle(page);
    await page.waitForTimeout(2500);
    await expect(note).toHaveCount(0);
  });

  test('keeps a place card on screen with a phone held sideways', async ({ page }) => {
    await page.setViewportSize({ width: 915, height: 412 });
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    const card = page.locator('.card');
    await expect(card.getByRole('heading')).toHaveText(SEARCH_HIT.name);
    const close = (await card.getByRole('button', { name: /close/i }).boundingBox())!;
    expect(close.y).toBeGreaterThanOrEqual(0);
    const box = (await card.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(412);
    // Side by side: the card on the left, the pin to its right.
    await expect
      .poll(async () => (await page.locator('.pin').boundingBox())!.x, { timeout: 8000 })
      .toBeGreaterThan(box.x + box.width);

    // The hours open, the card scrolls, and Route and Share stay at its foot, in reach.
    await card.locator('.hours summary').click();
    await expect(card.locator('.hours li')).toHaveCount(3);
    const hit = async (name: string) => {
      const b = (await card.getByRole('button', { name, exact: true }).boundingBox())!;
      return page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent,
        { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      );
    };
    expect(await card.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    expect(await hit('Route')).toBe('Route');
    expect(await hit('Share')).toBe('Share');
  });

  test('follows the compass on the second tap of the location button', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation', 'accelerometer', 'gyroscope', 'magnetometer']);
    await context.setGeolocation({ latitude: CENTER.lat, longitude: CENTER.lng, accuracy: 80 });
    /** Points the "phone" east (heading 90°): absolute alpha runs counter-clockwise. */
    const face = (heading: number) =>
      page.evaluate((alpha) => {
        // Browsers differ in which event carries the absolute heading; send both.
        for (let i = 0; i < 40; i++) {
          for (const type of ['deviceorientationabsolute', 'deviceorientation']) {
            window.dispatchEvent(
              new DeviceOrientationEvent(type, { alpha, beta: 0, gamma: 0, absolute: true }),
            );
          }
        }
      }, 360 - heading);
    const locate = page.locator('.controls > button').first();
    // What this browser offers, for the log when this test fails on a new Chromium.
    console.log(
      'orientation support',
      await page.evaluate(() => ({
        event: 'DeviceOrientationEvent' in window,
        absolute: 'ondeviceorientationabsolute' in window,
        requestPermission: typeof (
          DeviceOrientationEvent as unknown as { requestPermission?: unknown }
        ).requestPermission,
      })),
    );

    await locate.click();
    await expect(locate).toHaveAttribute('data-follow', 'position');
    // The compass starts listening after an async permission step; a phone sends readings
    // continuously, so keep sending until the first one lands.
    await expect
      .poll(async () => {
        await face(0);
        return page.locator('.me.facing').count();
      })
      .toBe(1);
    await idle(page);
    // Fixes arriving during the fly-in once cut it short at globe zoom.
    expect(await page.evaluate(() => window.kosmos!.getZoom())).toBeGreaterThanOrEqual(14.9);
    // The ring grows into its size with a transition.
    await expect
      .poll(() => page.locator('.me-ring').evaluate((e) => e.getBoundingClientRect().width))
      .toBeGreaterThan(40);

    // The dot sits on the location and the beam starts at the dot, however large the
    // accuracy ring (a grid layout once pushed the dot off by the ring's radius).
    const geometry = await page.evaluate(
      ([lng, lat]) => {
        const p = window.kosmos!.project([lng, lat]);
        const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const dot = r('.me-dot');
        const beam = r('.me-beam');
        return {
          dot: [dot.left + dot.width / 2 - p.x, dot.top + dot.height / 2 - p.y],
          apex: [beam.left + beam.width / 2 - p.x, beam.bottom - p.y],
          ring: r('.me-ring').width,
        };
      },
      [CENTER.lng, CENTER.lat],
    );
    expect(geometry.ring).toBeGreaterThan(40);
    for (const v of [...geometry.dot, ...geometry.apex]) expect(Math.abs(v)).toBeLessThan(2);

    await face(90);

    await locate.click();
    await expect(locate).toHaveAttribute('data-follow', 'compass');
    await face(90);
    await expect.poll(() => page.evaluate(() => Math.round(window.kosmos!.getBearing()))).toBe(90);

    // The orientation button returns to north-up but keeps following.
    await page.getByRole('button', { name: /north|Norden/ }).click();
    await expect(locate).toHaveAttribute('data-follow', 'position');
    await expect.poll(() => page.evaluate(() => Math.round(window.kosmos!.getBearing()))).toBe(0);

    // A drag while the compass turns the map every frame still pans, and leaves compass mode
    // (a turn once cancelled every gesture the moment it began).
    await locate.click();
    await expect(locate).toHaveAttribute('data-follow', 'compass');
    await page.evaluate(() => {
      let alpha = 0;
      (window as unknown as { spin: number }).spin = window.setInterval(() => {
        alpha = (alpha + 1) % 360;
        for (const type of ['deviceorientationabsolute', 'deviceorientation']) {
          window.dispatchEvent(
            new DeviceOrientationEvent(type, { alpha, beta: 0, gamma: 0, absolute: true }),
          );
        }
      }, 16);
    });
    const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
    const y = box.y + box.height * 0.4;
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.waitForTimeout(150);
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(box.x + box.width * 0.3 + i * 15, y);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    await page.evaluate(() => clearInterval((window as unknown as { spin: number }).spin));
    await expect(locate).toHaveAttribute('data-follow', 'off');
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
    const asked = lookupRequests.length;
    await page.mouse.click(at.x, at.y);
    const card = page.locator('.card');
    await expect(card.getByRole('heading')).toHaveText('Café Einstein');
    // The only Café Einstein the search knows is another branch, 2 km away: not its address,
    // nor its hours. The address is the spot's own.
    await expect(card).toContainText('Unter den Linden 5, Berlin, Deutschland');
    await expect(card).not.toContainText('Kurfürstenstraße');
    expect(lookupRequests.length).toBe(asked);
  });

  test('says when the map has no connection, covering nothing', async ({ page, context }) => {
    const note = page.getByRole('status').filter({ hasText: 'No connection' });
    await context.setOffline(true);
    await expect(note).toBeVisible();
    // Not over the credit, the map buttons or the panel: on phones just above the panel, on
    // wide screens over the map beside it. Sideways too.
    const clear = async () => {
      await note.evaluate((e) =>
        Promise.all(e.getAnimations().map((a) => a.finished.catch(() => undefined))),
      );
      const box = (await note.boundingBox())!;
      for (const other of ['.credit', '.controls', '.panel']) {
        const o = (await page.locator(other).boundingBox())!;
        const apart =
          box.x + box.width <= o.x ||
          o.x + o.width <= box.x ||
          box.y + box.height <= o.y ||
          o.y + o.height <= box.y;
        expect(apart, `${other} under the note`).toBe(true);
      }
    };
    await clear();
    await page.setViewportSize({ width: 915, height: 412 });
    await clear();
    await context.setOffline(false);
    await expect(note).toHaveCount(0);
  });

  test('opens the about sheet with credits', async ({ page }) => {
    await page.getByRole('button', { name: '© OpenStreetMap' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('OpenStreetMap');
    await expect(dialog).toContainText('GPL-3.0-or-later');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // Focus goes back to what opened it.
    await expect(page.getByRole('button', { name: /OpenStreetMap/ })).toBeFocused();
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

test('keeps the areas viewed for offline use across a new planet build', async ({
  context,
  page,
}) => {
  await offlineWorld(context);
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Now under the service worker: the tiles of what is viewed are kept.
  await page.reload();
  await idle(page);
  await jump(page, { ...CENTER, zoom: 14 });
  // Later, somewhere else, online: OpenFreeMap has a new build, and the TileJSON names it.
  await jump(page, { lng: CENTER.lng + 1, lat: CENTER.lat + 1, zoom: 14 });
  tileset.build = '20261008_001001_pt';
  await page.reload();
  await idle(page);
  // Offline, back where the user was: the new build's tiles were never fetched there. (The
  // fixture would still answer while "offline"; now no tile comes from the network.)
  await context.setOffline(true);
  await context.route(/\.pbf$/, (route) => route.abort('internetdisconnected'));
  await page.evaluate(
    ([lng, lat]) => window.kosmos!.jumpTo({ center: [lng, lat] }),
    [CENTER.lng, CENTER.lat],
  );
  const drawn = () =>
    page.evaluate(
      () => window.kosmos!.queryRenderedFeatures().filter((f) => f.source === 'omt').length,
    );
  await expect.poll(drawn, { timeout: 10_000 }).toBeGreaterThan(0);
});

test.describe('in Britain', () => {
  test.use({ locale: 'en-GB' });

  test('shows the time on the 24-hour clock, and miles', async ({ context, page }) => {
    await offlineWorld(context);
    await page.goto('./');
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.01, longitude: CENTER.lng + 0.01 });
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const summary = page.locator('.card.route .summary span');
    await expect(summary).toContainText(' mi');
    await expect(summary).toHaveText(/arrival \d{2}:\d{2}$/);
  });
});

test.describe('in the US', () => {
  test.use({ locale: 'en-US' });

  test('shows and says distances in miles and feet', async ({ context, page }) => {
    await offlineWorld(context);
    await page.goto('./');
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.01, longitude: CENTER.lng + 0.01 });
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const summary = page.locator('.card.route .summary span');
    await expect(summary).toContainText(' mi');
    // A 12-hour clock without a leading zero: "arrival 6:05 PM".
    await expect(summary).toHaveText(/arrival [1-9]\d?:\d{2}\s[AP]M$/);
  });
});
