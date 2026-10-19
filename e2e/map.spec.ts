import { expect, test } from '@playwright/test';
import { decimalYear, declination } from '../src/core/magnetic';
import { CENTER } from './fixtures/scene';
import {
  SEARCH_HIT,
  lookupRequests,
  offlineWorld,
  stopTimesRequests,
  tileset,
} from './fixtures/offline-world';
import { shot, idle, jump, screenAt, inWorld, swipe, watchPages } from './helpers';

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
    await expect(page.getByRole('button', { name: /north|Norden/i })).toBeVisible();
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

  test('a finger pulls a card down from anywhere on it, and up again', async ({ page }, info) => {
    test.skip(!info.project.use.hasTouch, 'touch only');
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    const card = page.locator('.card');
    await expect(card.getByRole('heading')).toHaveText(SEARCH_HIT.name);
    await card.evaluate((e) =>
      Promise.all(e.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    // From the place's name, not the grab bar.
    const head = (await card.getByRole('heading').boundingBox())!;
    const at = { x: head.x + 20, y: head.y + head.height / 2 };
    // Sideways is not a pull.
    await swipe(page, at, { x: at.x + 120, y: at.y + 10 });
    await expect(card).not.toHaveAttribute('data-min');
    await swipe(page, at, { x: at.x, y: at.y + 160 });
    await expect(card).toHaveAttribute('data-min');
    // Settled as the strip first: it springs back into place after the finger lets go.
    await page.waitForTimeout(500);
    const strip = (await card.boundingBox())!;
    const mid = { x: strip.x + strip.width / 2, y: strip.y + strip.height / 2 };
    await swipe(page, mid, { x: mid.x, y: mid.y - 160 });
    await expect(card).not.toHaveAttribute('data-min');
    await expect(card.getByRole('heading')).toHaveText(SEARCH_HIT.name);
    // A tap is still a tap.
    await card.getByRole('button', { name: 'Close' }).tap();
    await expect(card).toHaveCount(0);
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

  test('follows with the location button, turns with the compass by the needle', async ({
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
    // Phones read magnetic north; the map's is true north, the declination east of it here.
    const decl = declination(CENTER, decimalYear(Date.now()));
    expect(decl).toBeGreaterThan(3);
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
        await face(-decl);
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
    // accuracy ring (a grid layout once pushed the dot off by the ring's radius). Measured
    // facing true north (the beam upright) while readings keep coming, as a phone sends them.
    const geometry = () =>
      page.evaluate(
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
    expect((await geometry()).ring).toBeGreaterThan(40);
    await expect
      .poll(async () => {
        await face(-decl);
        const g = await geometry();
        return Math.max(...[...g.dot, ...g.apex].map(Math.abs));
      })
      .toBeLessThan(2);

    await face(90);

    // The location button only follows; which way is up is the needle's.
    await locate.click();
    await expect(locate).toHaveAttribute('data-follow', 'position');
    const needle = page.locator('.controls .compass');
    await expect(needle).toHaveAttribute('aria-label', 'Turn map with compass');
    await needle.click();
    await expect(locate).toHaveAttribute('data-follow', 'compass');
    await expect(needle).toHaveAttribute('data-heading', 'true');
    await face(90);
    // Facing magnetic east, the map turns to east of true north by the declination.
    await expect
      .poll(() => page.evaluate(() => window.kosmos!.getBearing()))
      .toBeCloseTo(90 + decl, 0);

    // The needle returns to north-up but keeps following.
    await expect(needle).toHaveAttribute('aria-label', 'North up');
    await needle.click();
    await expect(locate).toHaveAttribute('data-follow', 'position');
    await expect.poll(() => page.evaluate(() => Math.round(window.kosmos!.getBearing()))).toBe(0);

    // A drag while the compass turns the map every frame still pans, and leaves compass mode
    // (a turn once cancelled every gesture the moment it began).
    await needle.click();
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
    // Placed under the pointer first: a busy test machine may still be fading labels in.
    await expect
      .poll(() =>
        page.evaluate(
          ({ x, y }) =>
            window
              .kosmos!.queryRenderedFeatures([
                [x - 10, y - 10],
                [x + 10, y + 10],
              ])
              .some((f) => f.properties.name === 'Café Einstein'),
          at,
        ),
      )
      .toBe(true);
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

  test("shows the next departures on a station's card, asking once", async ({ page }) => {
    const station = { lng: CENTER.lng + 60 / 67800, lat: CENTER.lat + 230 / 111200 };
    await jump(page, { ...station, zoom: 17 });
    const at = await screenAt(page, station.lng, station.lat);
    await expect
      .poll(() =>
        page.evaluate(
          ({ x, y }) =>
            window
              .kosmos!.queryRenderedFeatures([
                [x - 10, y - 10],
                [x + 10, y + 20],
              ])
              .some((f) => f.properties.name === 'Bahnhof Friedrichstraße'),
          at,
        ),
      )
      .toBe(true);
    const asked = stopTimesRequests.length;
    await page.mouse.click(at.x, at.y + 8);
    const card = page.locator('.card');
    await expect(card.getByRole('heading', { level: 2 })).toHaveText('Bahnhof Friedrichstraße');
    const rows = card.locator('.departures li');
    // Soonest first, live time, the line in its colour, a changed platform marked.
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('U6');
    await expect(rows.nth(0)).toContainText('Alt-Tegel');
    await expect(rows.nth(1)).toContainText('S1');
    await expect(rows.nth(1).locator('time')).toHaveAttribute('data-late');
    await expect(rows.nth(1).locator('small')).toHaveAttribute('data-moved');
    expect(stopTimesRequests.length).toBe(asked + 1);
    // Closed and opened again soon: the same answer, no new request.
    await card.getByRole('button', { name: 'Close' }).click();
    await page.mouse.click(at.x, at.y + 8);
    await expect(rows).toHaveCount(2);
    expect(stopTimesRequests.length).toBe(asked + 1);
  });

  test('opens a place handed over by another app', async ({ page }) => {
    // A map link shared to the app (the web share target): its point, its card, the map there.
    const link = 'https://www.openstreetmap.org/?mlat=52.5163&mlon=13.3777#map=17/52.5163/13.3777';
    await page.goto(`./?url=${encodeURIComponent(link)}`);
    const card = page.locator('.card');
    await expect(card).toContainText('Unter den Linden 5');
    await idle(page);
    const c = await page.evaluate(() => window.kosmos!.getCenter());
    expect(Math.abs(c.lat - 52.5163)).toBeLessThan(0.005);
    // The address bar no longer holds it: a reload does not open it again.
    expect(page.url()).not.toContain('url=');

    // An OpenStreetMap object's page: one lookup gives the place and its card's details.
    const asked = lookupRequests.length;
    await page.goto(`./?url=${encodeURIComponent('https://www.openstreetmap.org/way/518071791')}`);
    await expect(card.getByRole('heading')).toHaveText('Brandenburger Tor');
    await expect(card).toContainText('Pariser Platz');
    await expect(card).toContainText('+49 30 1234567');
    expect(lookupRequests.length).toBe(asked + 1);

    // A message with a link only its maker can open: its words are searched.
    const text = 'Café Einstein, Kurfürstenstraße 58, 10785 Berlin https://maps.app.goo.gl/AbC1';
    await page.goto(`./?text=${encodeURIComponent(text)}`);
    const input = page.getByRole('combobox');
    await expect(input).toHaveValue('Café Einstein, Kurfürstenstraße 58, 10785 Berlin');
    await expect(input).toBeFocused();
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

  test('stars a favourite: marked on the map, in its list and found by name, kept', async ({
    page,
  }, info) => {
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    await page.getByRole('option').first().click();
    const card = page.locator('.card');
    const star = card.getByRole('button', { name: 'Favourite' });
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await card.getByRole('button', { name: 'Close' }).click();
    // Its star on the map, where the place is.
    const onMap = () =>
      page.evaluate(
        ([lng, lat]) => {
          const m = window.kosmos!;
          const p = m.project([lng, lat]);
          return m.queryRenderedFeatures(
            [
              [p.x - 12, p.y - 12],
              [p.x + 12, p.y + 12],
            ],
            { layers: ['fav-stars'] },
          ).length;
        },
        [SEARCH_HIT.lng, SEARCH_HIT.lat],
      );
    await expect.poll(onMap).toBeGreaterThan(0);
    await idle(page);
    await shot(page, info, 'favourite');
    // A tap on it opens its card.
    const at = await page.evaluate(
      ([lng, lat]) => window.kosmos!.project([lng, lat]),
      [SEARCH_HIT.lng, SEARCH_HIT.lat],
    );
    await page.mouse.click(at.x, at.y);
    await expect(card.getByRole('heading')).toHaveText(SEARCH_HIT.name);
    await card.getByRole('button', { name: 'Close' }).click();
    // Kept: after a reload, its list first in the empty search field, and found by name.
    await page.reload();
    await input.click();
    const first = page.getByRole('option').first();
    await expect(first).toHaveAccessibleName('Favourites, 1, opens a list');
    await first.click();
    const fav = page.getByRole('option').nth(1);
    await expect(fav).toContainText(SEARCH_HIT.name);
    await expect(fav).toHaveClass(/r-fav/);
    await input.fill('brandenb');
    await expect(page.getByRole('option')).toHaveCount(2);
    await input.fill('');
    await input.press('Escape');
    await input.fill('brandenburger');
    await expect(page.getByRole('option').first()).toHaveClass(/r-fav/);
    await expect(page.locator('.r-fav')).toHaveCount(1);
    await page.getByRole('option').first().click();
    await card.getByRole('button', { name: 'Favourite' }).click();
    await expect(card.getByRole('button', { name: 'Favourite' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect.poll(onMap).toBe(0);
  });

  test('groups marks too close to tell apart; a tap zooms in until they part', async ({ page }) => {
    // Three favourites a few hundred metres apart, seen from far away.
    await page.evaluate((c) => {
      const fav = (name: string, dx: number) => ({
        name,
        detail: '',
        lng: c.lng + dx,
        lat: c.lat,
        at: 1,
      });
      localStorage.setItem(
        'kosmos.favourites.v1',
        JSON.stringify([fav('A', 0), fav('B', 0.004), fav('C', 0.008)]),
      );
    }, CENTER);
    await page.reload();
    await jump(page, { ...CENTER, zoom: 10 });
    const at = await screenAt(page, CENTER.lng + 0.004, CENTER.lat);
    const groups = () =>
      page.evaluate(
        ({ x, y }) =>
          window
            .kosmos!.queryRenderedFeatures(
              [
                [x - 20, y - 20],
                [x + 20, y + 20],
              ],
              { layers: ['fav-groups', 'fav-stars'] },
            )
            .map((f) => `${f.layer.id}:${f.properties.point_count ?? f.properties.name}`),
        at,
      );
    await expect.poll(groups).toEqual(['fav-groups:3']);
    const group = await page.evaluate(() => {
      const [f] = window.kosmos!.queryRenderedFeatures(undefined, { layers: ['fav-groups'] });
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      return window.kosmos!.project([lng, lat]);
    });
    await page.mouse.click(group.x, group.y);
    // In until the group parts: one star alone, the rest a smaller group or stars too.
    await expect.poll(() => page.evaluate(() => window.kosmos!.getZoom())).toBeGreaterThan(11);
    await idle(page);
    const marks = () =>
      page.evaluate(() =>
        window
          .kosmos!.queryRenderedFeatures(undefined, { layers: ['fav-groups', 'fav-stars'] })
          .map((f) =>
            f.properties.point_count ? `${f.properties.point_count}` : f.properties.name,
          )
          .sort(),
      );
    await expect.poll(async () => (await marks()).length).toBeGreaterThan(1);
    // Close in, every one alone.
    await jump(page, { ...CENTER, lng: CENTER.lng + 0.004, zoom: 15 });
    await expect.poll(marks).toEqual(['A', 'B', 'C']);
  });

  test('renames a favourite, and keeps favourites in a backup file', async ({ page }) => {
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    await page.getByRole('option').first().click();
    const card = page.locator('.card');
    await expect(card.getByRole('button', { name: 'Rename' })).toHaveCount(0);
    await card.getByRole('button', { name: 'Favourite' }).click();
    await card.getByRole('button', { name: 'Rename' }).click();
    const field = card.getByRole('textbox', { name: 'Name of this favourite' });
    await expect(field).toBeFocused();
    await field.fill('Gate');
    await field.press('Enter');
    await expect(card.getByRole('heading')).toHaveText('Gate');
    await card.getByRole('button', { name: 'Close' }).click();
    // Listed by its new name, the place's own after it; found by either.
    await input.fill('');
    await page.getByRole('option').first().click();
    const first = page.getByRole('option').nth(1);
    await expect(first).toContainText('Gate');
    await expect(first).toContainText(SEARCH_HIT.name);
    await input.fill('gat');
    await expect(page.getByRole('option')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // Saved as a file, then gone, and back from the file.
    await page.getByRole('button', { name: '© OpenStreetMap' }).click();
    const saved = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save backup' }).click();
    const file = await saved;
    expect(file.suggestedFilename()).toMatch(/^kosmos-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const path = await file.path();
    await page.evaluate(() => localStorage.removeItem('kosmos.favourites.v1'));
    await page.reload();
    await page.getByRole('button', { name: '© OpenStreetMap' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Restore…' }).click();
    await (await chooser).setFiles(path);
    await expect(page.getByRole('status').filter({ hasText: 'Added' })).toHaveText(
      'Added 1 favourites and 0 contacts.',
    );
    await page.keyboard.press('Escape');
    await input.click();
    await page.getByRole('option').first().click();
    await expect(page.getByRole('option').nth(1)).toContainText('Gate');
  });

  test('puts contacts on the map, found by name, and takes them off again', async ({
    page,
    context,
  }) => {
    // The browser's contact picker, as Chrome on Android offers it: the user picks Anna.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'contacts', {
        value: {
          select: async () => [
            {
              name: ['Anna Müller'],
              address: [{ addressLine: ['Brandenburger Tor'], city: 'Berlin' }],
            },
            { name: ['No Address'], address: [] },
          ],
        },
      });
    });
    await page.reload();
    const input = page.getByRole('combobox');
    await input.click();
    const row = page.getByRole('option').filter({ hasText: "Show contacts' addresses" });
    await row.click();
    await expect(
      page.getByRole('status').filter({ hasText: '1 contact on the map' }),
    ).toBeVisible();
    // Found by name, before the world's places; its card at the address.
    await input.fill('anna');
    const anna = page.getByRole('option').first();
    await expect(anna).toContainText('Anna Müller');
    await expect(anna).toContainText('Brandenburger Tor, Berlin');
    await anna.click();
    const card = page.locator('.card');
    await expect(card.getByRole('heading')).toHaveText('Anna Müller');
    await card.getByRole('button', { name: 'Close' }).click();
    // Marked on the map where the address is.
    const onMap = () =>
      page.evaluate(
        ([lng, lat]) => {
          const m = window.kosmos!;
          const p = m.project([lng, lat]);
          return m.queryRenderedFeatures(
            [
              [p.x - 12, p.y - 12],
              [p.x + 12, p.y + 12],
            ],
            { layers: ['contact-icons'] },
          ).length;
        },
        [SEARCH_HIT.lng, SEARCH_HIT.lat],
      );
    await expect.poll(onMap).toBeGreaterThan(0);
    // In a list of their own in the empty field, nearest first; taken off again from there.
    await input.fill('');
    await input.click();
    const list = page.getByRole('option').filter({ hasText: 'Contacts' });
    await expect(list).toHaveAccessibleName('Contacts, 1, opens a list');
    await list.click();
    await expect(page.locator('.r-place')).toHaveText([/Anna Müller/]);
    await page.getByRole('button', { name: 'Remove contacts from the map' }).click();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('option').filter({ hasText: "Show contacts' addresses" }),
    ).toBeVisible();
    await expect.poll(onMap).toBe(0);
  });

  test('keeps a usage log only when asked, saved as a file without places or words', async ({
    page,
  }) => {
    const about = () => page.getByRole('button', { name: '© OpenStreetMap' }).click();
    await about();
    const keep = page.getByRole('checkbox', { name: 'Keep a usage log on this device' });
    await expect(keep).not.toBeChecked();
    await keep.check();
    await page.keyboard.press('Escape');
    // Something used: a kind of place taken from the list.
    await jump(page, { ...CENTER, zoom: 14 });
    const input = page.getByRole('combobox');
    await input.fill('restaurant');
    const kind = page.getByRole('option').first();
    await expect(kind).toHaveText(/Restaurants/);
    await kind.click();
    await about();
    const saved = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save log' }).click();
    const file = await saved;
    expect(file.suggestedFilename()).toMatch(/^kosmos-log-\d{4}-\d{2}-\d{2}\.txt$/);
    const text = await (
      await file.createReadStream()
    )
      .toArray()
      .then((c) => Buffer.concat(c).toString());
    const lines = text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ e: 'log.export' });
    expect(lines.some((l) => l.e === 'search.pick' && l.row === 'kind')).toBe(true);
    // Never what was typed, never a place.
    expect(text).not.toContain('restaurant');
    expect(text).not.toMatch(/"(lat|lng|lon)"/);
    // Off deletes it.
    await keep.uncheck();
    expect(await page.evaluate(() => localStorage.getItem('kosmos.log.v1'))).toBeNull();
    await expect(page.getByRole('button', { name: 'Save log' })).toHaveCount(0);
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
