import { expect, test } from '@playwright/test';
import { isNight } from '../src/core/daylight';
import { CENTER } from './fixtures/scene';
import {
  SEARCH_HIT,
  routeRequests,
  liveTrip,
  transitRequests,
  tripRequests,
} from './fixtures/offline-world';
import { shot, idle, routeInView, jump, screenAt, inWorld, openRoute, watchPages } from './helpers';

watchPages();

test.describe('routes', () => {
  inWorld();

  test('routes to a place, with steps, by travel mode', async ({ page, context }, info) => {
    const card = await openRoute(page, context);
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    await expect(card.getByRole('radio', { name: 'Car' })).toHaveAttribute('aria-checked', 'true');
    await expect(card.locator('.alts [role=radio]')).toHaveCount(2);
    await expect(card).toContainText('My location');
    const drawn = await page.evaluate(() => {
      const src = window.kosmos!.getSource('route') as unknown as { _data: { geojson?: unknown } };
      return JSON.stringify(src._data);
    });
    expect(drawn).toContain('LineString');
    await idle(page);
    await shot(page, info, 'route');

    await card.locator('.steps summary').click();
    await expect(card.locator('.steps li')).toHaveCount(3);
    await expect(card.locator('.steps')).toContainText('Turn right onto Unter den Linden.');

    // Changing the travel mode re-centres on the new route, even after panning away.
    await page.evaluate(() => window.kosmos!.jumpTo({ center: [0, 0], zoom: 5 }));
    await card.getByRole('radio', { name: 'Walk' }).click();
    await routeInView(
      page,
      [CENTER.lng + 0.01, CENTER.lat + 0.01],
      [SEARCH_HIT.lng, SEARCH_HIT.lat],
    );
    await expect(card.getByRole('radio', { name: 'Walk' })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => routeRequests.at(-1)?.costing).toBe('pedestrian');
  });

  test('changes the start and the destination of a route', async ({ page, context }) => {
    const card = await openRoute(page, context);
    await card.locator('.end-btn').first().click();
    const start = page.getByRole('combobox', { name: 'Search start' });
    await expect(start).toBeFocused();
    await start.fill('brandenburg');
    await page.getByRole('option').nth(1).click();
    await expect(card.locator('.end-btn').first()).toHaveText('Brandenburg an der Havel');
    await expect.poll(() => routeRequests.at(-1)?.from[0]).toBeCloseTo(13.0, 3);
    await expect(page.locator('.start-dot')).toHaveCount(1);
    // The whole new route is in view once it is calculated.
    await idle(page);
    // The camera fits the whole new route clear of the card (slow on emulated phones).
    await routeInView(page, [13.0, 52.4], [SEARCH_HIT.lng, SEARCH_HIT.lat]);

    // Changing the start can be abandoned.
    await card.locator('.end-btn').first().click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(card.locator('.end-btn').first()).toHaveText('Brandenburg an der Havel');

    // The destination can be changed from the route view too.
    await card.locator('.end-btn').nth(1).click();
    const dest = page.getByRole('combobox', { name: 'Search destination' });
    await expect(dest).toBeFocused();
    await dest.fill('brandenburg');
    await page.getByRole('option', { name: /Havel/ }).click();
    await expect(card.locator('.end-btn').nth(1)).toHaveText('Brandenburg an der Havel');
    await expect.poll(() => routeRequests.at(-1)?.to[0]).toBeCloseTo(13.0, 4);

    await card.getByRole('button', { name: /close/i }).click();
    await expect(card).toHaveCount(0);
    // The place card follows the new destination.
    await expect(page.locator('.card').getByRole('heading')).toHaveText('Brandenburg an der Havel');
  });

  test('does not plan public transport again while the user moves', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    const go = (lng: number, lat: number) =>
      context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 10 });
    await go(CENTER.lng + 0.01, CENTER.lat + 0.01);
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const card = page.locator('.card.route');
    await card.getByRole('radio', { name: 'Public transport' }).click();
    await expect(card.locator('.legs')).toBeVisible();
    const asked = transitRequests.length;
    for (let i = 1; i <= 8; i++) {
      await go(CENTER.lng + 0.01 - i * 0.002, CENTER.lat + 0.01);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(500);
    expect(transitRequests.length).toBe(asked);
  });

  test('plans public transport, now or at a chosen time', async ({ page, context }, info) => {
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
    const asked = transitRequests.length;
    await card.getByRole('radio', { name: 'Public transport' }).click();

    const legs = card.locator('.legs');
    await expect(legs.locator('.line').first()).toHaveText('U6');
    await expect(legs).toContainText('Platform 2');
    await expect(legs).toContainText('→ Alt-Tegel · 3 stops · +2 min late');
    // A ride opens to every stop with its time.
    await legs.getByRole('button', { name: /Alt-Tegel/ }).click();
    await expect(legs.locator('.stops li')).toHaveText([/Französische Straße/, /Friedrichstraße/]);
    await expect(legs.locator('.ride time').first()).toHaveAttribute('data-late');
    await expect(legs.locator('.walk')).toHaveCount(2);
    await expect(card.locator('.summary')).toContainText('Direct');
    // Two connections and walking the whole way; each tile names its lines with their vehicle.
    const tiles = card.locator('.alts [role=radio]');
    await expect(tiles).toHaveCount(3);
    await expect(tiles.first().locator('.line')).toHaveText('U6');
    await expect(tiles.first().locator('.line svg')).toHaveCount(1);
    await expect(tiles.nth(2).locator('.line')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
    await expect(card.getByRole('link', { name: 'Timetables via Transitous' })).toBeVisible();
    expect(transitRequests.length).toBe(asked + 1);
    expect(transitRequests.at(-1)!.has('time')).toBe(false);

    // The chosen connection draws its ride in the line's colour and its walks dotted.
    const drawn = () =>
      page.evaluate(() =>
        window
          .kosmos!.querySourceFeatures('route')
          .map((f) => (f.properties.walk ? 'walk' : (f.properties.color ?? 'line'))),
      );
    await expect.poll(drawn).toContain('#8c6dab');
    await expect.poll(drawn).toContain('walk');
    await idle(page);
    await shot(page, info, 'transit');

    // A later departure asks once, after typing settles; "Now" goes back.
    await card.locator('.depart input').fill('08:30');
    await expect.poll(() => transitRequests.length).toBe(asked + 2);
    const time = new Date(transitRequests.at(-1)!.get('time')!);
    expect([time.getHours(), time.getMinutes()]).toEqual([8, 30]);
    await card.getByRole('button', { name: 'Now' }).click();
    await expect.poll(() => transitRequests.length).toBe(asked + 3);
    expect(transitRequests.at(-1)!.has('time')).toBe(false);
    await page.waitForTimeout(1200);
    expect(transitRequests.length).toBe(asked + 3);
  });

  test('guides a public transport trip: walk, board, ride, get off', async ({
    page,
    context,
  }, info) => {
    await page.evaluate(() => {
      const w = window as unknown as { spoken: string[]; offset: number };
      w.spoken = [];
      Object.defineProperty(window, 'speechSynthesis', {
        value: { speak: (u: SpeechSynthesisUtterance) => w.spoken.push(u.text), cancel: () => {} },
      });
      // A clock the test can move: the timetable runs in minutes, the test in seconds.
      w.offset = 0;
      const now = Date.now.bind(Date);
      Date.now = () => now() + w.offset;
    });
    const minutes = (n: number) =>
      page.evaluate((ms) => ((window as unknown as { offset: number }).offset = ms), n * 60_000);
    const spoken = () => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken);
    const from = { lng: CENTER.lng + 0.01, lat: CENTER.lat + 0.01 };
    const to = SEARCH_HIT;
    // The fixture's stops: halfway up in latitude, at the start's and the destination's longitude.
    const stopLat = (from.lat + to.lat) / 2 + 0.002;
    const go = (lng: number, lat: number) =>
      context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
    await context.grantPermissions(['geolocation']);
    await go(from.lng, from.lat);
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const card = page.locator('.card.route');
    await card.getByRole('radio', { name: 'Public transport' }).click();
    await expect(card.locator('.legs .line').first()).toHaveText('U6');
    await card.getByRole('button', { name: 'Start', exact: true }).click();

    // The first connection: walk minutes 3–8, U6 8–20 with stops at 12 and 16, walk 20–25.
    // A departure check finds it three minutes late: 11–23, stops at 15 and 19.
    const banner = page.locator('.nav-banner');
    const checks = tripRequests.length;
    await expect(banner).toContainText('Walk to Stadtmitte');
    await expect(banner).toContainText('U6 leaves');
    // The walk's next turn leads, with the metres to it.
    await expect(banner.locator('p')).toHaveText('Dorotheenstraße');
    // Among people, public transport guidance starts silent; a tap lets it speak.
    const mute = page.getByRole('button', { name: 'Mute voice' });
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(500);
    expect(await spoken()).toEqual([]);
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    // After sunset the map goes dark on public transport too.
    const night = await page
      .evaluate(() => Date.now())
      .then((now) => isNight(from.lat, from.lng, now));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe(night ? 'dark' : 'light');

    await minutes(6);
    await go(from.lng, stopLat);
    await expect(banner.locator('.line')).toHaveText('U6');
    await expect(banner).toContainText('→ Alt-Tegel');
    await expect
      .poll(spoken)
      .toContainEqual(expect.stringMatching(/^Take the U6 towards Alt-Tegel/));
    // Within ten minutes of departure: one check, which brings the live platform.
    await expect(banner).toContainText('Platform 3', { timeout: 10_000 });
    expect(tripRequests.length).toBe(checks + 1);
    expect(tripRequests.at(-1)!.get('tripId')).toBe('u6-3');
    // What changed is said, once each: the new platform and the delay.
    await expect.poll(spoken).toContain('U6 now leaves from platform 3.');
    await expect.poll(spoken).toContain('U6 is 3 minutes late.');
    // The map follows the dot to the stop and keeps it on screen.
    await idle(page);
    const dot = await page.locator('.me').boundingBox();
    const view = page.viewportSize()!;
    expect(dot!.y).toBeGreaterThan(0);
    expect(dot!.y).toBeLessThan(view.height);

    // Underground: no fixes, the (live) timetable counts the stops.
    await minutes(16);
    await expect(banner).toContainText('2 stops', { timeout: 10_000 });
    await expect(banner).toContainText('Get off at Unter den Linden');
    // Tapping the banner shows the whole trip: this ride open, the stop behind dimmed.
    await banner.click();
    const trip = page.locator('.ride-details');
    await expect(trip.locator('[data-current]')).toContainText('U6');
    await expect(trip.locator('.stops li').first()).toHaveAttribute('data-passed', 'true');
    await expect(trip.locator('.stops li').nth(1)).not.toHaveAttribute('data-passed');
    await expect(trip.locator('.walk').first()).toHaveAttribute('data-done', 'true');
    // The banner keeps its place at the top, the trip right under it: nothing shifted over it.
    await expect
      .poll(async () => {
        const [b, d, top] = await Promise.all([
          banner.boundingBox(),
          trip.boundingBox(),
          page.locator('.ride-top').boundingBox(),
        ]);
        if (!b || !d || !top) return null;
        return {
          left: Math.round(b.x - top.x),
          top: Math.round(b.y - top.y),
          right: Math.round(top.x + top.width - (b.x + b.width)),
          clear: b.y + b.height <= d.y + 0.5,
        };
      })
      .toEqual({ left: 0, top: 0, right: 0, clear: true });
    await shot(page, info, 'riding');
    // Back (here Escape) closes the trip first, and guidance goes on.
    await page.keyboard.press('Escape');
    await expect(trip).toHaveCount(0);
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(banner).toBeVisible();
    await minutes(20);
    await expect(banner).toContainText('Next stop', { timeout: 10_000 });
    await expect.poll(spoken).toContain('Get off at the next stop, Unter den Linden.');
    expect(tripRequests.length).toBe(checks + 1);

    await minutes(24);
    await go(to.lng, stopLat);
    await expect(banner).toContainText('Walk to Brandenburger Tor');
    await go(to.lng, to.lat);
    await expect(banner).toContainText('You have arrived');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(banner).toHaveCount(0);
  });

  test('plans a new connection from the stop when the position is old', async ({
    page,
    context,
  }) => {
    await page.evaluate(() => {
      const w = window as unknown as { offset: number };
      w.offset = 0;
      const now = Date.now.bind(Date);
      Date.now = () => now() + w.offset;
    });
    const minutes = (n: number) =>
      page.evaluate((ms) => ((window as unknown as { offset: number }).offset = ms), n * 60_000);
    const from = { lng: CENTER.lng + 0.01, lat: CENTER.lat + 0.01 };
    const stopLat = (from.lat + SEARCH_HIT.lat) / 2 + 0.002;
    const go = (lng: number, lat: number) =>
      context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
    // The live trip says the U6 does not run.
    liveTrip.cancelled = true;
    await context.grantPermissions(['geolocation']);
    await go(from.lng, from.lat);
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const card = page.locator('.card.route');
    await card.getByRole('radio', { name: 'Public transport' }).click();
    await expect(card.locator('.legs .line').first()).toHaveText('U6');
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    const banner = page.locator('.nav-banner');
    await minutes(6);
    await go(from.lng, stopLat);
    await expect(banner).toContainText('U6 is cancelled', { timeout: 10_000 });
    // In the station, no fix for a while: the new plan starts at the stop, not the old fix.
    await minutes(7);
    const asked = transitRequests.length;
    await banner.getByRole('button', { name: 'New connection' }).click();
    await expect.poll(() => transitRequests.length).toBe(asked + 1);
    const [lat, lng] = transitRequests.at(-1)!.get('fromPlace')!.split(',').map(Number);
    expect(lat).toBeCloseTo(stopLat, 4);
    expect(lng).toBeCloseTo(from.lng, 4);
  });

  test('keeps the chosen route when a reroute fails', async ({ page, context }) => {
    const from = { lng: CENTER.lng + 0.01, lat: CENTER.lat + 0.01 };
    const go = (lng: number, lat: number) =>
      context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
    await context.grantPermissions(['geolocation']);
    await go(from.lng, from.lat);
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const card = page.locator('.card.route');
    // The other way round: west first, then south.
    await card.locator('.alts [role=radio]').nth(1).click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const drawnCorner = () =>
      page.evaluate(
        ([lng, lat]) => {
          const src = window.kosmos!.getSource('route') as unknown as {
            _data: { geojson?: GeoJSON.FeatureCollection };
          };
          const coords = (src._data.geojson?.features ?? []).flatMap((f) =>
            f.geometry.type === 'LineString' ? f.geometry.coordinates : [],
          );
          return coords.some(([x, y]) => Math.abs(x - lng) < 1e-4 && Math.abs(y - lat) < 1e-4);
        },
        [SEARCH_HIT.lng, from.lat],
      );
    await expect.poll(drawnCorner).toBe(true);
    await page.route(/valhalla1\.openstreetmap\.de\/route/, (route) => route.abort());
    for (let i = 0; i < 12; i++) {
      await go(from.lng + 0.004 + i * 0.00001, from.lat - 0.004);
      await page.waitForTimeout(1000);
    }
    await expect(page.locator('.nav-banner')).toContainText('No new route yet', {
      timeout: 15_000,
    });
    // Still the route the user chose, not the router's first one.
    expect(await drawnCorner()).toBe(true);
  });

  test('a point on the map becomes the destination of an open route', async ({ page, context }) => {
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
    await idle(page);
    const at = await screenAt(page, CENTER.lng, CENTER.lat);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.locator('.toast').getByRole('button', { name: 'Go here' }).click();
    await expect(card.locator('.ends')).not.toContainText('Brandenburger Tor');
    await expect.poll(() => routeRequests.at(-1)?.to[0]).toBeCloseTo(CENTER.lng, 3);
    // The pin moves to the new destination: it no longer marks the old one.
    await idle(page);
    const end = await screenAt(page, CENTER.lng, CENTER.lat);
    const pin = (await page.locator('.pin').boundingBox())!;
    expect(Math.abs(pin.x + pin.width / 2 - end.x)).toBeLessThan(4);
    expect(Math.abs(pin.y + pin.height - end.y)).toBeLessThan(16);
  });

  test('offers another way when there is no route', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.01, longitude: CENTER.lng + 0.01 });
    await page.route(/valhalla1\.openstreetmap\.de\/route/, (route) =>
      route.request().url().includes('auto')
        ? route.fulfill({ status: 400, body: '{}' })
        : route.fallback(),
    );
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const card = page.locator('.card.route');
    const start = card.getByRole('button', { name: 'Start', exact: true });
    await expect(card.locator('.route-msg')).toContainText('No route by car');
    // No dead Start: the way on is another mode, each named.
    await expect(start).toHaveCount(0);
    const other = card.getByRole('group', { name: 'Try another way' });
    await expect(other.getByRole('button')).toHaveText(['By bike', 'On foot', 'Public transport']);
    await other.getByRole('button', { name: 'On foot' }).click();
    await expect(card.getByRole('radio', { name: 'Walk' })).toHaveAttribute('aria-checked', 'true');
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    await expect(start).toBeEnabled();
  });

  test('a route to a dropped pin takes its address once it comes', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.01, longitude: CENTER.lng + 0.01 });
    // The address takes its time; the route is asked for at once.
    await page.route(/photon\.komoot\.io\/reverse/, async (route) => {
      await new Promise((done) => setTimeout(done, 1500));
      await route.fallback();
    });
    await jump(page, { ...CENTER, zoom: 16 });
    const at = await screenAt(page, CENTER.lng, CENTER.lat);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    const card = page.locator('.card');
    await expect(card.getByRole('heading')).toHaveText('Dropped pin');
    await card.getByRole('button', { name: /^Route$/ }).click();
    await expect(page.locator('.card.route .ends')).toContainText('Unter den Linden 5');
  });

  test('remembers the travel mode; Escape closes one layer at a time', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.01, longitude: CENTER.lng + 0.01 });
    const openRoute = async () => {
      await page.getByRole('combobox').fill('brandenburger');
      await page.getByRole('option').first().click();
      await page
        .locator('.card')
        .getByRole('button', { name: /^Route$/ })
        .click();
    };
    await openRoute();
    const card = page.locator('.card.route');
    await card.getByRole('radio', { name: 'Walk' }).click();
    await expect.poll(() => routeRequests.at(-1)?.costing).toBe('pedestrian');
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(page.locator('.card').getByRole('heading')).toHaveText('Brandenburger Tor');
    await page.keyboard.press('Escape');
    await expect(page.locator('.card')).toHaveCount(0);

    await page.reload();
    await openRoute();
    await expect(card.getByRole('radio', { name: 'Walk' })).toHaveAttribute('aria-checked', 'true');
  });
});
