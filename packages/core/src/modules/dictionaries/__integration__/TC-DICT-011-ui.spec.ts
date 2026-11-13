import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { login } from '@open-mercato/core/helpers/integration/auth';
import { createOrganizationFixture, deleteOrganizationIfExists } from '@open-mercato/core/helpers/integration/authFixtures';
import { deleteEntityByPathIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures';

/**
 * TC-DICT-011-UI: browser companion to the API-only TC-DICT-011.
 *
 * Follow-up from #7905 / #8780. #8781 (merged) fixed the reserved-key 409,
 * retained the dialog, and localized the duplicate-key flash's close label
 * and the entry preview heading — but TC-DICT-011 only exercises the API.
 * This drives the exact flow through Settings -> Dictionaries: delete a
 * dictionary, submit its now-reserved key from "New dictionary", confirm the
 * dialog/field state and the deleted row's data survive the refusal, retry
 * with Ctrl+Enter, then recover with a new key — in both English and Polish.
 */

const LOCALE_TEXT = {
  en: {
    listAdd: 'New dictionary',
    createTitle: 'Create dictionary',
    namePlaceholder: 'Display name',
    save: 'Save',
    confirm: 'Confirm',
    duplicateFlash: 'Failed to save dictionary.',
    close: 'Close',
    successCreate: 'Dictionary created.',
    successDelete: 'Dictionary deleted.',
    addEntry: 'Add entry',
    addEntryTitle: 'Add dictionary entry',
    entryCancel: 'Cancel',
    preview: 'Preview',
  },
  pl: {
    listAdd: 'Nowy słownik',
    createTitle: 'Utwórz słownik',
    namePlaceholder: 'Nazwa wyświetlana',
    save: 'Zapisz',
    confirm: 'Potwierdź',
    duplicateFlash: 'Nie udało się zapisać słownika.',
    close: 'Zamknij',
    successCreate: 'Słownik został utworzony.',
    successDelete: 'Słownik został usunięty.',
    addEntry: 'Dodaj wpis',
    addEntryTitle: 'Dodaj wpis słownika',
    entryCancel: 'Anuluj',
    preview: 'Podgląd',
  },
} as const;

type Locale = keyof typeof LOCALE_TEXT;

type DictionaryRow = {
  key: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  manager_visibility: string;
  entry_sort_mode: string;
  deleted_at: Date | null;
  updated_at: Date;
};

type DictionaryEntryRow = {
  id: string;
  value: string;
  normalized_value: string;
  label: string;
  color: string | null;
  icon: string | null;
  position: number;
  is_default: boolean;
  updated_at: Date;
};

// A soft-deleted dictionary (and its entries) 404 through the API — both
// `loadDictionary` helpers in the dictionaries routes filter `deletedAt: null`
// unconditionally, even with `includeInactive=true` on the list route. Reading
// the row straight from Postgres is the only way to prove the refused create
// left it untouched.
async function loadDictionaryRow(dictionaryId: string): Promise<DictionaryRow | null> {
  return withClient(async (client) => {
    const result = await client.query<DictionaryRow>(
      `select key, name, description, is_system, is_active, manager_visibility, entry_sort_mode, deleted_at, updated_at
       from dictionaries where id = $1`,
      [dictionaryId],
    );
    return result.rows[0] ?? null;
  });
}

async function loadDictionaryEntryRows(dictionaryId: string): Promise<DictionaryEntryRow[]> {
  return withClient(async (client) => {
    const result = await client.query<DictionaryEntryRow>(
      `select id, value, normalized_value, label, color, icon, position, is_default, updated_at
       from dictionary_entries where dictionary_id = $1 order by position, id`,
      [dictionaryId],
    );
    return result.rows;
  });
}

async function createScopedDictionary(
  request: APIRequestContext,
  token: string,
  scopeHeaders: Record<string, string>,
  input: { key: string; name: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/dictionaries', {
    token,
    headers: scopeHeaders,
    data: input,
  });
  expect(response.status(), `POST /api/dictionaries (${input.key}) should return 201`).toBe(201);
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'Dictionary fixture should have an id');
}

