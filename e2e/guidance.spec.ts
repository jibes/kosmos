import { expect, test } from '@playwright/test';
import { TUNNEL_HOLD_MS } from '../src/core/daylight';
import { CENTER } from './fixtures/scene';
import { SEARCH_HIT, limitRequests, routeRequests } from './fixtures/offline-world';
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
    await expect(banner.locator('p[aria-live] > [aria-hidden]')).toHaveText('Unter den Linden');
    await expect(banner.locator('p[aria-live] > .sr-only')).toHaveText(
      'Turn right onto Unter den Linden.',
    );
    await expect(banner.locator('strong')).toHaveText(/km$/);
    await expect(page.locator('.me.nav')).toHaveCount(1);
    await expect(page.locator('.panel')).toBeHidden();
    // Time left leads the bar; the clock time says it is the arrival.
    await expect(page.locator('.nav-eta strong')).toHaveText(/min$/);
    await expect(page.locator('.nav-eta span')).toContainText('arrival');
    // "Keep the app open" leaves the map's buttons free to tap.
    const note = await page.locator('.toast').filter({ hasText: 'open' }).boundingBox();
    expect(note).not.toBeNull();
    for (const b of await page.locator('.controls button:visible').all()) {
      const c = (await b.boundingBox())!;
      const apart =
        c.x >= note!.x + note!.width ||
        c.x + c.width <= note!.x ||
        c.y >= note!.y + note!.height ||
        c.y + c.height <= note!.y;
      expect(apart).toBe(true);
    }
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
    const asked = routeRequests.length;
    await expect
      .poll(
        async () => {
          await go({ lng: to.lng, lat: to.lat + 1e-7 * Math.random() });
          return banner.count();
        },
        { intervals: [500], timeout: 8000 },
      )
      .toBe(0);
    // Arrived, guidance ends by itself: it says so, and the destination's card is back.
    await expect(page.locator('.toast')).toContainText('You have arrived');
    await expect(page.locator('.card.route')).toHaveCount(0);
    await expect(page.locator('.card').getByRole('heading')).toHaveText(SEARCH_HIT.name);
    expect(await spoken()).toContain('You have arrived at your destination.');
    // Every prompt was queued, the last one too: none cut another off.
    expect(await page.evaluate(() => (window as unknown as { cancels: number }).cancels)).toBe(0);
    // No route is asked for from the destination to itself.
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

    // Looking around: the map's own location button brings it back, at the map's edge.
    await page.mouse.move(700, 150);
    await page.mouse.down();
    await page.mouse.move(640, 220, { steps: 6 });
    await page.mouse.up();
    const locate = (await page.getByRole('button', { name: 'Show my location' }).boundingBox())!;
    expect(locate.x).toBeGreaterThan(width - 80);
  });

  test('drives seen from behind; the overview shows the rest of the way', async ({
    page,
    context,
  }) => {
    const from = { lng: CENTER.lng + 0.01, lat: CENTER.lat + 0.01 };
    const to = SEARCH_HIT;
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: from.lat, longitude: from.lng, accuracy: 5 });
    await page.getByRole('combobox').fill('brandenburger');
    await page.getByRole('option').first().click();
    await page
      .locator('.card')
      .getByRole('button', { name: /^Route$/ })
      .click();
    const card = page.locator('.card.route');
    await card.getByRole('radio', { name: 'Car' }).click();
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    const pitch = () => page.evaluate(() => Math.round(window.kosmos!.getPitch()));
    await expect.poll(pitch).toBe(55);
    // The arrow faces the screen: the tilt does not squash it to a wedge.
    const arrow = (await page.locator('.me.nav .me-arrow').boundingBox())!;
    expect(arrow.height).toBeGreaterThan(44);
    const inView = (p: { lng: number; lat: number }) =>
      page.evaluate(
        ([lng, lat]) => {
          const q = window.kosmos!.project([lng, lat]);
          return q.x > 0 && q.y > 0 && q.x < innerWidth && q.y < innerHeight;
        },
        [p.lng, p.lat],
      );
    expect(await inView(to)).toBe(false);

    // One button: the rest of the way, north up from above, the destination in it.
    await page.evaluate(() => {
      const m = window.kosmos!;
      const w = window as unknown as { frames: number[][] };
      w.frames = [];
      m.on('move', () => w.frames.push([m.getZoom(), m.getPitch()]));
    });
    const before = await page.evaluate(() => window.kosmos!.getZoom());
    // Following, the location button's next step is the rest of the way.
    await page.getByRole('button', { name: 'Show the whole route' }).click();
    await idle(page);
    // Flat before zooming out: tilted, it would show far past the route and seem to zoom back in.
    const frames = await page.evaluate(() => (window as unknown as { frames: number[][] }).frames);
    // It moved (a busy machine may draw only a couple of frames of it).
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.filter(([z, p]) => z < before - 0.5 && p > 1)).toEqual([]);
    expect(await pitch()).toBe(0);
    expect(await page.evaluate(() => Math.round(window.kosmos!.getBearing()))).toBe(0);
    expect(await inView(to)).toBe(true);
    expect(await inView(from)).toBe(true);
    // Both ends clear of the banner and the bar, with room for their markers: not at the edge.
    const clear = (p: { lng: number; lat: number }) =>
      page.evaluate(
        ([lng, lat]) => {
          const q = window.kosmos!.project([lng, lat]);
          const top = document.querySelector('.nav-banner')!.getBoundingClientRect().bottom;
          const bar = document.querySelector('.nav-bar')!.getBoundingClientRect();
          const wideLayout = bar.right < innerWidth / 2 + 1 || bar.width < innerWidth / 2;
          return (
            q.x > Math.min(70, innerWidth * 0.15) &&
            q.x < innerWidth - Math.min(70, innerWidth * 0.15) &&
            (wideLayout || (q.y > top + 40 && q.y < bar.top - 40))
          );
        },
        [p.lng, p.lat],
      );
    expect(await clear(to)).toBe(true);
    expect(await clear(from)).toBe(true);
    // A new fix keeps the overview.
    await context.setGeolocation({ latitude: from.lat - 0.001, longitude: from.lng, accuracy: 5 });
    await page.waitForTimeout(1500);
    expect(await inView(to)).toBe(true);
    // And back to following close behind, by the location button as on the map.
    await page.getByRole('button', { name: 'Show my location' }).click();
    await expect.poll(pitch).toBe(55);
    await expect(page.getByRole('button', { name: 'Show the whole route' })).toBeVisible();
  });

  test('runs the arrow on between uneven fixes, the camera with it', async ({ page, context }) => {
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
    await expect(page.locator('.me.nav')).toHaveCount(1);
    await page.waitForTimeout(1500);
    // Every frame while fixes come: where the arrow is on the map and on the screen.
    await page.evaluate(() => {
      const w = window as unknown as { frames: number[][]; watching: boolean };
      w.frames = [];
      w.watching = true;
      const tick = () => {
        const el = document.querySelector('.me.nav')!.getBoundingClientRect();
        const c = window.kosmos!.getCenter();
        w.frames.push([performance.now(), c.lat, el.x + el.width / 2, el.y + el.height / 2]);
        if (w.watching) requestAnimationFrame(tick);
      };
      tick();
    });
    // 10 m/s down the first street, the fixes uneven as a phone's: one each second, but every
    // other one hard on the heels of the one before.
    const t0 = Date.now();
    for (const at of [0, 1000, 1100, 2100, 2200, 3200, 3300]) {
      await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
      const s = (Date.now() - t0) / 1000;
      await go(from.lng, from.lat - 0.00009 * (s + 1));
    }
    await page.waitForTimeout(300);
    const frames = await page.evaluate(() => {
      const w = window as unknown as { frames: number[][]; watching: boolean };
      w.watching = false;
      return w.frames;
    });
    // Under way, the map moves on every stretch of the drive, never stands and then jumps.
    const start = frames[0][0];
    const moving = frames.filter(([t]) => t > start + 1500 && t < start + 3500);
    let still = 0;
    let worst = 0;
    for (let i = 1; i < moving.length; i++) {
      still = moving[i][1] === moving[i - 1][1] ? still + moving[i][0] - moving[i - 1][0] : 0;
      worst = Math.max(worst, still);
    }
    expect(moving.length).toBeGreaterThan(2);
    expect(Math.abs(moving.at(-1)![1] - moving[0][1])).toBeGreaterThan(0.0001);
    expect(worst).toBeLessThan(250);
    // On screen the arrow stays where it is: the map moves under it.
    const xs = frames.map(([, , x]) => x);
    const ys = frames.map(([, , , y]) => y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(3);
  });

  test('moves the dot on a coarse fix, where guidance waits for a better one', async ({
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
    const card = page.locator('.card.route');
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.locator('.me.nav')).toHaveCount(1);
    await idle(page);
    // A network fix 70 m east, 120 m accurate.
    const coarse = { lng: from.lng + 0.001, lat: from.lat };
    await context.setGeolocation({ latitude: coarse.lat, longitude: coarse.lng, accuracy: 120 });
    await expect
      .poll(async () => {
        const b = (await page.locator('.me').boundingBox())!;
        const p = await page.evaluate(
          ([lng, lat]) => window.kosmos!.project([lng, lat]),
          [coarse.lng, coarse.lat],
        );
        return Math.hypot(b.x + b.width / 2 - p.x, b.y + b.height / 2 - p.y);
      })
      .toBeLessThan(6);
  });

  test('a touch never released does not hold the camera for good', async ({ page, context }) => {
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
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Math.round(window.kosmos!.getPitch()))).toBe(55);
    // A finger down when the app was put away: its "up" never came.
    await page.locator('.maplibregl-canvas-container').dispatchEvent('pointerdown', {
      pointerId: 77,
      isPrimary: true,
      bubbles: true,
    });
    // A later tap on the map, and the camera follows the next fix again.
    const box = (await page.locator('.map').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
    await idle(page);
    const before = await page.evaluate(() => window.kosmos!.getCenter().lat);
    // On along the route at a believable pace.
    for (let i = 1; i <= 6; i++) {
      await go(from.lng, from.lat - 0.0003 * i);
      await page.waitForTimeout(600);
    }
    await expect
      .poll(() => page.evaluate(() => window.kosmos!.getCenter().lat), { timeout: 8000 })
      .toBeLessThan(before - 0.001);
  });

  test('lets the screen sleep again when guidance ends before the lock came', async ({
    page,
    context,
  }) => {
    // A slow wake lock: it arrives after guidance has ended.
    await page.evaluate(() => {
      const w = window as unknown as { held: number };
      w.held = 0;
      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: () =>
            new Promise((done) =>
              setTimeout(() => {
                w.held++;
                done({ release: async () => void w.held-- });
              }, 4000),
            ),
        },
      });
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
    await expect(page.locator('.card.route .summary strong')).toHaveText(/min/);
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByRole('button', { name: 'End' }).click();
    await page.getByRole('button', { name: /(Tap|Click) again to end navigation/ }).click();
    await page.waitForTimeout(4500);
    expect(await page.evaluate(() => (window as unknown as { held: number }).held)).toBe(0);
  });

  test('shows the speed limit, the speed red when well over it', async ({
    page,
    context,
  }, info) => {
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
    await card.getByRole('radio', { name: 'Car' }).click();
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    // Not asked for the route card's ways: only for the one driven.
    const asked = limitRequests.length;
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    // South along the route, about 22 m a second: some 80 km/h where 30 is the limit.
    const speed = page.locator('.speed');
    for (let i = 1; i <= 15; i++) {
      await go(from.lng, from.lat - 0.0002 * i);
      await page.waitForTimeout(1000);
      if ((await speed.count()) && (await speed.getAttribute('data-over')) === 'true') break;
    }
    await expect(speed.locator('.limit')).toHaveText('30');
    await expect(speed).toHaveAttribute('data-over', 'true');
    await expect(speed).toHaveAttribute('aria-label', /km\/h, limit 30$/);
    // Once for the route, not for every fix.
    expect(limitRequests.length - asked).toBe(1);
    await shot(page, info, 'speed-limit');
  });

  test('follows in any zoom, tilt and rotation; the location button turns it', async ({
    page,
    context,
  }) => {
    // A long drive through every control: more time than most on a busy machine.
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
    await card.getByRole('radio', { name: 'Car' }).click();
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    const cam = () =>
      page.evaluate(() => {
        const m = window.kosmos!;
        return { zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
      });
    await expect.poll(async () => Math.round((await cam()).pitch)).toBe(55);
    // Heading-up from the start, following (the location button's next step the whole route),
    // the needle's next step north up.
    const locate = page.locator('.controls .ctl[data-follow]');
    const needle = page.locator('.controls .compass');
    await expect(locate).toHaveAttribute('data-following', 'true');
    await expect(needle).toHaveAttribute('aria-label', 'North up');
    // Zooming out by hand does not stop following: the next fix keeps the zoom and moves on.
    const before = (await cam()).zoom;
    const box = (await page.locator('.map').boundingBox())!;
    // As a pinch reports itself: the zoom carries the user's own event.
    await page.evaluate(() =>
      window.kosmos!.zoomTo(
        window.kosmos!.getZoom() - 1.5,
        { duration: 300 },
        {
          originalEvent: new Event('wheel'),
        },
      ),
    );
    await idle(page);
    const zoomed = (await cam()).zoom;
    expect(zoomed).toBeLessThan(before - 0.5);
    // A few metres on, slowly: the speed's own zoom stays as it was.
    await go(from.lng, from.lat - 0.00004);
    await page.waitForTimeout(1600);
    await expect(locate).toHaveAttribute('data-following', 'true');
    expect(Math.abs((await cam()).zoom - zoomed)).toBeLessThan(0.3);
    // The needle: north up and flat, still following.
    await needle.click();
    await expect.poll(async () => Math.round((await cam()).bearing)).toBe(0);
    await expect.poll(async () => Math.round((await cam()).pitch)).toBe(0);
    await expect(needle).toHaveAttribute('aria-label', 'Turn map with your way');
    await go(from.lng, from.lat - 0.003);
    await page.waitForTimeout(1600);
    expect(Math.round((await cam()).pitch)).toBe(0);
    await expect(locate).toHaveAttribute('data-following', 'true');
    // And heading-up again, at the drive's own tilt.
    await needle.click();
    await expect.poll(async () => Math.round((await cam()).pitch)).toBe(55);
    await expect(needle).toHaveAttribute('aria-label', 'North up');
    // A drag lets go; the location button follows again, heading-up as before.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
    await expect(locate).not.toHaveAttribute('data-following');
    await locate.click();
    await expect(locate).toHaveAttribute('data-following', 'true');
    await expect(locate).toHaveAttribute('data-follow', 'compass');
  });

  test('shows a signed turn by where it leads, the road below', async ({ page, context }, info) => {
    const from = { lng: CENTER.lng + 0.01, lat: CENTER.lat + 0.01 };
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
    await card.getByRole('radio', { name: 'Bike' }).click();
    await expect(card.locator('.summary strong')).toHaveText(/min/);
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    const banner = page.locator('.nav-banner');
    // The street runs both ways; the sign says which: big, the road under it.
    await expect(banner.locator('p[aria-live] > [aria-hidden]')).toHaveText(
      'Towards Pariser Platz',
    );
    // The road as signed: its name, and the number on the sign.
    await expect(banner.locator('div > small')).toHaveText('Unter den Linden · B2');
    // Said in full, with the sign's destination.
    await expect(banner.locator('p[aria-live] > .sr-only')).toHaveText(
      'Turn right onto Unter den Linden, towards Pariser Platz.',
    );
    // The step after always shows under the next one, here its arrival.
    await expect(banner.locator('.nav-then')).toContainText('Then');
    await expect(banner.locator('.nav-then')).toContainText('Brandenburger Tor');
    // A tap opens the points ahead: the user now, then the destination (the only one left, so
    // it does not come off); Back closes them, guidance goes on.
    const points = page.locator('.ride-details .point-list li');
    await expect(points).toHaveCount(0);
    await page.getByRole('button', { name: 'Show the route' }).click();
    await expect(points).toHaveText(['My location', 'Brandenburger Tor']);
    await expect(
      page.locator('.ride-details').getByRole('button', { name: /^Remove/ }),
    ).toHaveCount(0);
    await shot(page, info, 'points');
    await page.keyboard.press('Escape');
    await expect(points).toHaveCount(0);
    await expect(banner).toBeVisible();
    await expect(page.getByRole('button', { name: /^End$/ })).toBeVisible();
  });

  test('keeps "then" whole beside a long next instruction', async ({ page }) => {
    // The banner breaks long street names anywhere; the word before the arrow must not.
    const lines = await page.evaluate(() => {
      const banner = document.createElement('section');
      banner.className = 'nav-banner';
      banner.style.width = '320px';
      banner.innerHTML =
        '<div><p class="nav-then"><span class="nav-then-word">Dann</span>' +
        '<svg width="18" height="18"></svg>' +
        '<span class="nav-then-text">Aus dem Kreisverkehr auf N52 abfahren und weiter</span></p></div>';
      document.querySelector('.ui')!.append(banner);
      const word = banner.querySelector('.nav-then-word')!.getBoundingClientRect();
      const text = banner.querySelector('.nav-then-text')!.getBoundingClientRect();
      const line = parseFloat(getComputedStyle(banner.querySelector('.nav-then')!).lineHeight);
      banner.remove();
      return { word: word.height, text: text.height, line: line || 20 };
    });
    expect(lines.word).toBeLessThan(lines.line * 1.5);
    expect(lines.text).toBeLessThan(lines.line * 1.5);
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
    // On foot the map is seen from straight above, closest in.
    await expect.poll(() => page.evaluate(() => window.kosmos!.getPitch())).toBe(0);
    // Muted on foot, the turns are felt instead.
    const mute = page.getByRole('button', { name: 'Mute voice' });
    await mute.click();
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
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

  for (const [label, costing, east] of [
    ['Walk', 'pedestrian', 25],
    ['Bike', 'bicycle', 60],
  ] as const) {
    test(`reroutes ${costing === 'pedestrian' ? 'on foot' : 'by bike'} the same way`, async ({
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
      const card = page.locator('.card.route');
      await card.getByRole('radio', { name: label }).click();
      await expect(card.locator('.summary strong')).toHaveText(/min/);
      await card.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(page.locator('.nav-banner')).toBeVisible();
      const asked = routeRequests.length;

      // A parallel way beside the first leg, followed for longer than a GPS wobble.
      const dLng = east / (111_195 * Math.cos((from.lat * Math.PI) / 180));
      for (let i = 1; i <= 6; i++) {
        await seconds(3);
        await go(from.lng + dLng, from.lat - i * 0.00004);
        await page.waitForTimeout(200);
      }
      await expect.poll(() => routeRequests.length).toBeGreaterThan(asked);
      const again = routeRequests.at(-1)!;
      expect(again.costing).toBe(costing);
      expect(again.from[0]).toBeCloseTo(from.lng + dLng, 4);
    });
  }

  test('remembers the voice for the next trip, however it goes', async ({ page, context }) => {
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
    // On at first; muted for one trip, muted for the next, whatever the way of travel.
    await trip('Car', false, true);
    await trip('Walk', true);
    await trip('Bike', true, true);
    await trip('Car', false);
    await page.reload();
    await openRoute();
    await trip('Walk', false);
  });
});
