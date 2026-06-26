import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createWebhookFixture,
  deleteWebhookIfExists,
  getRecordLockSettings,
  getWebhookUpdatedAt,
  saveRecordLockSettings,
  updateWebhookName,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-WH-endpoint: Phase 6b part B record-locks coverage for the WEBHOOK
 * ENDPOINT (`webhooks.endpoint`).
 *
 * Webhook endpoint config is tenant/org-scoped and encrypted-secret adjacent.
 * The hand-rolled PUT/DELETE route (`packages/webhooks/.../api/webhooks/[id]`)
 * was migrated to the async DI-aware command seam
 * `enforceCommandOptimisticLockWithGuards(scope.container, ...)`. The client
 * carries the endpoint's `updated_at` via the OSS optimistic-lock header; a stale
 * value 409s (conflict body), a fresh-version edit succeeds, and record_locks —
 * when enabled — resolves the richer conflict.
 *
 * Self-contained: creates its own webhook, restores settings and deletes the
 * webhook in `finally`.
 */
test.describe('TC-LOCK-WH-endpoint: optimistic conflict on webhook endpoint edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale webhook edit 409s; a fresh-version edit succeeds; header-less stays additive', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let webhookId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['webhooks.endpoint'],
      });

      webhookId = await createWebhookFixture(request, adminToken, {
        name: `QA Lock Hook ${suffix}`,
        url: `https://example.com/qa-lock-hook-${suffix}`,
        events: ['sales.order.created'],
      });

      const baseUpdatedAt = await getWebhookUpdatedAt(request, adminToken, webhookId);
      expect(baseUpdatedAt).toBeTruthy();

      // First edit with the captured version wins and advances the version.
      const incoming = await updateWebhookName(request, adminToken, webhookId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      // Second edit replaying the now-stale version 409s with the conflict body.
      const stale = await updateWebhookName(request, adminToken, webhookId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getWebhookUpdatedAt(request, adminToken, webhookId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      // Resave with the fresh version succeeds.
      const resaved = await updateWebhookName(request, adminToken, webhookId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);

      // Header-less edit still works (strictly additive).
      const additive = await updateWebhookName(request, adminToken, webhookId, `Additive ${suffix}`, null);
      expect(additive.status).toBeLessThan(300);
    } finally {
      await deleteWebhookIfExists(request, adminToken, webhookId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
