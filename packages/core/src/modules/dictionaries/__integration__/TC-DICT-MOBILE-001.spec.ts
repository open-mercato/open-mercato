import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createDictionaryFixture } from '@open-mercato/core/helpers/integration/dictionariesFixtures';
import { deleteEntityByPathIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';

test('TC-DICT-MOBILE-001: populated dictionary tables scroll locally at narrow widths', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin');
  const stamp = Date.now();
  const populatedName = `QA populated dictionary ${stamp}`;
  const emptyName = `QA empty dictionary ${stamp}`;
  const dictionaryIds: string[] = [];
  const entries: Array<{ dictionaryId: string; entryId: string }> = [];

  try {
    const populatedId = await createDictionaryFixture(request, token, {
      key: `qa_m_${stamp}_p`,
      name: populatedName,
    });
    dictionaryIds.push(populatedId);
    dictionaryIds.push(await createDictionaryFixture(request, token, {
      key: `qa_m_${stamp}_e`,
      name: emptyName,
    }));

    for (const input of [
      { value: 'appearance', label: 'Appearance sample' },
      { value: 'long_label', label: 'Długa etykieta kontrolna dla koloru: zachowaj wszystkie pozostałe pola' },
    ]) {
      const response = await apiRequest(request, 'POST', `/api/dictionaries/${populatedId}/entries`, {
        token,
        data: { ...input, icon: '⭐', color: '#6366f1' },
      });
      expect(response.status()).toBe(201);
      entries.push({ dictionaryId: populatedId, entryId: expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'Created entry has an id') });
    }

    await login(page, 'admin');
    await page.goto('/backend/config/dictionaries');

    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole('button', { name: emptyName }).click();
      await expect(page.getByRole('cell', { name: 'No entries yet.', exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.getByRole('button', { name: populatedName }).click();
      const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'appearance', exact: true }) });
      await expect(row).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const createButton = page.getByRole('button', { name: 'New dictionary', exact: true });
      const createBounds = await createButton.boundingBox();
      expect(createBounds).not.toBeNull();
      expect(createBounds!.x).toBeGreaterThanOrEqual(0);
      expect(createBounds!.x + createBounds!.width).toBeLessThanOrEqual(width);
      const editButton = row.getByRole('button').first();
      await editButton.scrollIntoViewIfNeeded();
      await editButton.click();
      await expect(page.getByRole('dialog', { name: 'Edit dictionary entry' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width === 390) {
        const tableSizing = await page.getByRole('table').evaluate((table) => {
          const scrollContainer = table.parentElement;
          return { scrollWidth: scrollContainer?.scrollWidth ?? 0, clientWidth: scrollContainer?.clientWidth ?? 0 };
        });
        expect(tableSizing.scrollWidth).toBeGreaterThan(tableSizing.clientWidth);
      }
    }
  } finally {
    for (const { dictionaryId, entryId } of entries) {
      await deleteEntityByPathIfExists(request, token, `/api/dictionaries/${dictionaryId}/entries/${entryId}`);
    }
    for (const dictionaryId of dictionaryIds) {
      await deleteEntityByPathIfExists(request, token, `/api/dictionaries/${dictionaryId}`);
    }
  }
});
