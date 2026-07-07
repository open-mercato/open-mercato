import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupCurrency,
  createCurrencyFixture,
  getCurrencyUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateCurrencyName,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CUR-currency: Phase 6 record-locks coverage for the CURRENCY entity
 * (`currencies.currency`).
 *
 * Currencies are a `makeCrudRoute` resource guarded on their OWN row by the CRUD
 * mutation-guard decorator. The currency detail screen (`backend/currencies/[id]`)
 * is a `CrudForm` that captures `updatedAt` at load and replays it on save/delete
 * via the OSS optimistic-lock header, and now publishes `backend:record:current`
 * presence so the merge dialog surfaces the concurrent-edit 409. The list-row
 * deletes route their 409 through the unified conflict surface. A stale edit 409s;
 * a fresh-version edit succeeds.
 *
 * Self-contained: creates its own currency with a random ISO code, restores
 * settings and deletes the currency in `finally`.
 */
test.describe('TC-LOCK-CUR-currency: optimistic conflict on currency edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  function randomCurrencyCode(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 3; i += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
  }

  test('a stale currency edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let currencyId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['currencies.currency'],
      });

      currencyId = await createCurrencyFixture(request, adminToken, {
        code: randomCurrencyCode(),
        name: `QA Lock Currency ${suffix}`,
      });

      const baseUpdatedAt = await getCurrencyUpdatedAt(request, adminToken, currencyId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateCurrencyName(request, adminToken, currencyId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateCurrencyName(request, adminToken, currencyId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getCurrencyUpdatedAt(request, adminToken, currencyId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateCurrencyName(request, adminToken, currencyId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupCurrency(request, adminToken, currencyId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
