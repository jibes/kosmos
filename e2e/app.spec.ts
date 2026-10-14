import { writeFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { isNight } from '../src/core/daylight';
import { CENTER } from './fixtures/scene';
import {
  SEARCH_HIT,
  lookupRequests,
  offlineWorld,
  routeRequests,
  stopTimesRequests,
  transitRequests,
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
    await expect(legs.locator('.ride time').first()).toHaveAttribute('data-late');
    await expect(legs.locator('.walk')).toHaveCount(2);
    await expect(card.locator('.summary')).toContainText('No change');
    // Two connections and walking the whole way; each tile names its lines with their vehicle.
    const tiles = card.locator('.alts [role=radio]');
    await expect(tiles).toHaveCount(3);
    await expect(tiles.first().locator('.line')).toHaveText('U6');
    await expect(tiles.first().locator('.line svg')).toHaveCount(1);
    await expect(tiles.nth(2).locator('.line')).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Start' })).toBeEnabled();
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
    await card.getByRole('button', { name: 'Start' }).click();

    // The first connection: walk minutes 3–8, U6 8–20 with stops at 12 and 16, walk 20–25.
    // A departure check finds it three minutes late: 11–23, stops at 15 and 19.
    const banner = page.locator('.nav-banner');
    const checks = stopTimesRequests.length;
    await expect(banner).toContainText('Walk to Stadtmitte');
    await expect(banner).toContainText('U6 leaves');
    // The walk's next turn leads, with the metres to it.
    await expect(banner.locator('p')).toHaveText('Dorotheenstraße');
    await expect.poll(spoken).toContain('Walk to Stadtmitte.');
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
    expect(stopTimesRequests.length).toBe(checks + 1);
    expect(stopTimesRequests.at(-1)!.get('stopId')).toBe('de:stadtmitte');
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
    await shot(page, info, 'riding');
    await minutes(20);
    await expect(banner).toContainText('Next stop', { timeout: 10_000 });
    await expect.poll(spoken).toContain('Get off at the next stop, Unter den Linden.');
    expect(stopTimesRequests.length).toBe(checks + 1);

    await minutes(24);
    await go(to.lng, stopLat);
    await expect(banner).toContainText('Walk to Brandenburger Tor');
    await go(to.lng, to.lat);
    await expect(banner).toContainText('You have arrived');
    await page.getByRole('button', { name: 'End' }).click();
    await expect(banner).toHaveCount(0);
  });

  test('navigates turn by turn with spoken prompts', async ({ page, context }, info) => {
    await page.evaluate(() => {
      const spoken: string[] = [];
      (window as unknown as { spoken: string[] }).spoken = spoken;
      Object.defineProperty(window, 'speechSynthesis', {
        value: { speak: (u: SpeechSynthesisUtterance) => spoken.push(u.text), cancel: () => {} },
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
    await page.getByRole('button', { name: 'Start' }).click();

    const banner = page.locator('.nav-banner');
    await expect(banner).toContainText('Head south on Friedrichstraße.');
    await expect(page.locator('.panel')).toBeHidden();
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
    await expect(page.locator('.speed strong')).toHaveText(/^\d+$/);
    await expect(banner.locator('strong')).toHaveText(/m$/);
    await expect.poll(spoken).toContain('Turn right onto Unter den Linden.');
    await expect(page.locator('.me.nav')).toHaveCount(1);
    await idle(page);
    await shot(page, info, 'navigating');

    for (const f of [0.3, 0.7, 1]) {
      await go({ lng: corner.lng + (to.lng - corner.lng) * f, lat: to.lat });
      await page.waitForTimeout(250);
    }
    await expect(banner).toContainText('You have arrived');

    await page.getByRole('button', { name: 'End' }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.locator('.card.route')).toBeVisible();
  });

  test('goes dark in a tunnel while navigating', async ({ page, context }) => {
    const from = { lng: CENTER.lng + 0.01, lat: CENTER.lat + 0.01 };
    const to = SEARCH_HIT;
    const go = (p: { lng: number; lat: number }) =>
      context.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy: 5 });
    const west = (x: number) => go({ lng: CENTER.lng + x / 67800, lat: to.lat });
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
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
    await page.getByRole('button', { name: 'Start' }).click();
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
    await west(-450);
    await expect.poll(theme, { timeout: 8000 }).toBe('light');
    await page.getByRole('button', { name: 'End' }).click();
    await expect.poll(theme).toBe('light');
  });

  test('finds places by category from the map, nearest first', async ({ page }, info) => {
    await jump(page, { ...CENTER, zoom: 13 });
    await idle(page);
    const input = page.getByRole('combobox');
    // The word offers the kind of place as the top row; Enter takes it.
    await input.fill('restaurant');
    const options = page.getByRole('option');
    await expect(options.first()).toHaveText(/Restaurants/);
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(input).toHaveValue('Restaurants');

    await expect(options).toHaveCount(3);
    await expect(options.first()).toContainText('Zur Letzten Instanz');
    await expect(options.first()).toContainText(/\d+ m/);
    await expect(options.nth(2)).toContainText('Borchardt');
    // Too wide a view holds few places; the first search looked closer, once.
    const zoom = () => page.evaluate(() => window.kosmos!.getZoom());
    expect(await zoom()).toBeCloseTo(14, 1);
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
    await page.mouse.click(borchardt.x, borchardt.y);
    await expect(page.locator('.card').getByRole('heading')).toHaveText('Borchardt');
    await page.locator('.card').getByRole('button', { name: /close/i }).click();

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
    await expect(card.locator('.hours li')).toHaveText([
      'Mo-Fr 09:00-18:00',
      'Sa 10:00-14:00',
      'Su off',
    ]);
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

  test('keeps the location button above the compass', async ({ page }) => {
    const order = await page
      .locator('.controls > button')
      .evaluateAll((els) => els.map((e) => e.classList.contains('compass')));
    expect(order).toEqual([false, true]);
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
