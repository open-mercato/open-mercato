import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  cleanupTag,
  createTagFixture,
  getTagUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateTagLabel,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CUST-tags: Phase 2 record-locks coverage for the customers tag
 * config entity (`customers:customer_tag`).
 *
 * Tags are edited through the makeCrudRoute `customers/tags` route, so the
 * server-side optimistic-lock guard is auto-covered by the CRUD mutation-guard
 * decorator. (Tag *assignment* — assign/unassign — stays exempt as a junction
 * write and is not exercised here.)
 *
 * Self-contained: creates its own tag via the API, restores settings and
 * deletes the tag in `finally`.
 */
test.describe('TC-LOCK-CUST-tags: optimistic conflict on tag edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale tag edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let tagId: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.tag'],
      });

      const suffix = `${Date.now()}`;
      tagId = await createTagFixture(request, adminToken, {
        slug: `qa_lock_tag_${suffix}`,
        label: `QA Lock Tag ${suffix}`,
      });

      const baseUpdatedAt = await getTagUpdatedAt(request, adminToken, tagId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateTagLabel(request, adminToken, tagId, `Incoming ${suffix}`, baseUpdatedAt);
      expect(incoming.status).toBe(200);

      const stale = await updateTagLabel(request, adminToken, tagId, `Stale ${suffix}`, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getTagUpdatedAt(request, adminToken, tagId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateTagLabel(request, adminToken, tagId, `Resaved ${suffix}`, freshUpdatedAt);
      expect(resaved.status).toBe(200);
    } finally {
      await cleanupTag(request, adminToken, tagId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
