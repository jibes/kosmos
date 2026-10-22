import { expect, test } from '@playwright/test';
import { isNight } from '../src/core/daylight';
import { CENTER } from './fixtures/scene';
import {
  SEARCH_HIT,
  routeRequests,
  liveTrip,
  planFails,
  transitRequests,
  tripRequests,
} from './fixtures/offline-world';
import { shot, idle, routeInView, jump, screenAt, inWorld, openRoute, watchPages } from './helpers';

watchPages();

test.describe('routes', () => {
  inWorld();

  test('routes to a place, with steps, by travel mode', async ({ page, context }, info) => {
    // Every way of travel in turn: past 30 s on a slow runner.
    test.slow();
    const card = await openRoute(page, context);
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    await expect(card.getByRole('radio', { name: 'Car' })).toHaveAttribute('aria-checked', 'true');
    // Two ways, both with toll roads, and one without.
    await expect(card.locator('.alts [role=radio]')).toHaveCount(3);
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

    // Looked elsewhere: the whole route on screen again, at a tap.
    await page.evaluate(() => window.kosmos!.jumpTo({ center: [0, 0], zoom: 5 }));
    // The location button: the user first, then, following, the whole route.
    await page.getByRole('button', { name: 'Show my location' }).click();
    await page.getByRole('button', { name: 'Show the whole route' }).click();
    await routeInView(
      page,
      [CENTER.lng + 0.01, CENTER.lat + 0.01],
      [SEARCH_HIT.lng, SEARCH_HIT.lat],
    );
  });

  test('shows the ways at once, not waiting for the towns on their signs', async ({
    page,
    context,
  }) => {
    // The towns come from zoom-10 tiles; these never answer.
    await page.route(/\/planet\/[^/]+\/10\/\d+\/\d+\.pbf/, () => undefined);
    const card = await openRoute(page, context);
    await expect(card.locator('.summary strong')).toHaveText(/min/, { timeout: 2000 });
  });

  test('changes the start and the destination of a route', async ({ page, context }) => {
    const card = await openRoute(page, context);
    await card.locator('.end-btn').first().click();
    const start = page.getByRole('combobox', { name: 'Search for a start' });
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
    const dest = page.getByRole('combobox', { name: 'Search for a destination' });
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

  test('swaps the start and the destination by their grips, and back', async ({
    page,
    context,
  }) => {
    const card = await openRoute(page, context);
    const ends = card.locator('.end-btn');
    await expect(ends).toHaveText(['My location', SEARCH_HIT.name]);
    // From the keyboard: the grip with the arrow keys, its focus kept as it moves.
    const grip = card.getByRole('button', { name: 'Move My location' });
    await grip.focus();
    await page.keyboard.press('ArrowDown');
    await expect(grip).toBeFocused();
    await expect(ends).toHaveText([SEARCH_HIT.name, 'My location']);
    // From the place to where the user is now.
    await expect.poll(() => routeRequests.at(-1)?.from[0]).toBeCloseTo(SEARCH_HIT.lng, 4);
    await expect.poll(() => routeRequests.at(-1)?.to[0]).toBeCloseTo(CENTER.lng + 0.01, 4);
    // Guidance always starts where the user is: towards there it has nowhere to go.
    await expect(card.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
    // Back again: "My location" is the live position again, not the point it was.
    await page.keyboard.press('ArrowUp');
    await expect(ends).toHaveText(['My location', SEARCH_HIT.name]);
    await expect.poll(() => routeRequests.at(-1)?.to[0]).toBeCloseTo(SEARCH_HIT.lng, 4);
    await expect(card.getByRole('button', { name: 'Use my location' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
  });

  test('offers a way without toll roads when every other has them, coins marking tolls', async ({
    page,
    context,
  }) => {
    const card = await openRoute(page, context);
    await expect(card.getByRole('radio', { name: 'Car' })).toHaveAttribute('aria-checked', 'true');
    const ways = card.locator('.alts [role="radio"]');
    await expect(ways).toHaveCount(3);
    // Both ways found have tolls: one more request, for a way without.
    expect(routeRequests.at(-2)!.noTolls).toBe(false);
    expect(routeRequests.at(-1)!.noTolls).toBe(true);
    for (const i of [0, 1]) await expect(ways.nth(i).locator('svg')).toHaveCount(1);
    await expect(ways.nth(2).locator('svg')).toHaveCount(0);
    await expect(ways.nth(0)).toContainText('Tolls');
    const summary = card.locator('.summary span');
    await expect(summary).toContainText('Tolls');
    await ways.nth(2).click();
    await expect(summary).not.toContainText('Tolls');
    // No toggle any more: the way is chosen like any other.
    await expect(card.getByRole('button', { name: /tolls/i })).toHaveCount(0);
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
    await expect(legs.locator('.ride .stops li')).toHaveText([
      /Stadtmitte/,
      /Französische Straße/,
      /Friedrichstraße/,
      /Unter den Linden/,
    ]);
    // The times in one column, the names beside them all at the same place.
    const lefts = await legs
      .locator('.ride .stops li span')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    expect(new Set(lefts).size).toBe(1);
    await expect(legs.locator('.ride time').first()).toHaveAttribute('data-late');
    await expect(legs.locator('.walk')).toHaveCount(2);
    await expect(card.locator('.summary')).toContainText('Direct');
    // Tickets from the operator of the ride, on its own website.
    const tickets = card.getByRole('link', { name: 'Tickets from BVG, on its website' });
    await expect(tickets).toHaveAttribute('href', 'https://www.bvg.de/');
    await expect(tickets).toHaveAttribute('target', '_blank');
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
    // The whole trip, minute by minute: past 30 s on a slow runner.
    test.slow();
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
    // The voice as last left (on at first): it speaks.
    const mute = page.getByRole('button', { name: 'Mute voice' });
    await expect(mute).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(spoken).not.toEqual([]);
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
    // On board the map shows the rest of the line, north up from above, to the stop to get off.
    const inView = (lng: number, lat: number) =>
      page.evaluate(
        ([lng, lat]) => {
          const p = window.kosmos!.project([lng, lat]);
          return p.x > 0 && p.y > 0 && p.x < innerWidth && p.y < innerHeight;
        },
        [lng, lat],
      );
    await expect.poll(() => inView(to.lng, stopLat)).toBe(true);
    expect(await page.evaluate(() => window.kosmos!.getPitch())).toBe(0);
    // The overview takes in the rest of the trip, the destination too.
    // The location button: following, the whole trip; then the rider again.
    await page.getByRole('button', { name: 'Show the whole route' }).click();
    await expect.poll(() => inView(to.lng, to.lat)).toBe(true);
    await page.getByRole('button', { name: 'Show my location' }).click();
    await expect(page.getByRole('button', { name: 'Show the whole route' })).toBeVisible();
    // Tapping the banner shows the whole trip: this ride open, the stop behind dimmed.
    await banner.click();
    const trip = page.locator('.ride-details');
    await expect(trip.locator('[data-current]')).toContainText('U6');
    // Closed at first: boarding and getting off, the stops between a tap away.
    const between = trip.locator('.stops li:not(.end)');
    await expect(between).toHaveCount(0);
    await expect(trip.locator('.ride .stops li.end')).toHaveCount(2);
    await trip.getByRole('button', { name: /Alt-Tegel/ }).click();
    await expect(trip.locator('.ride .stops li.end').first()).toHaveAttribute(
      'data-passed',
      'true',
    );
    await expect(between.first()).toHaveAttribute('data-passed', 'true');
    await expect(between.nth(1)).not.toHaveAttribute('data-passed');
    // A progress line: the next stop marked on it.
    await expect(trip.locator('.stops li[data-next]')).toHaveCount(1);
    await expect(between.nth(1)).toHaveAttribute('data-next', 'true');
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
    await expect(banner).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText('You have arrived');
  });

  test('plans again when Start comes after the connection has left', async ({ page, context }) => {
    await page.evaluate(() => {
      const w = window as unknown as { offset: number };
      w.offset = 0;
      const now = Date.now.bind(Date);
      Date.now = () => now() + w.offset;
    });
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({
      latitude: CENTER.lat + 0.01,
      longitude: CENTER.lng + 0.01,
      accuracy: 5,
    });
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const card = page.locator('.card.route');
    await card.getByRole('radio', { name: 'Public transport' }).click();
    await expect(card.locator('.legs .line').first()).toHaveText('U6');
    // The card left open past the U6's departure (minute 8).
    await page.evaluate(() => ((window as unknown as { offset: number }).offset = 9 * 60_000));
    const asked = transitRequests.length;
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'has left' })).toBeVisible();
    expect(transitRequests.length).toBe(asked + 1);
    await expect(page.locator('.nav-banner')).toHaveCount(0);
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
    // And none comes: the connection followed stays, said so, and can be asked for again.
    planFails.on = true;
    try {
      await banner.getByRole('button', { name: 'New connection' }).click();
      await expect.poll(() => transitRequests.length).toBe(asked + 1);
      const [lat, lng] = transitRequests.at(-1)!.get('fromPlace')!.split(',').map(Number);
      expect(lat).toBeCloseTo(stopLat, 4);
      expect(lng).toBeCloseTo(from.lng, 4);
      await expect(banner).toContainText('No public transport connection');
      await expect(banner).toContainText('U6 is cancelled');
      await expect(banner.getByRole('button', { name: 'New connection' })).toBeEnabled();
    } finally {
      planFails.on = false;
    }
  });

  test('gives up on a router that never answers, with Retry', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({
      latitude: CENTER.lat + 0.01,
      longitude: CENTER.lng + 0.01,
      accuracy: 5,
    });
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    // The router takes the request and never answers.
    await context.route(/valhalla1\.openstreetmap\.de\/route/, () => undefined);
    // The real 20 s: a fake clock installed mid-session races the app's own timers.
    test.setTimeout(60_000);
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    await expect(page.locator('.card.route').getByRole('button', { name: 'Retry' })).toBeVisible({
      timeout: 30_000,
    });
  });

  test('keeps the chosen route when a reroute fails', async ({ page, context }) => {
    // Twelve seconds off the route alone, then the failed reroute: past 30 s on a slow runner.
    test.slow();
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
    await expect(card.locator('.point-list')).not.toContainText('Brandenburger Tor');
    await expect.poll(() => routeRequests.at(-1)?.to[0]).toBeCloseTo(CENTER.lng, 3);
    // The pin moves to the new destination: it no longer marks the old one.
    // Polled: the map may still be easing to the new route.
    await expect
      .poll(async () => {
        await idle(page);
        const end = await screenAt(page, CENTER.lng, CENTER.lat);
        const pin = (await page.locator('.pin').boundingBox())!;
        return (
          Math.abs(pin.x + pin.width / 2 - end.x) < 4 && Math.abs(pin.y + pin.height - end.y) < 16
        );
      })
      .toBe(true);
  });

  test('a note with many choices stays clear of the map buttons', async ({ page, context }) => {
    // A small phone, where the choices of a dropped pin do not fit on one line.
    await page.setViewportSize({ width: 360, height: 740 });
    const card = await openRoute(page, context);
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    await idle(page);
    // High on the map, clear of the card.
    await page.mouse.click(180, 160, { button: 'right' });
    const note = page.locator('.toast');
    await expect(note.getByRole('button')).toHaveCount(3);
    const box = (await note.boundingBox())!;
    // Every choice inside the note, and the note left of the location button.
    for (const b of await note.getByRole('button').all()) {
      const r = (await b.boundingBox())!;
      expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
    const locate = (await page.locator('.controls > button').first().boundingBox())!;
    const overlaps =
      box.x < locate.x + locate.width &&
      box.x + box.width > locate.x &&
      box.y < locate.y + locate.height &&
      box.y + box.height > locate.y;
    expect(overlaps).toBe(false);
  });

  test("the destination's pin follows the list: a stop moved to the end, the end taken off", async ({
    page,
    context,
  }) => {
    const card = await openRoute(page, context);
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    // A stop where the map is held.
    await idle(page);
    const at = await screenAt(page, CENTER.lng, CENTER.lat);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.locator('.toast').getByRole('button', { name: 'Add stop' }).click();
    // It takes its address, and Undo still takes it off after that.
    await expect(card.locator('.point-list li').nth(1)).toContainText('Unter den Linden 5');
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
    await expect(card.locator('.point-list li')).toHaveCount(2);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.locator('.toast').getByRole('button', { name: 'Add stop' }).click();
    await expect(card.locator('.point-list li')).toHaveCount(3);
    /** How far the pin's tip stands from the trip's end as the router was last asked, px. */
    const offEnd = () =>
      page.evaluate((to) => {
        const pin = document.querySelector('.pin')!.getBoundingClientRect();
        const p = window.kosmos!.project(to as [number, number]);
        return Math.hypot(pin.x + pin.width / 2 - p.x, pin.bottom - p.y);
      }, routeRequests.at(-1)!.to);
    await expect.poll(offEnd).toBeLessThan(3);
    // The stop moved to the end by the keyboard: the route and the pin go there.
    const grip = card.getByRole('button', { name: 'Move Unter den Linden 5', exact: true });
    await grip.focus();
    await page.keyboard.press('ArrowDown');
    await expect(card.locator('.end-btn').last()).toHaveText('Unter den Linden 5');
    await expect.poll(() => routeRequests.at(-1)?.to[0]).toBeCloseTo(CENTER.lng, 2);
    await expect.poll(offEnd).toBeLessThan(3);
    await expect(page.locator('.pin')).toHaveCount(1);
    // That end taken off: the one before is the end again, and so is the pin.
    const last = card.locator('.point-list li').last();
    await last.getByRole('button', { name: /^Remove/ }).click();
    await expect(card.locator('.point-list li')).toHaveCount(2);
    await expect.poll(() => routeRequests.at(-1)?.to[0]).toBeCloseTo(SEARCH_HIT.lng, 4);
    await expect.poll(offEnd).toBeLessThan(3);
    // Closed, the card under it is the destination's.
    await card.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.locator('.card h2').first()).toHaveText(SEARCH_HIT.name);
  });

  test('goes by way of stops: added from the card or the map, taken off again', async ({
    page,
    context,
  }) => {
    // Eight route requests and a drag: near 30 s on its own, past it on a busy runner.
    test.slow();
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
    // From the card: a stop found by name.
    await card.getByRole('button', { name: /Add stop/ }).click();
    await page.getByRole('combobox', { name: 'Search for a stop' }).fill('brandenburg');
    await page.getByRole('option').filter({ hasText: 'Havel' }).click();
    await expect(card.locator('.point-list li')).toHaveCount(3);
    await expect.poll(() => routeRequests.at(-1)?.via.length).toBe(1);
    await expect(card.locator('.summary strong')).toHaveText(/min|h/);
    await expect(page.locator('.stop-dot')).toHaveText(['1']);
    // The steps say the stop by its name, and arrive only at the end.
    await card.locator('.steps summary').click();
    await expect(card.locator('.steps')).toContainText('Stop at Brandenburg');
    await expect(card.locator('.steps li').filter({ hasText: /^Arrive at/ })).toHaveCount(1);
    await card.locator('.steps summary').click();
    // From the map: a point held there.
    // Close in: fitted to the whole way, the point lies under the destination's pin and the dot.
    await page.evaluate(
      ([lng, lat]) => window.kosmos!.jumpTo({ center: [lng, lat], zoom: 15 }),
      [CENTER.lng, CENTER.lat],
    );
    await idle(page);
    // Clear of the card, which grows tall on a phone with three points (beside it in the side
    // layout: nothing to do).
    const cardBox = (await card.boundingBox())!;
    const held = await screenAt(page, CENTER.lng, CENTER.lat);
    const inside = held.x >= cardBox.x && held.x <= cardBox.x + cardBox.width;
    const under = inside ? held.y - (cardBox.y - 120) : 0;
    if (under > 0) {
      await page.evaluate((dy) => window.kosmos!.panBy([0, dy], { duration: 0 }), under);
      await idle(page);
    }
    const at = await screenAt(page, CENTER.lng, CENTER.lat);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.locator('.toast').getByRole('button', { name: 'Add stop' }).click();
    await expect(card.locator('.point-list li')).toHaveCount(4);
    await expect.poll(() => routeRequests.at(-1)?.via.length).toBe(2);
    // Where it was held, give or take the map settling under the pointer; nearer along the way
    // than the first stop, so before it.
    expect(routeRequests.at(-1)!.via[0][0]).toBeCloseTo(CENTER.lng, 2);
    // Its address, once looked up, as a start or destination held on the map has.
    await expect(card.locator('.point-list li').nth(1)).toContainText('Unter den Linden 5');
    await expect(page.locator('.stop-dot')).toHaveText(['1', '2']);
    // The second dragged above the first by its grip: the router asked in the new order.
    const grip = card.getByRole('button', { name: /^Move Brandenburg an/ });
    // Measured once the card has settled: it grows as the stops come in.
    await expect
      .poll(async () => {
        const y = (await grip.boundingBox())!.y;
        await page.waitForTimeout(200);
        return Math.abs((await grip.boundingBox())!.y - y);
      })
      .toBeLessThan(1);
    const above = (await card
      .getByRole('button', { name: 'Move Unter den Linden 5', exact: true })
      .boundingBox())!;
    const box = (await grip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, above.y + above.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(card.locator('.point-list li').nth(1)).toContainText('Brandenburg an');
    await expect.poll(() => routeRequests.at(-1)?.via[1][0]).toBeCloseTo(CENTER.lng, 2);
    // Public transport goes straight there: no stops asked, none offered.
    await card.getByRole('radio', { name: 'Public transport' }).click();
    await expect(card.getByRole('radio', { name: 'Public transport' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(card.locator('.point-list li')).toHaveCount(2);
    await expect(card.getByRole('button', { name: /Add stop/ })).toHaveCount(0);
    await card.getByRole('radio', { name: 'Car' }).click();
    await expect(card.locator('.point-list li')).toHaveCount(4);
    // Taken off again: straight there.
    await card.getByRole('button', { name: 'Remove Unter den Linden 5' }).click();
    await card.getByRole('button', { name: /^Remove Brandenburg an/ }).click();
    // Two left: neither comes off.
    await expect(card.getByRole('button', { name: /^Remove / })).toHaveCount(0);
    await expect.poll(() => routeRequests.at(-1)?.via.length).toBe(0);
    await expect(page.locator('.stop-dot')).toHaveCount(0);
  });

  test('reorders without the card shifting, the last ways kept while the new one comes', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.01, longitude: CENTER.lng + 0.01 });
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const card = page.locator('.card.route');
    await card.getByRole('button', { name: /Add stop/ }).click();
    await page.getByRole('combobox', { name: 'Search for a stop' }).fill('brandenburg');
    await page.getByRole('option').filter({ hasText: 'Havel' }).click();
    await expect(card.locator('.summary strong')).toHaveText(/min|h/);
    await idle(page);
    // A router as slow as a real one.
    await page.route(/valhalla1\.openstreetmap\.de\/route/, async (r) => {
      await new Promise((go) => setTimeout(go, 1500));
      await r.fallback();
    });
    // Every frame from the drop on: where the card and the first row are.
    const watch = () =>
      page.evaluate(() => {
        const w = window as unknown as { frames: number[][]; watching: boolean };
        w.frames = [];
        w.watching = true;
        // From the drop on: before it, the rows are still making room (and slower runners
        // are still sliding them there).
        let dropped = false;
        window.addEventListener('pointerup', () => (dropped = true), { capture: true, once: true });
        const tick = () => {
          if (!dropped) return void requestAnimationFrame(tick);
          const top = (q: string) =>
            Math.round(document.querySelector(q)!.getBoundingClientRect().top);
          w.frames.push([top('.card.route'), top('.point-list li'), top('.point-list')]);
          if (w.watching) requestAnimationFrame(tick);
        };
        tick();
      });
    const frames = () =>
      page.evaluate(() => {
        const w = window as unknown as { frames: number[][]; watching: boolean };
        w.watching = false;
        return w.frames;
      });
    const grip = card.getByRole('button', { name: /^Move Brandenburger Tor/ });
    const first = (await card
      .getByRole('button', { name: 'Move My location', exact: true })
      .boundingBox())!;
    const box = (await grip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, first.y + first.height / 2, { steps: 10 });
    await watch();
    await page.mouse.up();
    await expect(card.locator('.point-list li').first()).toContainText('Brandenburger Tor');
    // Dimmed, not gone, while the new way is asked for; Start waits for it.
    await expect(card).toHaveAttribute('aria-busy', 'true');
    await expect(card.locator('.summary strong')).toHaveText(/min|h/);
    await expect(card.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
    await expect(card).not.toHaveAttribute('aria-busy', 'true', { timeout: 5000 });
    const seen = await frames();
    // The card stays put, and the row dropped first is in its place at once, not sliding in.
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen.map(([c]) => c)).size).toBe(1);
    expect(seen.filter(([, row, list]) => row !== list)).toEqual([]);
  });

  test('adds a stop while guiding, or ends there instead: a label tapped, one route', async ({
    page,
    context,
  }) => {
    const from = { lng: CENTER.lng + 0.01, lat: CENTER.lat + 0.01 };
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: from.lat, longitude: from.lng, accuracy: 5 });
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    await expect(page.locator('.card.route .summary strong')).toHaveText(/min/);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const banner = page.locator('.nav-banner');
    await expect(banner).toBeVisible();
    // Once the camera has followed the first fix, the map is looked around: the café on the
    // way (again, should the camera still have been on its way back to the user).
    await expect.poll(() => page.evaluate(() => Math.round(window.kosmos!.getPitch()))).toBe(55);
    const cafe = { lng: CENTER.lng + 140 / 67800, lat: CENTER.lat - 170 / 111200 };
    let at = { x: 0, y: 0 };
    const seeCafe = () =>
      expect
        .poll(
          async () => {
            await jump(page, { ...cafe, zoom: 17 });
            at = await screenAt(page, cafe.lng, cafe.lat);
            return page.evaluate(
              ({ x, y }) =>
                window
                  .kosmos!.queryRenderedFeatures([
                    [x - 10, y - 10],
                    [x + 10, y + 10],
                  ])
                  .some((f) => f.properties.name === 'Café Einstein'),
              at,
            );
          },
          { timeout: 15_000 },
        )
        .toBe(true);
    await seeCafe();
    const asked = routeRequests.length;
    await page.mouse.click(at.x, at.y);
    await page.locator('.toast').getByRole('button', { name: 'Add stop' }).click();
    await expect.poll(() => routeRequests.length).toBe(asked + 1);
    const again = routeRequests.at(-1)!;
    // From here, by way of the café, one route.
    expect(again.from[0]).toBeCloseTo(from.lng, 4);
    expect(again.via[0][0]).toBeCloseTo(cafe.lng, 4);
    await expect(banner).toBeVisible();
    await expect(page.locator('.stop-dot')).toHaveText(['1']);
    // The steps ahead list it: taken off again, straight there from here.
    await banner.getByRole('button', { name: 'Show stops ahead' }).click();
    const list = page.locator('.ride-details .point-list li').filter({ hasText: 'Café' });
    await expect(list).toHaveText([/Café Einstein/]);
    await list.getByRole('button', { name: /^Remove Café/ }).click();
    await expect.poll(() => routeRequests.at(-1)?.via.length).toBe(0);
    await expect(page.locator('.stop-dot')).toHaveCount(0);
    await expect(banner).toBeVisible();
    // Changed plans: the café is where the trip now ends, one route there from here.
    await banner.getByRole('button', { name: 'Show stops ahead' }).click();
    await seeCafe();
    const before = routeRequests.length;
    await page.mouse.click(at.x, at.y);
    await page.locator('.toast').getByRole('button', { name: 'Go here' }).click();
    await expect.poll(() => routeRequests.length).toBe(before + 1);
    expect(routeRequests.at(-1)!.to[0]).toBeCloseTo(cafe.lng, 4);
    expect(routeRequests.at(-1)!.via).toEqual([]);
    await expect(banner).toBeVisible();
  });

  for (const how of ['tapped', 'by itself'] as const)
    test(`asks to skip a stop left behind, aloud, and goes on without it (${how})`, async ({
      page,
      context,
    }) => {
      await page.evaluate(() => {
        const w = window as unknown as { spoken: string[]; offset: number };
        w.spoken = [];
        w.offset = 0;
        const now = Date.now.bind(Date);
        Date.now = () => now() + w.offset;
        Object.defineProperty(window, 'speechSynthesis', {
          value: {
            speak: (u: SpeechSynthesisUtterance) => w.spoken.push(u.text),
            cancel: () => undefined,
            speaking: false,
            pending: false,
          },
        });
      });
      const seconds = (n: number) =>
        page.evaluate((ms) => ((window as unknown as { offset: number }).offset += ms), n * 1000);
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
      await card.getByRole('button', { name: /Add stop/ }).click();
      await page.getByRole('combobox', { name: 'Search for a stop' }).fill('brandenburg');
      await page.getByRole('option').filter({ hasText: 'Havel' }).click();
      await expect(card.locator('.summary strong')).toHaveText(/min|h/);
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(page.locator('.nav-banner')).toBeVisible();

      // The other way: east, off the route and further and further from the stop in the west.
      for (let i = 1; i <= 8; i++) {
        await seconds(3);
        await go(from.lng + 0.01 + i * 0.004, from.lat);
        await page.waitForTimeout(150);
      }
      const ask = page.locator('.toast').filter({ hasText: 'Skip the stop at' });
      await expect(ask).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken))
        .toContainEqual(expect.stringMatching(/leaving your stop .* behind/));
      const asked = routeRequests.length;
      // Skipped at a tap, or by itself once the question has waited 10 s.
      if (how === 'tapped') await ask.getByRole('button', { name: 'Skip' }).click();
      await expect(ask).toHaveCount(0, { timeout: 12_000 });
      // From here straight to the destination.
      await expect.poll(() => routeRequests.length).toBeGreaterThan(asked);
      expect(routeRequests.at(-1)!.via).toEqual([]);
      expect(routeRequests.at(-1)!.from[0]).toBeGreaterThan(from.lng + 0.03);
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

  test('says when no road for the way of travel is near an end', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.01, longitude: CENTER.lng + 0.01 });
    // What Valhalla answers for a point only private or footpaths reach.
    await page.route(/valhalla1\.openstreetmap\.de\/route/, (route) =>
      route.request().url().includes('auto')
        ? route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error_code: 171, error: 'No suitable edges near location' }),
          })
        : route.fallback(),
    );
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const card = page.locator('.card.route');
    await expect(card.locator('.route-msg')).toContainText(
      'No road for cars near the start or the destination',
    );
    // The other ways are offered as for no route at all.
    await expect(card.getByRole('group', { name: 'Try another way' })).toBeVisible();
  });

  test('asks again from the public roads when a gated car park has no way out', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.01, longitude: CENTER.lng + 0.01 });
    // As Valhalla answers from hotel grounds behind a private gate: roads at both ends, no path.
    await page.route(/valhalla1\.openstreetmap\.de\/route/, (route) => {
      const body = JSON.parse(new URL(route.request().url()).searchParams.get('json') ?? '{}');
      return body.locations[0].search_filter
        ? route.fallback()
        : route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error_code: 442, error: 'No path could be found for input' }),
          });
    });
    const asked = routeRequests.length;
    const card = await openRoute(page, context);
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    await expect(card.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
    expect(routeRequests.slice(asked).some((r) => r.publicEnds)).toBe(true);
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
    await expect(page.locator('.card.route .point-list')).toContainText('Unter den Linden 5');
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
