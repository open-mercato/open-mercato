import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createPersonFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  cleanupComment,
  cleanupPerson,
  createCommentFixture,
  getCommentUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateCommentBody,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CUST-notes: Phase 2 record-locks coverage for the customers notes
 * subform (`customers:customer_comment`).
 *
 * Notes write through the makeCrudRoute `customers/comments` route, so the
 * server-side optimistic-lock guard is auto-covered by the CRUD mutation-guard
 * decorator; Phase 2 wired the client adapter to send the expected-version header
 * so a stale note edit surfaces the unified 409 conflict.
 *
 * Self-contained: creates its own person + note via the API, restores settings
 * and removes both in `finally`.
 */
test.describe('TC-LOCK-CUST-notes: optimistic conflict on note edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale note edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let personId: string | null = null;
    let commentId: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.comment'],
      });

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `Note ${Date.now()}`,
        displayName: `QA TC-LOCK-CUST-notes ${Date.now()}`,
      });

      commentId = await createCommentFixture(request, adminToken, { entityId: personId, body: 'Initial note' });

      const baseUpdatedAt = await getCommentUpdatedAt(request, adminToken, personId, commentId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateCommentBody(request, adminToken, commentId, 'Incoming note edit', baseUpdatedAt);
      expect(incoming.status).toBe(200);

      const stale = await updateCommentBody(request, adminToken, commentId, 'Stale note edit', baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getCommentUpdatedAt(request, adminToken, personId, commentId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateCommentBody(request, adminToken, commentId, 'Resaved note', freshUpdatedAt);
      expect(resaved.status).toBe(200);
    } finally {
      await cleanupComment(request, adminToken, commentId);
      await cleanupPerson(request, adminToken, personId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
