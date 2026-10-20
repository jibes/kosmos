import { expect, test } from '@playwright/test';
import { CENTER } from './fixtures/scene';
import { inWorld, jump, watchPages } from './helpers';

watchPages();

test.describe('more ways to search', () => {
  inWorld();

  test('coordinates, a map link and a Plus Code are the point itself', async ({ page }) => {
    await jump(page, { ...CENTER, zoom: 14 });
    const input = page.getByRole('combobox');
    const first = page.getByRole('option').first();
    await input.fill('52.52, 13.405');
    await expect(first).toContainText('52.52000° N, 13.40500° E');
    await input.fill('https://www.openstreetmap.org/#map=17/52.5163/13.3777');
    await expect(first).toContainText('52.51630° N');
    // A short Plus Code, near where the map looks.
    await input.fill('GCP3+');
    await expect(first).toContainText('° N');
    await first.click();
    const card = page.locator('.card');
    await expect(card.locator('.coords')).toContainText('52.5');
  });

  test('a postcode written loosely finds its area when the whole code is in no address', async ({
    page,
  }) => {
    await jump(page, { ...CENTER, zoom: 14 });
    const input = page.getByRole('combobox');
    await input.fill('d02x285');
    await expect(page.getByRole('option').first()).toContainText('Dublin 2');
    await expect(page.locator('.results .r-empty').first()).toHaveText(
      'Nothing for “d02x285”. Found for “D02”:',
    );
  });
});
