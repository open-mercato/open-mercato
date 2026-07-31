import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupQuote,
  createQuoteFixture,
  getQuoteUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateQuoteComment,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-SALES-quote: Phase 3 record-locks coverage for the sales QUOTE
 * document aggregate (`sales.quote`).
 *
 * Quote header updates run through `sales.quotes.update`, which guards the
 * parent quote's `updated_at` via `enforceSalesDocumentOptimisticLock` → the
 * async record_locks seam. Two concurrent header edits sharing the same base
 * version race: the first wins and advances the aggregate, the second (stale)
 * 409s; a fresh-version retry succeeds.
 *
 * Self-contained: creates its own quote via the API, restores settings and
 * deletes the quote in `finally`.
 */
test.describe('TC-LOCK-SALES-quote: optimistic conflict on quote aggregate edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale quote edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let quoteId: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['sales.quote'],
      });

      const suffix = `${Date.now()}`;
      quoteId = await createQuoteFixture(request, adminToken, 'USD');

      const baseUpdatedAt = await getQuoteUpdatedAt(request, adminToken, quoteId);
      expect(baseUpdatedAt).toBeTruthy();

      // First writer wins and advances the quote aggregate version.
      const incoming = await updateQuoteComment(request, adminToken, quoteId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      // Second writer carries the now-stale base version → 409.
      const stale = await updateQuoteComment(request, adminToken, quoteId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getQuoteUpdatedAt(request, adminToken, quoteId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateQuoteComment(request, adminToken, quoteId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await cleanupQuote(request, adminToken, quoteId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
