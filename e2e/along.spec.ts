import { expect, test } from '@playwright/test';
import { routeRequests } from './fixtures/offline-world';
import { inWorld, openRoute, watchPages } from './helpers';

watchPages();

test.describe('along the route', () => {
  inWorld();

  test('finds a café on the way and makes it a stop, before setting off and while guiding', async ({
    page,
    context,
  }) => {
    const card = await openRoute(page, context);
    await card.getByText('Along the way').click();
    const along = card.locator('.along');
    await along.getByRole('button', { name: 'Cafés', exact: true }).click();
    await expect(along.getByRole('button', { name: 'Cafés', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // On the way, how far along it: a stop by way of it is one route request.
    const row = along.locator('.along-list li').filter({ hasText: 'Café Einstein' });
    await expect(row).toContainText(/in [\d.,]+ (m|km) · (on the way|\+\d+ min)/);
    // And on the map, a dot by its name.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window
              .kosmos!.querySourceFeatures('along')
              .filter((f) => f.properties.name === 'Café Einstein').length,
        ),
      )
      .toBeGreaterThan(0);
    // Any other kind, from the list of them; the dots follow what the list shows.
    await along.getByRole('combobox', { name: 'Other…' }).selectOption({ label: 'Pharmacies' });
    await expect(along.locator('.along-list li').first()).toContainText('Linden-Apotheke');
    const dots = () =>
      page.evaluate(() =>
        window.kosmos!.querySourceFeatures('along').map((f) => String(f.properties.name)),
      );
    await expect.poll(dots).toContain('Linden-Apotheke');
    // The system turning dark restyles the map: the dots stay (a tunnel does the same).
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe('dark');
    await page.waitForTimeout(1000);
    await expect.poll(dots).toContain('Linden-Apotheke');
    // None of a kind the way does not pass.
    await along.getByRole('button', { name: 'Petrol stations', exact: true }).click();
    await expect(along.locator('.along-list')).toHaveText('None along the way');
    await expect.poll(dots).toEqual([]);
    await along.getByRole('button', { name: 'Cafés', exact: true }).click();
    const asked = routeRequests.length;
    await row.getByRole('button', { name: 'Add Café Einstein as a stop' }).click();
    await expect.poll(() => routeRequests.length).toBe(asked + 1);
    expect(routeRequests.at(-1)!.via).toHaveLength(1);
    await expect(card.locator('.point-list li')).toHaveCount(3);

    // While guiding: in the panel of the points ahead.
    await card.getByRole('button', { name: 'Start', exact: true }).click();
    await page.locator('.nav-banner').click();
    const panel = page.locator('.ride-details .along');
    await expect(panel.getByRole('heading', { name: 'Along the way' })).toBeVisible();
    await panel.getByRole('button', { name: 'Cafés', exact: true }).click();
    await expect(panel.locator('.along-list li').first()).toContainText('Café Einstein');
  });
});
