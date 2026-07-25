import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createPersonFixture } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  cleanupPerson,
  cleanupTodoLink,
  createTodoFixture,
  getTodoUpdatedAt,
  getRecordLockSettings,
  saveRecordLockSettings,
  updateTodoTitle,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-CUST-tasks: Phase 2 record-locks coverage for the customers tasks/todos
 * subform (`customers:customer_todo_link` → underlying interaction).
 *
 * The legacy /api/customers/todos route dispatches the migrated
 * `customers.interactions.update` command (async seam), so a stale task edit
 * surfaces the unified 409 conflict instead of silently overwriting (#2055).
 *
 * Self-contained: creates its own person + task via the API, restores settings
 * and removes both in `finally`.
 */
test.describe('TC-LOCK-CUST-tasks: optimistic conflict on task edit', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale task edit 409s; a fresh-version edit succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let personId: string | null = null;
    let linkId: string | null = null;
    let todoId: string | null = null;

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['customers.interaction'],
      });

      personId = await createPersonFixture(request, adminToken, {
        firstName: 'QA',
        lastName: `Task ${Date.now()}`,
        displayName: `QA TC-LOCK-CUST-tasks ${Date.now()}`,
      });

      const created = await createTodoFixture(request, adminToken, { entityId: personId, title: 'Initial task' });
      linkId = created.linkId;
      todoId = created.todoId;

      const baseUpdatedAt = await getTodoUpdatedAt(request, adminToken, personId, linkId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateTodoTitle(request, adminToken, { todoId, linkId, title: 'Incoming task edit' }, baseUpdatedAt);
      expect(incoming.status).toBe(200);

      const stale = await updateTodoTitle(request, adminToken, { todoId, linkId, title: 'Stale task edit' }, baseUpdatedAt);
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getTodoUpdatedAt(request, adminToken, personId, linkId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateTodoTitle(request, adminToken, { todoId, linkId, title: 'Resaved task' }, freshUpdatedAt);
      expect(resaved.status).toBe(200);
    } finally {
      await cleanupTodoLink(request, adminToken, linkId);
      await cleanupPerson(request, adminToken, personId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
