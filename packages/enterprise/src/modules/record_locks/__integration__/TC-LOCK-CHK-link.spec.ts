import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCheckoutLinkFixture,
  createCheckoutTemplateFixture,
  deleteCheckoutIfExists,
  getCheckoutUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateCheckoutSubtitle,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CHK-link: Phase 6b part B record-locks coverage for the admin
 * CHECKOUT LINK and TEMPLATE (`checkout.link`, `checkout.template`).
 *
 * Admin pay-link/template edits run through the command pattern
 * (`checkout.{link,template}.update`), migrated to the async DI-aware seam
 * `enforceCommandOptimisticLockWithGuards(ctx.container, ...)`. The client
 * carries the record's `updated_at` via the OSS optimistic-lock header; a stale
 * value 409s, a fresh-version edit succeeds, and record_locks — when enabled —
 * resolves the richer conflict. Public pay/transaction flows remain
 * server-authoritative and are intentionally NOT lock-guarded.
 *
 * Self-contained: creates its own link + template, restores settings and deletes
 * both in `finally`.
 */
test.describe('TC-LOCK-CHK-link: optimistic conflict on checkout link/template edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale pay-link edit 409s; a fresh-version edit succeeds; header-less stays additive', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let linkId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['checkout.link'],
      });

      linkId = await createCheckoutLinkFixture(request, adminToken, `QA Lock Link ${suffix}`);

      const baseUpdatedAt = await getCheckoutUpdatedAt(request, adminToken, 'links', linkId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateCheckoutSubtitle(request, adminToken, 'links', linkId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateCheckoutSubtitle(request, adminToken, 'links', linkId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getCheckoutUpdatedAt(request, adminToken, 'links', linkId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateCheckoutSubtitle(request, adminToken, 'links', linkId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);

      const additive = await updateCheckoutSubtitle(request, adminToken, 'links', linkId, `Additive ${suffix}`, null);
      expect(additive.status).toBeLessThan(300);
    } finally {
      await deleteCheckoutIfExists(request, adminToken, 'links', linkId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });

  test('a stale template edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let templateId: string | null = null;
    const suffix = `${Date.now()}`;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['checkout.template'],
      });

      templateId = await createCheckoutTemplateFixture(request, adminToken, `QA Lock Template ${suffix}`);

      const baseUpdatedAt = await getCheckoutUpdatedAt(request, adminToken, 'templates', templateId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateCheckoutSubtitle(request, adminToken, 'templates', templateId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateCheckoutSubtitle(request, adminToken, 'templates', templateId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getCheckoutUpdatedAt(request, adminToken, 'templates', templateId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateCheckoutSubtitle(request, adminToken, 'templates', templateId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await deleteCheckoutIfExists(request, adminToken, 'templates', templateId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
