import { expect, test } from '@playwright/test';
import { TUNNEL_HOLD_MS } from '../src/core/daylight';
import { CENTER } from './fixtures/scene';
import { SEARCH_HIT, routeRequests } from './fixtures/offline-world';
import { shot, idle, inWorld, watchPages } from './helpers';

watchPages();

test.describe('guidance', () => {
  inWorld();

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
    // A phone goes on sending fixes at the destination; on a busy machine the jumps above may
    // come too close together to be believed at once (plausible travel since the last fix).
    await expect
      .poll(
        async () => {
          await go({ lng: to.lng, lat: to.lat + 1e-7 * Math.random() });
          return banner.textContent();
        },
        { intervals: [500], timeout: 8000 },
      )
      .toContain('You have arrived');
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

  test('buzzes the turns on a silent walk', async ({ page, context }) => {
    // A phone's vibrator, as the browser offers it.
    await page.evaluate(() => {
      const w = window as unknown as { buzzes: number[][] };
      w.buzzes = [];
      Object.defineProperty(navigator, 'vibrate', {
        value: (p: number[]) => w.buzzes.push([...p]) > 0,
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
    const card = page.locator('.card.route');
    await card.getByRole('radio', { name: 'Walk' }).click();
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    // On foot the voice starts silent: the turns are felt instead.
    await expect(page.getByRole('button', { name: 'Mute voice' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const buzzes = () => page.evaluate(() => (window as unknown as { buzzes: number[][] }).buzzes);
    for (const f of [0.2, 0.5, 0.8, 0.97, 0.995]) {
      await go({ lng: from.lng, lat: from.lat + (corner.lat - from.lat) * f });
      await page.waitForTimeout(250);
    }
    await expect.poll(buzzes).toContainEqual([60, 90, 60]);
    for (const f of [0.3, 0.7, 1]) {
      await go({ lng: corner.lng + (to.lng - corner.lng) * f, lat: to.lat });
      await page.waitForTimeout(250);
    }
    await expect
      .poll(
        async () => {
          await go({ lng: to.lng, lat: to.lat + 1e-7 * Math.random() });
          return buzzes();
        },
        { intervals: [500], timeout: 8000 },
      )
      .toContainEqual([250]);
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
});
