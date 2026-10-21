import { expect, test } from '@playwright/test';
import { CENTER } from './fixtures/scene';
import {
  SEARCH_HIT,
  nominatimSearches,
  photonSearches,
  routeRequests,
} from './fixtures/offline-world';
import { shot, idle, jump, centreBeside, inWorld, resultRows, swipe, watchPages } from './helpers';

watchPages();

test.describe('search', () => {
  inWorld();

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
    // The pin's tip on the place itself, not floating above it.
    await page
      .locator('.pin-dot')
      .evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
    const tip = await page.evaluate(
      ([lng, lat]) => {
        const p = window.kosmos!.project([lng, lat]);
        const dot = document.querySelector('.pin-dot')!.getBoundingClientRect();
        return { dx: dot.left + dot.width / 2 - p.x, dy: dot.bottom - p.y };
      },
      [SEARCH_HIT.lng, SEARCH_HIT.lat],
    );
    expect(Math.abs(tip.dx)).toBeLessThan(2);
    expect(Math.abs(tip.dy)).toBeLessThan(5);
    await shot(page, info, 'selected');
    // The text stays in the field behind the card; the map moved far away asks nothing anew.
    const asked = photonSearches.length;
    await jump(page, { lng: CENTER.lng + 2, lat: CENTER.lat + 1, zoom: 9 });
    await page.waitForTimeout(800);
    expect(photonSearches.length).toBe(asked);
    await card.getByRole('button', { name: /close|schließen/i }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.pin')).toHaveCount(0);
  });

  test('a pull down puts the list away, text kept; the field brings it back', async ({
    page,
  }, info) => {
    test.skip(!info.project.use.hasTouch, 'touch only');
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    const list = page.locator('.results');
    const row = page.getByRole('option').first();
    await expect(row).toContainText(SEARCH_HIT.name);
    await list.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
    const box = (await row.boundingBox())!;
    const at = { x: box.x + 40, y: box.y + box.height / 2 };
    // A small pull springs back.
    await swipe(page, at, { x: at.x, y: at.y + 30 });
    await expect(list).toBeVisible();
    await expect(input).toBeFocused();
    // A real one puts it away with the keyboard, and keeps what was typed.
    await swipe(page, at, { x: at.x, y: at.y + 160 });
    await expect(list).toHaveCount(0);
    await expect(input).not.toBeFocused();
    await expect(input).toHaveValue('brandenburger');
    await expect(page.locator('.card')).toHaveCount(0);
    // Back into the field: the same names again.
    await input.click();
    await expect(page.getByRole('option').first()).toContainText(SEARCH_HIT.name);
  });

  test('finds airports by the word, and more names than fit, scrolling', async ({ page }) => {
    const input = page.getByRole('combobox');
    await input.fill('Flughafen');
    const option = page.getByRole('option').filter({ hasText: 'Flughafen Zürich' });
    await expect(option).toBeVisible();
    await expect(option.locator('svg[data-kind="plane"]')).toBeVisible();
    await expect(page.getByRole('option').filter({ hasText: 'Flughafenstraße' })).toHaveCount(0);

    await input.fill('Platz');
    const rows = page.getByRole('option').filter({ hasText: /^Platz \d+/ });
    await expect(rows).toHaveCount(12);
    const list = page.locator('.results');
    expect(await list.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await rows.last().scrollIntoViewIfNeeded();
    await expect(rows.last()).toBeInViewport();
  });

  test('takes Enter typed before the names in view are read', async ({ page }) => {
    await jump(page, { ...CENTER, zoom: 14 });
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    await expect(page.getByRole('option').first()).toContainText(SEARCH_HIT.name);
    // Again: Photon's answer is known, the names in view are read anew; Enter at once, in the
    // same moment, as a fast typist's does.
    await input.fill('');
    await input.evaluate((el: HTMLInputElement) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(el, 'brandenburger');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await expect(input).not.toBeFocused();
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
    const rows = await resultRows(page);
    await expect(rows.filter({ hasText: 'Zur Letzten Instanz' })).toHaveCount(1);
    await input.fill('brandenburger');
    await page.waitForTimeout(300);
    await expect(page.getByRole('option').filter({ hasText: 'Zur Letzten Instanz' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('option').first()).toContainText(SEARCH_HIT.name);
  });

  test('finds places by category from the map, nearest first', async ({ page }, info) => {
    // Zooms, reads tiles, fits, searches twice: long on a busy machine.
    test.slow();
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
    // The list makes way for the map; the places are a sheet over it, nearest first.
    await expect(options).toHaveCount(0);
    const sheet = page.locator('.results-sheet');
    await expect(sheet).toContainText(/Restaurants\s*3 · nearest \d+ m/, { timeout: 10_000 });
    const rows = await resultRows(page);

    // A zoom-in, then up to 48 tiles read: slow machines need longer than the default.
    await expect(rows).toHaveCount(3, { timeout: 10_000 });
    await expect(rows.first()).toContainText('Zur Letzten Instanz');
    await expect(rows.first()).toContainText(/\d+ m/);
    await expect(rows.nth(2)).toContainText('Borchardt');
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
    await shot(page, info, 'category');
    // Back in the field, the list has them; a category preselects nothing: Enter means "show
    // me all of them".
    // (The mouse off the list first: it rests where a row opens, and hover chooses a row.)
    await page.mouse.move(1, 1);
    await input.focus();
    await expect(options).toHaveCount(3);
    await expect(page.locator('[role=option][aria-selected=true]')).toHaveCount(0);
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
    // The card stands in for the sheet, which comes back as it was when the card closes.
    await expect(sheet).toBeHidden();
    await page.locator('.card').getByRole('button', { name: /close/i }).click();
    await expect(sheet).toBeVisible();

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
    const groceries = await resultRows(page);
    await expect(groceries).toHaveCount(2);
    await expect(groceries.first()).toContainText('Kiezmarkt');
    await groceries.first().click();
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
    await expect(await resultRows(page)).toHaveText([/Pergamonmuseum/]);
    // Editing the text searches by name again.
    await input.fill('Muse');
    await expect(suggestion).toBeVisible();
  });

  test('with none in view, shows the nearest around it', async ({ page }) => {
    // The kindergarten lies 700 m south of the middle, off screen this close in.
    await jump(page, { ...CENTER, zoom: 17 });
    const input = page.getByRole('combobox');
    await input.fill('Kita');
    const options = page.getByRole('option');
    await options.filter({ hasText: 'Nurseries and kindergartens' }).click();
    await expect(await resultRows(page)).toHaveText([/Kita Sonnenschein.*\d+ m/]);
    await expect(page.locator('.results-sheet')).toContainText(
      'None in view. The nearest around it:',
    );
    // The map stays where it is until asked: Enter in the field shows them.
    expect(await page.evaluate(() => window.kosmos!.getZoom())).toBeCloseTo(17, 1);
    await page.mouse.move(1, 1);
    await input.focus();
    await input.press('Enter');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const m = window.kosmos!;
          return m.getBounds().contains([13.405 + 200 / 67800, 52.52 - 700 / 111200]);
        }),
      )
      .toBe(true);
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
    await expect(await resultRows(page)).toHaveCount(3);
    const zoom = () => page.evaluate(() => window.kosmos!.getZoom());
    const dots = () =>
      page.evaluate(async () => {
        const src = window.kosmos!.getSource('search') as import('maplibre-gl').GeoJSONSource;
        const data = (await src.getData()) as GeoJSON.FeatureCollection;
        return data.features.length;
      });
    await expect.poll(dots).toBe(3);
    await input.blur();

    // The location button takes the map where the user is: the results are elsewhere now, so
    // it offers to search there, as the user's own pan would; searching there clears it.
    const here = page.getByRole('button', { name: 'Search this area' });
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.03, longitude: CENTER.lng });
    await page.locator('.controls > button').first().click();
    await idle(page);
    await expect(here).toBeVisible();
    await here.click();
    await expect(here).toHaveCount(0);
    // Following the position moves the camera too, but asks nothing.
    await context.setGeolocation({ latitude: CENTER.lat + 0.0302, longitude: CENTER.lng });
    await page.waitForTimeout(1500);
    await expect(here).toHaveCount(0);

    // Dragging the map away offers to search the new area, without changing the zoom; there
    // is nothing in view (perhaps the nearest around it: how far a drag flings the map varies),
    // and back home all are in view again.
    await jump(page, { ...CENTER, zoom: 14 });
    await idle(page);
    const drag = async (dx: number) => {
      const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
      // On the map itself, beside the column in the side layout (its results sheet is open
      // there), and inside the canvas: a release outside the window never arrives.
      const panel = (await page.locator('.panel').boundingBox())!;
      const left = panel.y < box.height / 2 && panel.x < box.width / 2 ? panel.x + panel.width : 0;
      const x = (share: number) => left + (box.width - left) * share;
      const y = box.y + box.height * 0.3;
      const [from, to] = dx < 0 ? [0.95, 0.05] : [0.05, 0.95];
      for (let i = 0; i < 2; i++) {
        await page.mouse.move(x(from), y);
        await page.mouse.down();
        await page.mouse.move(x(0.5), y, { steps: 6 });
        await page.mouse.move(x(to), y, { steps: 6 });
        await page.mouse.up();
        await idle(page);
      }
    };
    await expect(here).toHaveCount(0);
    await drag(-1);
    await expect(here).toBeVisible();
    const before = await zoom();
    await here.click();
    await expect(here).toHaveCount(0);
    await input.focus();
    await expect(page.locator('.results')).toContainText('None in view.');
    await input.blur();
    expect(await zoom()).toBeCloseTo(before, 3);
    await drag(1);
    await here.click();
    await expect.poll(dots).toBe(3);
  });

  test('locating the user while the map still glides offers to search there', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.03, longitude: CENTER.lng });
    await jump(page, { ...CENTER, zoom: 14 });
    const input = page.getByRole('combobox');
    await input.fill('Restaurants');
    await input.press('Enter');
    await expect(await resultRows(page)).toHaveCount(3);
    // A quick fling on the map beside the panel, and locate tapped while it still glides.
    const box = (await page.locator('canvas.maplibregl-canvas').boundingBox())!;
    const panel = (await page.locator('.panel').boundingBox())!;
    const left = panel.y < box.height / 2 && panel.x < box.width / 2 ? panel.x + panel.width : 0;
    const y = box.y + box.height * 0.3;
    await page.mouse.move(left + (box.width - left) * 0.9, y);
    await page.mouse.down();
    await page.mouse.move(left + (box.width - left) * 0.6, y, { steps: 2 });
    await page.mouse.move(left + (box.width - left) * 0.3, y, { steps: 2 });
    await page.mouse.up();
    await page.locator('.controls > button').first().click();
    await idle(page);
    await expect(page.getByRole('button', { name: 'Search this area' })).toBeVisible();
  });

  test('offers the kinds of place and recent searches in an empty field, kept on the device', async ({
    page,
  }) => {
    await jump(page, { ...CENTER, zoom: 14 });
    const input = page.getByRole('combobox');
    const options = page.getByRole('option');
    const recents = page.locator('.r-recent');
    // Nothing yet: the kinds of place, a list of its own, none preselected.
    await input.focus();
    await expect(options.first()).toHaveAccessibleName('Categories, opens a list');
    await expect(options.first()).toHaveText('Categories');
    await expect(page.locator('[role=option][aria-selected=true]')).toHaveCount(0);
    await options.first().click();
    // In it: back first, then what people look for most; Escape goes back out.
    await expect(options.first()).toHaveAccessibleName('Back: Categories');
    await expect(options.nth(1)).toContainText('Restaurants');
    await expect(page.locator('.search [role=status]')).toContainText('Categories:');
    await input.press('Escape');
    await expect(options.first()).toHaveAccessibleName('Categories, opens a list');

    await input.fill('brandenburger');
    await options.filter({ hasText: SEARCH_HIT.name }).click();
    await page.locator('.card').getByRole('button', { name: 'Close' }).click();
    await jump(page, { ...CENTER, zoom: 14 });
    await input.fill('Restaurants');
    await input.press('Enter');
    await expect(await resultRows(page)).toHaveCount(3);
    await input.fill('');
    await page.mouse.move(1, 1);

    // Newest first, below the lists, a tap from either.
    await expect(recents.nth(0)).toContainText('Restaurants');
    await expect(recents.nth(1)).toContainText(SEARCH_HIT.name);
    await expect(recents.nth(1)).toContainText('Pariser Platz');
    // Kept across a reload, on the device only.
    await page.reload();
    await idle(page);
    await input.focus();
    await expect(recents.nth(1)).toContainText(SEARCH_HIT.name);
    await recents.nth(1).click();
    await expect(page.locator('.card').getByRole('heading')).toHaveText(SEARCH_HIT.name);
    await page.locator('.card').getByRole('button', { name: 'Close' }).click();

    // Taken again, it is the newest; forgotten on request (the cross, or Delete).
    await input.focus();
    await expect(recents.nth(0)).toContainText(SEARCH_HIT.name);
    await recents
      .nth(0)
      .getByRole('button', { name: /Remove .* from recent searches/ })
      .click();
    await expect(page.locator('.r-recent')).toHaveText([/Restaurants/]);
    // The arrows go on from the row the pointer last chose: on to the recent one.
    for (let i = 0; i < 8 && !(await page.locator('.r-recent[aria-selected=true]').count()); i++) {
      await input.press('ArrowDown');
    }
    await input.press('Delete');
    await expect(page.locator('.r-recent')).toHaveCount(0);
  });

  test('keeps a place from the map among the recent ones once something is done with it', async ({
    page,
  }) => {
    await jump(page, { ...CENTER, zoom: 16 });
    const box = page.viewportSize()!;
    const card = page.locator('.card');
    const input = page.getByRole('combobox');
    const recents = page.locator('.r-recent');
    // Only looked at: not kept, every tap would push out the searches.
    await page.mouse.click(box.width / 2, box.height / 3, { button: 'right' });
    await expect(card.getByRole('heading')).toHaveText('Unter den Linden 5');
    await card.getByRole('button', { name: 'Close' }).click();
    await input.focus();
    await expect(page.locator('.r-strip')).toBeVisible();
    await expect(recents).toHaveCount(0);
    await input.blur();
    // Something done with it (here, what is nearby): kept by its address, under "Recent".
    await page.mouse.click(box.width / 2, box.height / 3, { button: 'right' });
    await expect(card.getByRole('heading')).toHaveText('Unter den Linden 5');
    await card.getByRole('button', { name: 'Nearby' }).click();
    await input.press('Escape');
    await expect(page.locator('.r-heading')).toHaveText('Recent');
    await expect(recents).toHaveText([/Unter den Linden 5/]);
  });

  test('searches around a place from its card', async ({ page }) => {
    await jump(page, { ...CENTER, zoom: 13 });
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    await page.getByRole('option').filter({ hasText: SEARCH_HIT.name }).click();
    const card = page.locator('.card');
    await card.getByRole('button', { name: 'Nearby' }).click();
    // The card makes way for the search field, open on the kinds of place.
    await expect(card).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('');
    await idle(page);
    const c = await page.evaluate(() => window.kosmos!.getCenter());
    expect(Math.abs(c.lng - SEARCH_HIT.lng)).toBeLessThan(0.01);
    expect(await page.evaluate(() => window.kosmos!.getZoom())).toBeGreaterThanOrEqual(15);
    await page.getByRole('option').filter({ hasText: 'Restaurants' }).first().click();
    await expect(page.locator('.results-sheet')).toBeVisible();
  });

  test('the location button comes back from results elsewhere and offers to search there', async ({
    page,
    context,
  }) => {
    test.slow();
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.05, longitude: CENTER.lng });
    await page.reload();
    await idle(page);
    const locate = page.locator('.controls > button').first();
    await locate.click();
    await idle(page);
    // Still following, the map shows somewhere else: the user searches there.
    await jump(page, { ...CENTER, zoom: 14 });
    await idle(page);
    const input = page.getByRole('combobox');
    await input.fill('Restaurants');
    await page.getByRole('option').filter({ hasText: 'Restaurants' }).click();
    await expect(await resultRows(page)).toHaveCount(3);
    // Locate takes the map back to the user (not the compass), and offers the area there.
    await locate.click();
    await idle(page);
    const lat = () => page.evaluate(() => window.kosmos!.getCenter().lat);
    expect(await lat()).toBeCloseTo(CENTER.lat + 0.05, 3);
    await expect(page.getByRole('button', { name: 'Search this area' })).toBeVisible();
    // The search key now means here: the map stays with the user.
    await input.focus();
    await input.press('Enter');
    await expect(page.getByRole('button', { name: 'Search this area' })).toHaveCount(0);
    await page.waitForTimeout(1500);
    expect(await lat()).toBeCloseTo(CENTER.lat + 0.05, 3);
  });

  test('"show all" stops following, so the results stay on screen', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.05, longitude: CENTER.lng });
    await page.reload();
    await idle(page);
    await page.locator('.controls > button').first().click();
    await idle(page);
    await jump(page, { ...CENTER, zoom: 14 });
    await idle(page);
    const input = page.getByRole('combobox');
    await input.fill('Restaurants');
    await input.press('Enter');
    await expect(await resultRows(page)).toHaveCount(3);
    // The search key again: all of them on screen.
    await input.focus();
    await input.press('Enter');
    await idle(page);
    // A new fix does not pull the camera off the results.
    await context.setGeolocation({ latitude: CENTER.lat + 0.0501, longitude: CENTER.lng });
    await page.waitForTimeout(1500);
    const lat = await page.evaluate(() => window.kosmos!.getCenter().lat);
    expect(Math.abs(lat - CENTER.lat)).toBeLessThan(0.02);
  });

  test('finds stations as a kind of place, their cards with departures', async ({ page }) => {
    await jump(page, { ...CENTER, zoom: 15 });
    const input = page.getByRole('combobox');
    await input.fill('Bahnhof');
    await page.getByRole('option').filter({ hasText: 'Stations' }).click();
    const rows = await resultRows(page);
    await expect(rows).toHaveText([/Bahnhof Friedrichstraße/]);
    // What it is shows before its name is read: a train for a station.
    await expect(rows.first().locator('svg[data-kind="train"]')).toBeVisible();
    await rows.first().click();
    const card = page.locator('.card');
    await expect(card.getByRole('heading', { level: 2 })).toHaveText('Bahnhof Friedrichstraße');
    await expect(card.locator('.departures li')).toHaveCount(2);
  });

  test('a row lights up its dot; the place opened last stays marked', async ({ page }) => {
    await jump(page, { ...CENTER, zoom: 14 });
    const input = page.getByRole('combobox');
    await input.fill('Restaurants');
    await input.press('Enter');
    const rows = await resultRows(page);
    await expect(rows).toHaveCount(3);
    const lit = (id: number) =>
      page.evaluate((i) => !!window.kosmos!.getFeatureState({ source: 'search', id: i }).hot, id);
    // Held or hovered: its dot stands out, the others not; let go, it is back.
    await rows.nth(1).hover();
    await expect.poll(() => lit(1)).toBe(true);
    expect(await lit(0)).toBe(false);
    await page.mouse.move(1, 1);
    await expect.poll(() => lit(1)).toBe(false);
    // Opened and closed: the list comes back with that row marked, its dot lit.
    const name = (await rows.nth(2).locator('.r-name').textContent()) ?? '';
    await rows.nth(2).click();
    const card = page.locator('.card');
    await card.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.results-list [data-marked]')).toContainText(name);
    await page.mouse.move(1, 1);
    await expect.poll(() => lit(2)).toBe(true);
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
    // Meanwhile it says another is asked, not to try again.
    await expect(page.locator('.results .r-empty')).toHaveText(
      'Search is not answering. Asking another one…',
    );
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

  test('takes a slow Photon answer when it comes, though another was asked', async ({
    page,
    context,
  }) => {
    test.slow();
    // Photon answers after 7 s; Nominatim, asked at 5 s, finds nothing.
    await context.route(/photon\.komoot\.io\/api\//, async (route) => {
      await new Promise((go) => setTimeout(go, 7000));
      await route.fallback();
    });
    await context.route(/nominatim\.openstreetmap\.org\/search/, (route) =>
      route.fulfill({ contentType: 'application/json', body: '[]' }),
    );
    await page.getByRole('combobox').fill('brandenburger');
    await expect(page.getByRole('option').first()).toContainText(SEARCH_HIT.name, {
      timeout: 15_000,
    });
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
    const rows = await resultRows(page);
    await expect(rows.filter({ hasText: 'Zur Letzten Instanz' })).toHaveCount(1, {
      timeout: 5000,
    });
  });

  test('Enter opens the only result, even before results load', async ({ page }) => {
    const input = page.getByRole('combobox');
    await input.fill('einstein');
    await input.press('Enter');
    await expect(page.locator('.card').getByRole('heading')).toHaveText('Café Einstein');
    await idle(page);
    const c = await page.evaluate(() => window.kosmos!.getCenter());
    expect(Math.abs(c.lng - (CENTER.lng + 0.03))).toBeLessThan(0.01);
  });

  test('Enter shows all of several names, nearest first, none picked', async ({ page }) => {
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    await input.press('Enter');
    // No place card: the names are a sheet over the map, by distance.
    await expect(page.locator('.card')).toHaveCount(0);
    const rows = await resultRows(page);
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(/\d+(\.\d)? k?m/);
    const dots = () =>
      page.evaluate(async () => {
        const src = window.kosmos!.getSource('search') as import('maplibre-gl').GeoJSONSource;
        return ((await src.getData()) as GeoJSON.FeatureCollection).features.length;
      });
    await expect.poll(dots).toBe(2);
    // Both are on screen: the town lies within 30 km of the gate.
    await idle(page);
    const inView = await page.evaluate(
      ([a, b]) => [a, b].every((p) => window.kosmos!.getBounds().contains(p as [number, number])),
      [
        [SEARCH_HIT.lng, SEARCH_HIT.lat],
        [13.0, 52.4],
      ],
    );
    expect(inView).toBe(true);
    // A row opens its place; the search stays, its address is Photon's.
    await rows.filter({ hasText: SEARCH_HIT.name }).click();
    await expect(page.locator('.card').getByRole('heading')).toHaveText(SEARCH_HIT.name);
    await expect(page.locator('.card')).toContainText('Pariser Platz');
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
    const rows = await resultRows(page);
    await expect(rows).toHaveCount(3, { timeout: 10_000 });
    const dots = () =>
      page.evaluate(async () => {
        const src = window.kosmos!.getSource('search') as import('maplibre-gl').GeoJSONSource;
        return ((await src.getData()) as GeoJSON.FeatureCollection).features.length;
      });
    const shown = () =>
      page.evaluate(
        () => window.kosmos!.getLayoutProperty('search-dots', 'visibility') ?? 'visible',
      );
    await rows.first().click();
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
    const rows = await resultRows(page);
    await expect(rows).toHaveCount(1, { timeout: 10_000 });
    await expect(rows.first()).toContainText('Toilet');
    await rows.first().click();
    await expect(page.locator('.card').getByRole('heading')).toHaveText('Toilet');
    await expect(page.locator('.card')).toContainText('Unter den Linden 5');
    // Its dot on the map opens the same, never asking the search for the word "Toilet".
    await page.locator('.card').getByRole('button', { name: /close/i }).click();
    await idle(page);
    const dot = await page.evaluate(() => {
      const [f] = window.kosmos!.queryRenderedFeatures({ layers: ['search-dots'] });
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
      return window.kosmos!.project([lng, lat]);
    });
    const asked = photonSearches.length;
    await page.mouse.click(dot.x, dot.y);
    await expect(page.locator('.card').getByRole('heading')).toHaveText('Toilet');
    expect(photonSearches.slice(asked).filter((q) => /toilet/i.test(q))).toEqual([]);
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

  test('works from the keyboard: cards take focus, arrows choose, closing returns to search', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: CENTER.lat + 0.01, longitude: CENTER.lng + 0.01 });
    const input = page.getByRole('combobox');
    await input.fill('brandenburger');
    await expect(page.getByRole('option').first()).toContainText(SEARCH_HIT.name);
    // Down and up again: the first row, chosen, not only offered.
    await input.press('ArrowDown');
    await input.press('ArrowUp');
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

    // The route card's own close from the keyboard goes back to the place, as Escape does.
    await input.fill('brandenburg');
    await page.getByRole('option').filter({ hasText: SEARCH_HIT.name }).first().click();
    await place.getByRole('button', { name: /^Route$/ }).press('Enter');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Close' }).press('Enter');
    await expect(card).toHaveCount(0);
    await expect(place.getByRole('heading')).toBeFocused();
  });
});