test.describe('TC-DICT-011-UI: reserved-key conflict feedback in the browser', () => {
  test('retains the dialog, preserves data, and localizes feedback', async ({ page, request, baseURL }) => {
    test.setTimeout(240_000);
    expect(baseURL).toBeTruthy();

    const superToken = await getAuthToken(request, 'superadmin');
    const unique = randomUUID().slice(0, 8);

    const tenantResponse = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: superToken,
      data: { name: `QA Dict 011 UI ${unique}` },
    });
    expect(tenantResponse.ok()).toBeTruthy();
    const tenantId = expectId((await readJsonSafe<{ id?: string }>(tenantResponse))?.id, 'Tenant fixture should have an id');
    const organizationId = await createOrganizationFixture(request, superToken, {
      name: `QA Dict 011 UI ${unique}`,
      tenantId,
    });
    const scopeHeaders = { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${organizationId}` };

    const createdDictionaryIds: string[] = [];

    try {
      await login(page, 'superadmin');
      await page.context().addCookies([
        { name: 'om_selected_tenant', value: tenantId, url: baseURL! },
        { name: 'om_selected_org', value: organizationId, url: baseURL! },
      ]);

      for (const locale of ['pl', 'en'] as Locale[]) {
        const text = LOCALE_TEXT[locale];
        const deletedKey = `qa_dict011ui_${locale}_${unique}`;
        const newKey = `qa_dict011ui_${locale}_${unique}_new`;
        const dictionaryName = `QA Dict011 UI Deleted ${locale} ${unique}`;
        const retryName = `QA Dict011 UI Retry ${locale} ${unique}`;
        const entryValue = `qa_entry_${locale}_${unique}`;
        const entryLabel = `QA Entry ${locale} ${unique}`;

        const dictionaryId = await createScopedDictionary(request, superToken, scopeHeaders, {
          key: deletedKey,
          name: dictionaryName,
        });
        createdDictionaryIds.push(dictionaryId);
        const entryResponse = await apiRequest(request, 'POST', `/api/dictionaries/${dictionaryId}/entries`, {
          token: superToken,
          headers: scopeHeaders,
          data: { value: entryValue, label: entryLabel },
        });
        expect(entryResponse.status(), 'POST dictionary entry should return 201').toBe(201);

        await page.context().addCookies([{ name: 'locale', value: locale, url: baseURL! }]);
        await page.goto('/backend/config/dictionaries');
        await expect(page.getByRole('button', { name: dictionaryName })).toBeVisible();

        // Delete through Settings -> Dictionaries.
        const dictionaryRow = page.locator('li').filter({ hasText: dictionaryName });
        await dictionaryRow.getByRole('button').last().click();
        const confirmDialog = page.getByRole('alertdialog');
        await expect(confirmDialog).toBeVisible();
        await confirmDialog.getByRole('button', { name: text.confirm, exact: true }).click();
        await expect(page.locator('[data-slot="alert"]')).toContainText(text.successDelete);
        await expect(page.getByRole('button', { name: dictionaryName })).toHaveCount(0);

        const rowAfterDelete = await loadDictionaryRow(dictionaryId);
        expect(rowAfterDelete, 'the deleted dictionary row should still exist').not.toBeNull();
        expect(rowAfterDelete!.deleted_at).not.toBeNull();
        const entriesAfterDelete = await loadDictionaryEntryRows(dictionaryId);
        expect(entriesAfterDelete).toHaveLength(1);

        // Submit the reserved key from "New dictionary".
        await page.getByRole('button', { name: text.listAdd, exact: true }).click();
        const createDialog = page.getByRole('dialog', { name: text.createTitle });
        await expect(createDialog).toBeVisible();
        const keyInput = createDialog.getByPlaceholder('slug_name');
        const nameInput = createDialog.getByPlaceholder(text.namePlaceholder);
        await keyInput.fill(deletedKey);
        await nameInput.fill(retryName);

        const firstAttempt = page.waitForResponse((response) => response.request().method() === 'POST'
          && new URL(response.url()).pathname === '/api/dictionaries');
        await createDialog.getByRole('button', { name: text.save, exact: true }).click();
        const firstResponse = await firstAttempt;
        expect(firstResponse.status(), 'reserved-key create should return 409').toBe(409);

        // Both checks poll concurrently (not one after another) so neither assertion's
        // retry loop eats into the toast's fixed 3s auto-dismiss window on its own.
        const flash = page.locator('[data-slot="alert"]');
        const flashDismissButton = flash.locator('[data-slot="alert-dismiss"]');
        await Promise.all([
          expect(flash).toContainText(text.duplicateFlash),
          expect(flashDismissButton).toHaveAttribute('aria-label', text.close),
        ]);
        await expect(createDialog, 'the dialog should stay open after the refusal').toBeVisible();
        await expect(keyInput).toHaveValue(deletedKey);
        await expect(nameInput).toHaveValue(retryName);

        const listAfterRefusal = await apiRequest(request, 'GET', '/api/dictionaries?includeInactive=true', {
          token: superToken,
          headers: scopeHeaders,
        });
        const liveMatches = ((await readJsonSafe<{ items?: Array<{ key?: string }> }>(listAfterRefusal))?.items ?? [])
          .filter((item) => item.key === deletedKey);
        expect(liveMatches, 'no new live dictionary should hold the reserved key').toEqual([]);

        const rowAfterRefusal = await loadDictionaryRow(dictionaryId);
        expect(rowAfterRefusal, 'the original row must be preserved after the refusal').toEqual(rowAfterDelete);
        const entriesAfterRefusal = await loadDictionaryEntryRows(dictionaryId);
        expect(entriesAfterRefusal, 'the original entries must be preserved after the refusal').toEqual(entriesAfterDelete);

        // Retry via Ctrl+Enter on the still-reserved key: a fresh 409, not a stale flash.
        await keyInput.click();
        const retryAttempt = page.waitForResponse((response) => response.request().method() === 'POST'
          && new URL(response.url()).pathname === '/api/dictionaries');
        await page.keyboard.press('Control+Enter');
        const retryResponse = await retryAttempt;
        expect(retryResponse.status(), 'the Ctrl+Enter retry on the reserved key should return 409').toBe(409);
        await expect(createDialog).toBeVisible();
        await expect(flash).toContainText(text.duplicateFlash);

        // Correct the key and retry: a clean 201 with no stale error.
        await keyInput.fill(newKey);
        const createAttempt = page.waitForResponse((response) => response.request().method() === 'POST'
          && new URL(response.url()).pathname === '/api/dictionaries');
        await page.keyboard.press('Control+Enter');
        const createResponse = await createAttempt;
        expect(createResponse.status(), 'create with the corrected key should return 201').toBe(201);
        const newDictionaryId = expectId(
          ((await createResponse.json()) as { id?: string })?.id,
          'Created dictionary should have an id',
        );
        createdDictionaryIds.push(newDictionaryId);
        await expect(createDialog).toHaveCount(0);
        await expect(flash).toContainText(text.successCreate);
        await expect(flash).not.toContainText(text.duplicateFlash);

        // The entry dialog's preview heading is localized too.
        await page.getByRole('button', { name: retryName }).click();
        await page.getByRole('button', { name: text.addEntry, exact: true }).click();
        const entryDialog = page.getByRole('dialog', { name: text.addEntryTitle });
        await expect(entryDialog).toBeVisible();
        await expect(entryDialog.getByText(text.preview, { exact: true })).toBeVisible();
        await entryDialog.getByRole('button', { name: text.entryCancel, exact: true }).click();
        await expect(entryDialog).toHaveCount(0);
      }
    } finally {
      for (const id of createdDictionaryIds) {
        await deleteEntityByPathIfExists(request, superToken, `/api/dictionaries/${id}`);
      }
      await deleteOrganizationIfExists(request, superToken, organizationId);
      await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${tenantId}`, { token: superToken }).catch(() => {});
      await page.request.post('/api/auth/locale', { data: { locale: 'en' } }).catch(() => {});
    }
  });
});
