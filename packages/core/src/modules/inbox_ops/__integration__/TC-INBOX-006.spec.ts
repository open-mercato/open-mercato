import { test, expect } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-INBOX-006: Settings PATCH — update working language and active status
 * Source: GitHub issue #2479 (inbox_ops integration coverage)
 *
 * GET seeds (or returns) tenant settings; PATCH updates workingLanguage / isActive,
 * invalidates the settings cache (subsequent GET reflects the new value), and
 * rejects an out-of-enum language with 400. The original settings are restored in
 * `finally` so the tenant-shared row is left untouched. Needs no LLM extraction.
 */
test.describe('TC-INBOX-006: Settings PATCH', () => {
  type Settings = { id: string; inboxAddress: string; isActive: boolean; workingLanguage: string };
  const LOCALES = ['de', 'es', 'pl', 'en'];
  let token: string;

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin');
  });

  test('updates language and active status, invalidates cache, validates input', async ({ request }) => {
    const initialResponse = await apiRequest(request, 'GET', '/api/inbox_ops/settings', { token });
    expect(initialResponse.status()).toBe(200);
    const initialBody = await readJsonSafe<{ settings: Settings | null }>(initialResponse);
    expect(initialBody?.settings, 'settings are auto-provisioned for the tenant').toBeTruthy();

    const original = initialBody!.settings!;
    const originalLanguage = original.workingLanguage;
    const originalActive = original.isActive;
    const nextLanguage = LOCALES.find((locale) => locale !== originalLanguage)!;

    try {
      // PATCH working language → returns the updated settings object.
      const patchLanguage = await apiRequest(request, 'PATCH', '/api/inbox_ops/settings', {
        token,
        data: { workingLanguage: nextLanguage },
      });
      expect(patchLanguage.status()).toBe(200);
      const patchLanguageBody = await readJsonSafe<{ ok: boolean; settings: Settings }>(patchLanguage);
      expect(patchLanguageBody?.ok).toBe(true);
      expect(patchLanguageBody?.settings?.workingLanguage).toBe(nextLanguage);

      // Subsequent GET reflects the change (settings cache was invalidated).
      const reread = await apiRequest(request, 'GET', '/api/inbox_ops/settings', { token });
      expect(reread.status()).toBe(200);
      const rereadBody = await readJsonSafe<{ settings: Settings }>(reread);
      expect(rereadBody?.settings?.workingLanguage).toBe(nextLanguage);

      // PATCH active status independently.
      const patchActive = await apiRequest(request, 'PATCH', '/api/inbox_ops/settings', {
        token,
        data: { isActive: !originalActive },
      });
      expect(patchActive.status()).toBe(200);
      const patchActiveBody = await readJsonSafe<{ ok: boolean; settings: Settings }>(patchActive);
      expect(patchActiveBody?.settings?.isActive).toBe(!originalActive);
      // The language change is retained alongside the active-status update.
      expect(patchActiveBody?.settings?.workingLanguage).toBe(nextLanguage);

      // Out-of-enum language is rejected before persistence.
      const invalid = await apiRequest(request, 'PATCH', '/api/inbox_ops/settings', {
        token,
        data: { workingLanguage: 'invalid' },
      });
      expect(invalid.status()).toBe(400);
      const invalidBody = await readJsonSafe<{ error?: string }>(invalid);
      expect(invalidBody?.error ?? '').toMatch(/invalid request/i);
    } finally {
      await apiRequest(request, 'PATCH', '/api/inbox_ops/settings', {
        token,
        data: { workingLanguage: originalLanguage, isActive: originalActive },
      }).catch(() => undefined);
    }
  });
});
