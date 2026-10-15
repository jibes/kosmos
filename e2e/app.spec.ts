import { writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { isNight, TUNNEL_HOLD_MS } from '../src/core/daylight';
import { CENTER } from './fixtures/scene';
import {
  SEARCH_HIT,
  lookupRequests,
  nominatimSearches,
  offlineWorld,
  photonSearches,
  routeRequests,
  liveTrip,
  tileset,
  transitRequests,
  tripRequests,
} from './fixtures/offline-world';

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
  liveTrip.cancelled = false;
  tileset.build = '20261001_001001_pt';
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
});

/** Waits until both points are on screen and not hidden under the panel. */
async function routeInView(page: Page, a: [number, number], b: [number, number]) {
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

/**
 * Wide screens: the map the user sees lies beside the panel, and category distances count from
 * its middle. Puts the view's centre there, as a user looking at it would.
 */
async function centreBeside(page: Page) {
  await page.evaluate(() => {
    if (!matchMedia('(min-width: 900px), (orientation: landscape) and (min-width: 560px)').matches)
      return;
    const left = document.querySelector('.panel')!.getBoundingClientRect().right;
    window.kosmos!.panBy([-left / 2, 0], { duration: 0 });
  });
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

  /** From the user's location (north-east of CENTER) to the search hit, route card open. */
  async function openRoute(page: Page, context: BrowserContext) {
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

  test('navigates turn by turn with spoken prompts', async ({ page, context }, info) => {
    await page.evaluate(() => {
      const spoken: string[] = [];
      const w = window as unknown as { spoken: string[]; cancels: number };
      w.spoken = spoken;
      w.cancels = 0;
      Object.defineProperty(window, 'speechSynthesis', {
        value: {
          speak: (u: SpeechSynthesisUtterance) => spoken.push(u.text),
          cancel: () => w.cancels++,
          speaking: false,
          pending: false,
        },
      });
    });
    const from = { lng: CENTER.lng + 0.01, lat: CENTER.lat + 0.01 };
    const to = SEARCH_HIT;
    const corner = { lng: from.lng, lat: to.lat };
    const go = (p: { lng: number; lat: number }) =>
      context.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy: 5 });
    await context.grantPermissions(['geolocation']);
    await go(from);
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    await expect(page.locator('.card.route .summary strong')).toHaveText(/min/);
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    const banner = page.locator('.nav-banner');
    // The position already known counts at once: the first turn ahead, with its distance. The
    // arrow says which way; the line says the street, the sentence is for screen readers.
    await expect(banner.locator('p [aria-hidden]')).toHaveText('Unter den Linden');
    await expect(banner.locator('p .sr-only')).toHaveText('Turn right onto Unter den Linden.');
    await expect(banner.locator('strong')).toHaveText(/km$/);
    await expect(page.locator('.me.nav')).toHaveCount(1);
    await expect(page.locator('.panel')).toBeHidden();
    // Time left leads the bar; the clock time says it is the arrival.
    await expect(page.locator('.nav-eta strong')).toHaveText(/min$/);
    await expect(page.locator('.nav-eta span')).toContainText('arrival');
    const spoken = () => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken);
    await expect.poll(spoken).toContain('Head south on Friedrichstraße.');
    // Lanes stay out of the way while the turn is far.
    await expect(page.locator('.nav-lanes')).toHaveCount(0);

    // Drive south along the first leg towards the turn.
    for (const f of [0.2, 0.5, 0.8, 0.97]) {
      await go({ lng: from.lng, lat: from.lat + (corner.lat - from.lat) * f });
      await page.waitForTimeout(250);
    }
    await expect(banner).toContainText('Turn right onto Unter den Linden.');
    const lanes = banner.locator('.nav-lanes');
    await expect(lanes).toHaveAttribute('data-size', 'big');
    await expect(lanes.locator('span')).toHaveCount(3);
    await expect(lanes.locator('span').nth(2)).toHaveAttribute('data-use', 'best');
    // The test's GPS jumps hundreds of metres a quarter second: no such speed is shown.
    await expect(page.locator('.speed')).toHaveCount(0);
    await expect(banner.locator('strong')).toHaveText(/m$/);
    // The router's alert says no distance; the spoken prompt adds it.
    await expect
      .poll(async () => (await spoken()).find((w) => w.includes('Unter den Linden')))
      .toMatch(/^In [\d.]+ (metres|kilometres), turn right onto Unter den Linden\.$/);
    await expect(page.locator('.me.nav')).toHaveCount(1);
    await idle(page);
    await shot(page, info, 'navigating');

    for (const f of [0.3, 0.7, 1]) {
      await go({ lng: corner.lng + (to.lng - corner.lng) * f, lat: to.lat });
      await page.waitForTimeout(250);
    }
    await expect(banner).toContainText('You have arrived');
    await expect(page.locator('.speed')).toHaveCount(0);
    await expect(page.locator('.nav-eta')).toHaveText(SEARCH_HIT.name);
    // Every prompt was queued: none cut another off.
    expect(await page.evaluate(() => (window as unknown as { cancels: number }).cancels)).toBe(0);

    // Done closes the trip: the destination's card is back, and no route is asked for from
    // the destination to itself.
    const asked = routeRequests.length;
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.locator('.card.route')).toHaveCount(0);
    await expect(page.locator('.card').getByRole('heading')).toHaveText(SEARCH_HIT.name);
    await page.waitForTimeout(500);
    expect(routeRequests.length).toBe(asked);
  });

  test('keeps the camera on the user who leaves the route far behind', async ({
    page,
    context,
  }) => {
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
    await expect(page.locator('.card.route .summary strong')).toHaveText(/min/);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.locator('.nav-banner')).toContainText('Turn right onto Unter den Linden.');
    await page.route(/valhalla1\.openstreetmap\.de\/route/, (route) => route.abort());
    // East, away from the route (which runs south), for 1.5 km.
    for (let i = 1; i <= 15; i++) {
      await go(from.lng + i * 0.0015, from.lat - 0.001);
      await page.waitForTimeout(150);
    }
    await idle(page);
    const where = await page.evaluate(() => {
      const r = document.querySelector('.me')!.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: innerWidth, h: innerHeight };
    });
    expect(where.x).toBeGreaterThan(0);
    expect(where.x).toBeLessThan(where.w);
    expect(where.y).toBeGreaterThan(0);
    expect(where.y).toBeLessThan(where.h);
  });

  test('never leaves guidance without an End, also while its route is still coming', async ({
    page,
  }) => {
    // No location at all; the route starts at a place chosen instead.
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const card = page.locator('.card.route');
    await card.getByRole('button', { name: 'Choose start' }).click();
    await page.getByRole('combobox').fill('brandenburg');
    await page.getByRole('option').filter({ hasText: 'Havel' }).click();
    await expect(card.locator('.summary strong')).toHaveText(/min|h/);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    // Guidance starts from where the user is, which is not known: it says so, and End works.
    const banner = page.locator('.nav-banner');
    await expect(banner).toContainText(/Location is off|location is not available|Waiting/);
    await page.getByRole('button', { name: 'End' }).click();
    await page.getByRole('button', { name: /(Tap|Click) again to end navigation/ }).click();
    await expect(banner).toHaveCount(0);
    await expect(card).toBeVisible();
  });

  test('follows the sun while navigating: light by day on a dark system, dark in a tunnel', async ({
    page,
    context,
  }) => {
    const from = { lng: CENTER.lng + 0.01, lat: CENTER.lat + 0.01 };
    const to = SEARCH_HIT;
    const go = (p: { lng: number; lat: number }) =>
      context.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy: 5 });
    const west = (x: number) => go({ lng: CENTER.lng + x / 67800, lat: to.lat });
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    // The phone is set to dark; outside navigation that is what shows.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(theme).toBe('dark');
    // Midday in Berlin, whenever the test runs; the clock keeps ticking from there.
    await page.evaluate(() => {
      const noon = new Date().setUTCHours(11, 0, 0, 0);
      const offset = noon - Date.now();
      const now = Date.now.bind(Date);
      Date.now = () => now() + offset;
    });
    await context.grantPermissions(['geolocation']);
    await go(from);
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    for (const f of [0.5, 1]) {
      await go({ lng: from.lng, lat: from.lat + (to.lat - from.lat) * f });
      await page.waitForTimeout(250);
    }
    await west(500);
    await expect.poll(theme).toBe('light');
    // Tunnels come from loaded tiles; a phone sends a fix a second, this test only one inside.
    await idle(page);
    await west(150);
    await expect.poll(theme).toBe('dark');
    expect(await page.evaluate(() => window.kosmos!.getStyle().name)).toBe('kOSMos dark');
    // Underground GPS stops: with no fix for longer than the hold, it stays dark.
    await page.waitForTimeout(TUNNEL_HOLD_MS + 1500);
    expect(await theme()).toBe('dark');
    await west(-450);
    await expect.poll(theme, { timeout: 8000 }).toBe('light');
    expect(await page.evaluate(() => window.kosmos!.getStyle().name)).toBe('kOSMos light');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(223, 229, 236)');
    // End next to Mute asks for a second tap.
    await page.getByRole('button', { name: 'End' }).click();
    await expect(page.locator('.nav-banner')).toHaveCount(1);
    await page.getByRole('button', { name: /(Tap|Click) again to end navigation/ }).click();
    await expect.poll(theme).toBe('dark');
  });

  test('keeps guiding when a reroute fails, and again once back on the route', async ({
    page,
    context,
  }) => {
    await page.evaluate(() => {
      const w = window as unknown as { offset: number };
      w.offset = 0;
      const now = Date.now.bind(Date);
      Date.now = () => now() + w.offset;
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
    await expect(page.locator('.card.route .summary strong')).toHaveText(/min/);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    const banner = page.locator('.nav-banner');
    await expect(banner).toContainText('Turn right onto Unter den Linden.');

    // The router is gone; the driver leaves the route for good.
    await page.route(/valhalla1\.openstreetmap\.de\/route/, (route) => route.abort());
    const lat = from.lat - 0.002;
    for (let i = 0; i < 6; i++) {
      await seconds(3);
      await go(from.lng + 0.004 + i * 0.00001, lat);
      await page.waitForTimeout(200);
    }
    await expect(banner).toContainText('No new route yet');
    // Back on the route: guidance carries on, no "finding a new route" left behind.
    await seconds(3);
    await go(from.lng, lat - 0.0005);
    await expect(banner).toContainText('Turn right onto Unter den Linden.');
    await expect(banner).not.toContainText('route');
    await expect(banner.locator('strong')).toHaveText(/m$/);

    // Escape (Android: back) asks first, then ends.
    await page.keyboard.press('Escape');
    await expect(page.locator('.toast')).toContainText('again to end');
    await expect(banner).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(banner).toHaveCount(0);
  });

  test('never shows the places of a category as answers to a name', async ({ page, context }) => {
    await context.route(/photon\.komoot\.io\/api\//, async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.fallback();
    });
    await jump(page, { ...CENTER, zoom: 14 });
    const input = page.getByRole('combobox');
    await input.fill('restaurant');
    await input.press('Enter');
    await expect(page.getByRole('option').filter({ hasText: 'Zur Letzten Instanz' })).toHaveCount(
      1,
    );
    await input.fill('brandenburger');
    await page.waitForTimeout(300);
    await expect(page.getByRole('option').filter({ hasText: 'Zur Letzten Instanz' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('option').first()).toContainText(SEARCH_HIT.name);
  });

  test('finds places by category from the map, nearest first', async ({ page }, info) => {
    await jump(page, { ...CENTER, zoom: 11 });
    await centreBeside(page);
    const input = page.getByRole('combobox');
    // The word offers the kind of place as the top row; Enter takes it.
    await input.fill('restaurant');
    const options = page.getByRole('option');
    await expect(options.first()).toHaveText(/Restaurants/);
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(input).toHaveValue('Restaurants');

    // A zoom-in, then up to 48 tiles read: slow machines need longer than the default.
    await expect(options).toHaveCount(3, { timeout: 10_000 });
    await expect(options.first()).toContainText('Zur Letzten Instanz');
    await expect(options.first()).toContainText(/\d+ m/);
    await expect(options.nth(2)).toContainText('Borchardt');
    // Found from far out, though the tiles on screen hold only the most important places;
    // the first search from a very wide view looked closer, once, but not all the way.
    const zoom = () => page.evaluate(() => window.kosmos!.getZoom());
    expect(await zoom()).toBeCloseTo(12, 1);
    const dots = () =>
      page.evaluate(async () => {
        const src = window.kosmos!.getSource('search') as import('maplibre-gl').GeoJSONSource;
        const data = (await src.getData()) as GeoJSON.FeatureCollection;
        return data.features.length;
      });
    await expect.poll(dots).toBe(3);
    // A category preselects nothing: Enter means "show me all of them".
    await expect(page.locator('[role=option][aria-selected=true]')).toHaveCount(0);
    await shot(page, info, 'category');
    await input.press('Enter');
    await expect(options).toHaveCount(0);
    // The fit starts once the list has closed (next frame); a click before it ends would stop it.
    await expect.poll(zoom).toBeGreaterThan(13);
    await idle(page);
    // All of them on screen, centred in the map the search bar leaves free, not crowded at the top.
    const spread = await page.evaluate(() => {
      const m = window.kosmos!;
      const { height } = m.getCanvas().getBoundingClientRect();
      // On a phone the search bar sits at the bottom; on a wide screen the panel is at the side.
      const free = matchMedia('(min-width: 900px)').matches
        ? height
        : document.querySelector('.panel')!.getBoundingClientRect().top;
      const ys = [
        [13.405 + 60 / 67800, 52.52 + 40 / 111200],
        [13.405 - 300 / 67800, 52.52 + 200 / 111200],
        [13.405 + 500 / 67800, 52.52 - 400 / 111200],
      ].map(([lng, lat]) => m.project([lng, lat]).y);
      return { top: Math.min(...ys) / free, bottom: Math.max(...ys) / free, height };
    });
    expect(spread.top).toBeGreaterThan(0.05);
    expect(spread.bottom).toBeLessThan(0.97);
    expect((spread.top + spread.bottom) / 2).toBeGreaterThan(0.35);

    // A dot on the map opens its place.
    const borchardt = await page.evaluate(() =>
      window.kosmos!.project([13.405 + 500 / 67800, 52.52 - 400 / 111200]),
    );
    // Drawn under the pointer first: a busy test machine may still be placing it.
    await expect
      .poll(() =>
        page.evaluate(
          ({ x, y }) =>
            window.kosmos!.queryRenderedFeatures([x, y]).some((f) => f.source === 'search'),
          borchardt,
        ),
      )
      .toBe(true);
    await page.mouse.click(borchardt.x, borchardt.y);
    await expect(page.locator('.card').getByRole('heading')).toHaveText('Borchardt');
    await page.locator('.card').getByRole('button', { name: /close/i }).click();

    // Up close, the map's own label of a result gives way to the result's name: never twice.
    await jump(page, { lng: 13.405 + 500 / 67800, lat: 52.52 - 400 / 111200, zoom: 17 });
    const named = (layer: string) =>
      page.evaluate(
        (l) => window.kosmos!.queryRenderedFeatures({ layers: [l] }).map((f) => f.properties.name),
        layer,
      );
    await expect.poll(() => named('search-names')).toContain('Borchardt');
    expect(await named('label-poi')).not.toContain('Borchardt');

    // Typed in German, groceries: supermarket and bakery in view.
    await jump(page, { ...CENTER, zoom: 15 });
    await input.fill('Lebensmittel');
    await options.filter({ hasText: 'Groceries' }).click();
    await expect(options).toHaveCount(2);
    await expect(options.first()).toContainText('Kiezmarkt');
    await options.first().click();
    await expect(page.locator('.card').getByRole('heading')).toHaveText('Kiezmarkt');

    await input.fill('');
    await expect.poll(dots).toBe(0);
  });

  test('offers a kind of place above the names, chosen by tap', async ({ page }) => {
    await jump(page, { ...CENTER, zoom: 14 });
    await idle(page);
    const input = page.getByRole('combobox');
    await input.fill('Muse');
    const suggestion = page.getByRole('option', { name: /Museums and galleries/ });
    await expect(suggestion).toContainText('Places in view');
    await suggestion.click();
    await expect(input).toHaveValue('Museums and galleries');
    await expect(page.getByRole('option')).toHaveText([/Pergamonmuseum/]);
    // Editing the text searches by name again.
    await input.fill('Muse');
    await expect(suggestion).toBeVisible();
  });

  test('offers to search a new area only after the user moves the map', async ({
    page,
    context,
  }) => {
    // Real drags with the map settling after each: slow on the emulated phone.
    test.slow();
    await jump(page, { ...CENTER, zoom: 14 });
    await idle(page);
    const input = page.getByRole('combobox');
    await input.fill('Restaurants');
    await input.press('Enter');
    await expect(page.getByRole('option')).toHaveCount(3);
    const zoom = () => page.evaluate(() => window.kosmos!.getZoom());
    const dots = () =>
      page.evaluate(async () => {
        const src = window.kosmos!.getSource('search') as import('maplibre-gl').GeoJSONSource;
        const data = (await src.getData()) as GeoJSON.FeatureCollection;
        return data.features.length;
      });
    await expect.poll(dots).toBe(3);
    await input.blur();

    // The app's own camera moves (here: locate) do not count as looking elsewhere.
    const here = page.getByRole('button', { name: 'Search this area' });
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.03, longitude: CENTER.lng });
    await page.locator('.controls > button').first().click();
    await idle(page);
    await expect(here).toHaveCount(0);

    // Dragging the map away offers to search the new area, without changing the zoom; there
    // is nothing there, and back home there is again.
    await jump(page, { ...CENTER, zoom: 14 });
    await idle(page);
    const drag = async (dx: number) => {
      const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
      // Inside the canvas from edge to edge: a release outside the window never arrives.
      const y = box.y + box.height * 0.3;
      const [from, to] = dx < 0 ? [0.9, 0.1] : [0.1, 0.9];
      for (let i = 0; i < 2; i++) {
        await page.mouse.move(box.x + box.width * from, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.5, y, { steps: 6 });
        await page.mouse.move(box.x + box.width * to, y, { steps: 6 });
        await page.mouse.up();
        await idle(page);
      }
    };
    await expect(here).toHaveCount(0);
    await drag(-1);
    await expect(here).toBeVisible();
    const before = await zoom();
    await here.click();
    await expect.poll(dots).toBe(0);
    await expect(here).toHaveCount(0);
    expect(await zoom()).toBeCloseTo(before, 3);
    await drag(1);
    await here.click();
    await expect.poll(dots).toBe(3);
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

  test('follows the user while guidance waits for its route, and ends flat', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    const go = (lng: number, lat: number) =>
      context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 5 });
    await go(CENTER.lng + 0.01, CENTER.lat + 0.01);
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const card = page.locator('.card.route');
    await card.locator('.end-btn').first().click();
    await page.getByRole('combobox', { name: 'Search start' }).fill('brandenburg');
    await page.getByRole('option').filter({ hasText: 'Havel' }).click();
    await expect(card.locator('.summary strong')).toHaveText(/min|h/);
    // The route from here (asked at Start) does not come.
    await page.route(/valhalla1\.openstreetmap\.de\/route/, (route) =>
      route.fulfill({ status: 503, body: '' }),
    );
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.locator('.nav-banner')).toContainText('busy');
    const there = { lng: CENTER.lng - 0.01, lat: CENTER.lat - 0.005 };
    await go(there.lng, there.lat);
    await expect
      .poll(() =>
        page.evaluate(
          ([lng, lat]) => {
            const c = window.kosmos!.getCenter();
            return Math.abs(c.lng - lng) < 0.002 && Math.abs(c.lat - lat) < 0.002;
          },
          [there.lng, there.lat],
        ),
      )
      .toBe(true);
    await page.getByRole('button', { name: 'End' }).click();
    await page.getByRole('button', { name: /(Tap|Click) again to end navigation/ }).click();
    await expect(card).toBeVisible();
    await idle(page);
    expect(await page.evaluate(() => window.kosmos!.getPitch())).toBe(0);
  });

  test('asks Nominatim only for a settled query when Photon fails at once', async ({ page }) => {
    test.slow();
    await page.route(/photon\.komoot\.io\/api\//, (route) =>
      route.fulfill({ status: 503, body: '' }),
    );
    const asked = nominatimSearches.length;
    const input = page.getByRole('combobox');
    // Typing with pauses longer than the debounce: Photon fails at once every time.
    for (const q of ['bra', 'brand', 'brandenb', 'brandenburger']) {
      await input.fill(q);
      await page.waitForTimeout(800);
    }
    expect(nominatimSearches.length).toBe(asked);
    // Left alone, the text is a settled query: one search answers it.
    await expect(page.getByRole('option').first()).toContainText(SEARCH_HIT.name, {
      timeout: 10_000,
    });
    expect(nominatimSearches.length).toBe(asked + 1);
    expect(nominatimSearches.at(-1)!.get('q')).toBe('brandenburger');
  });

  test('falls back to Nominatim when Photon does not answer', async ({ page, context }) => {
    test.slow();
    // Photon hangs.
    await context.route(/photon\.komoot\.io\/api\//, () => undefined);
    const asked = nominatimSearches.length;
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    await expect(page.locator('.spinner')).toBeVisible();
    // After Photon's time limit, one Nominatim search for the settled query answers.
    const hit = page.getByRole('option').first();
    await expect(hit).toContainText(SEARCH_HIT.name, { timeout: 10_000 });
    await expect(hit).toContainText('Pariser Platz');
    expect(nominatimSearches.length).toBe(asked + 1);
    expect(nominatimSearches.at(-1)!.get('q')).toBe('brandenburger');
    await hit.click();
    await expect(page.locator('.card').getByRole('heading')).toHaveText(SEARCH_HIT.name);
  });

  test('says so when no search answers, and Enter asks again', async ({ page, context }) => {
    test.slow();
    let answer = false;
    await context.route(/photon\.komoot\.io\/api\//, (route) =>
      answer ? route.fallback() : undefined,
    );
    await context.route(/nominatim\.openstreetmap\.org\/search/, (route) =>
      answer ? route.fallback() : route.abort(),
    );
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    await expect(page.locator('.r-empty')).toHaveText(/Search is not answering/, {
      timeout: 12_000,
    });
    // Said to a screen reader too, not only shown.
    await expect(
      page.getByRole('status').filter({ hasText: 'Search is not answering' }),
    ).toHaveCount(1);
    await expect(page.locator('.spinner')).toHaveCount(0);
    answer = true;
    await input.press('Enter');
    await expect(page.getByRole('option').first()).toContainText(SEARCH_HIT.name);
  });

  test('finds a kind of place while the map keeps moving', async ({ page }) => {
    // Wide enough that the search zooms in, and waits for tiles, while the map keeps turning.
    await jump(page, { ...CENTER, zoom: 13 });
    await idle(page);
    // Like compass mode: the map turns every frame and never rests.
    await page.evaluate(() => {
      const m = window.kosmos!;
      const spin = () => {
        m.setBearing(m.getBearing() + 0.2);
        requestAnimationFrame(spin);
      };
      spin();
    });
    const input = page.getByRole('combobox');
    await input.fill('restaurant');
    await input.press('Enter');
    await expect(page.getByRole('option').filter({ hasText: 'Zur Letzten Instanz' })).toHaveCount(
      1,
      { timeout: 5000 },
    );
  });

  test('Enter jumps to the first result, even before results load', async ({ page }) => {
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    await input.press('Enter');
    await expect(page.locator('.card').getByRole('heading')).toHaveText(SEARCH_HIT.name);
    await idle(page);
    const c = await page.evaluate(() => window.kosmos!.getCenter());
    expect(Math.abs(c.lng - SEARCH_HIT.lng)).toBeLessThan(0.01);
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

  test('guides beside the map with a phone held sideways', async ({ page, context }) => {
    const [width, height] = [915, 412];
    await page.setViewportSize({ width, height });
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
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    // The route card takes the whole height: no room kept for the search bar it replaced.
    await card.locator('.steps summary').click();
    await expect
      .poll(async () => {
        const b = (await card.boundingBox())!;
        return b.y + b.height;
      })
      .toBeGreaterThan(height - 24);
    const column = (await page.locator('.panel').boundingBox())!;
    await card.getByRole('button', { name: 'Start', exact: true }).click();

    // One column before and after Start.
    const banner = page.locator('.nav-banner');
    await expect(banner).toBeVisible();
    const bar = page.locator('.nav-bar');
    // Measured once risen: the animation starts it slightly smaller.
    await bar.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
    expect((await banner.boundingBox())!.width).toBeCloseTo(column.width, 0);
    expect((await bar.boundingBox())!.width).toBeCloseTo(column.width, 0);
    // The credit in the corner, not floating over the road.
    const credit = (await page.locator('.credit').boundingBox())!;
    expect(credit.x + credit.width).toBeGreaterThan(width - 40);
    expect(credit.y + credit.height).toBeGreaterThan(height - 40);
    // The arrow beside the column and low: most of the map is the road ahead.
    const arrow = async () => {
      const b = (await page.locator('.me.nav').boundingBox())!;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    // Polled together: the camera eases there, and halfway it is neither.
    await expect
      .poll(
        async () => {
          const a = await arrow();
          return a.x > column.x + column.width && a.y / height > 0.68;
        },
        { timeout: 8000 },
      )
      .toBe(true);

    // Looking around: Re-centre under the middle of the map, not across the column.
    await page.mouse.move(700, 150);
    await page.mouse.down();
    await page.mouse.move(640, 220, { steps: 6 });
    await page.mouse.up();
    const recenter = (await page.getByRole('button', { name: 'Re-centre' }).boundingBox())!;
    const middle = (column.x + column.width + width) / 2;
    expect(Math.abs(recenter.x + recenter.width / 2 - middle)).toBeLessThan(12);
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

  test('keeps a category search across a route, its dots out of the way meanwhile', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.01, longitude: CENTER.lng + 0.01 });
    await jump(page, { ...CENTER, zoom: 13 });
    await centreBeside(page);
    const input = page.getByRole('combobox');
    await input.fill('Restaurants');
    await input.press('Enter');
    const options = page.getByRole('option');
    await expect(options).toHaveCount(3, { timeout: 10_000 });
    const dots = () =>
      page.evaluate(async () => {
        const src = window.kosmos!.getSource('search') as import('maplibre-gl').GeoJSONSource;
        return ((await src.getData()) as GeoJSON.FeatureCollection).features.length;
      });
    const shown = () =>
      page.evaluate(
        () => window.kosmos!.getLayoutProperty('search-dots', 'visibility') ?? 'visible',
      );
    await options.first().click();
    const card = page.locator('.card');
    await card.getByRole('button', { name: /^Route$/ }).click();
    await expect(page.locator('.card.route')).toBeVisible();
    // The route has the map: the restaurants step aside.
    await expect.poll(shown).toBe('none');
    await page.locator('.card.route').getByRole('button', { name: /close/i }).click();
    // Back from the route, the search is still there to compare the next one.
    await expect.poll(shown).toBe('visible');
    expect(await dots()).toBe(3);
    await expect(input).toHaveValue('Restaurants');
    await card.getByRole('button', { name: /close/i }).click();
    // Escape (Back on Android) ends the search too, before anything else happens.
    await page.locator('canvas.maplibregl-canvas').focus();
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('');
    await expect.poll(dots).toBe(0);
  });

  test('finds nameless places by their kind', async ({ page }) => {
    await jump(page, { ...CENTER, zoom: 15 });
    const input = page.getByRole('combobox');
    await input.fill('WC');
    const options = page.getByRole('option');
    await expect(options.first()).toHaveText(/Toilets/);
    await input.press('Enter');
    await expect(options).toHaveCount(1, { timeout: 10_000 });
    await expect(options.first()).toContainText('Toilet');
    await options.first().click();
    await expect(page.locator('.card').getByRole('heading')).toHaveText('Toilet');
    await expect(page.locator('.card')).toContainText('Unter den Linden 5');
  });

  test('asks the search again for the same words somewhere else', async ({ page }) => {
    const input = page.getByRole('combobox');
    const search = async () => {
      await input.fill('');
      await input.fill('brandenburger');
      await expect(page.getByRole('option').first()).toContainText(SEARCH_HIT.name);
    };
    await jump(page, { ...CENTER, zoom: 12 });
    await search();
    const asked = photonSearches.length;
    await search();
    // The same words over the same area: answered from memory.
    expect(photonSearches.length).toBe(asked);
    await input.blur();
    await jump(page, { lng: 11.58, lat: 48.14, zoom: 12 });
    await search();
    // The last answer shows while the new one comes; the new one is asked for.
    await expect.poll(() => photonSearches.length).toBe(asked + 1);
  });

  test('fits a town after a point was picked', async ({ page }) => {
    // Small enough that a camera padding counted twice leaves no room at all.
    await page.setViewportSize({ width: 390, height: 700 });
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    await page.getByRole('option').first().click();
    await idle(page);
    await input.fill('brandenburg');
    await page.getByRole('option', { name: /Havel/ }).click();
    await expect
      .poll(() => page.evaluate(() => window.kosmos!.getZoom()), { timeout: 8000 })
      .toBeLessThan(12);
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

  test('works from the keyboard: cards take focus, arrows choose, closing returns to search', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.01, longitude: CENTER.lng + 0.01 });
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    await expect(page.getByRole('option').first()).toContainText(SEARCH_HIT.name);
    await input.press('Enter');
    const place = page.locator('.card');
    await expect(place.getByRole('heading')).toBeFocused();

    await place.getByRole('button', { name: /^Route$/ }).press('Enter');
    const card = page.locator('.card.route');
    await expect(card.getByRole('heading', { name: `Route to ${SEARCH_HIT.name}` })).toBeFocused();
    // The travel modes are one Tab stop; arrows move and choose, as with native radios.
    await expect(card.locator('.modes [tabindex="0"]')).toHaveCount(1);
    await card.getByRole('radio', { name: 'Car' }).focus();
    await page.keyboard.press('ArrowRight');
    const bike = card.getByRole('radio', { name: 'Bike' });
    await expect(bike).toBeFocused();
    await expect(bike).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => routeRequests.at(-1)?.costing).toBe('bicycle');
    await expect(card.locator('.modes [tabindex="0"]')).toHaveAttribute('aria-label', 'Bike');

    // Back to the place, whose heading has focus again; closing it carries on in the search.
    await page.keyboard.press('Escape');
    await expect(place.getByRole('heading')).toBeFocused();
    await place.getByRole('button', { name: 'Close' }).press('Enter');
    await expect(place).toHaveCount(0);
    await expect(input).toBeFocused();
  });

  test('remembers the voice for the next drive; on foot and by bike it starts silent', async ({
    page,
    context,
  }) => {
    test.slow(); // Six trips.
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
    const card = page.locator('.card.route');
    const mute = page.getByRole('button', { name: 'Mute voice' });
    /** Guides in `mode`: the voice as it starts, then a tap on it if asked, then End. */
    const trip = async (mode: string, muted: boolean, tap = false) => {
      await card.getByRole('radio', { name: mode }).click();
      await expect(card.locator('.summary strong')).toHaveText(/min/);
      await card.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(mute).toHaveAttribute('aria-pressed', String(muted));
      if (tap) {
        await mute.click();
        await expect(mute).toHaveAttribute('aria-pressed', String(!muted));
      }
      await page.getByRole('button', { name: 'End' }).click();
      await page.getByRole('button', { name: /(Tap|Click) again to end navigation/ }).click();
      await expect(card).toBeVisible();
    };
    await openRoute();
    await trip('Car', false, true);
    await trip('Car', true);
    // A walk starts silent and its tap is for that walk only.
    await trip('Walk', true, true);
    await trip('Car', true, true);
    await trip('Bike', true);
    await page.reload();
    await openRoute();
    await trip('Car', false);
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
