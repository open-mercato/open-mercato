import { expect, test } from '@playwright/test';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  buildMinimalDefinitionPayload,
  createWorkflowDefinitionFixture,
  deleteWorkflowDefinitionIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/workflowsFixtures';
import {
  getRecordLockSettings,
  getWorkflowDefinitionUpdatedAt,
  saveRecordLockSettings,
  updateWorkflowDefinitionName,
  type RecordLockSettings,
} from './helpers/recordLocks';

/**
 * TC-LOCK-WF-visual-editor: Phase 6 record-locks coverage for the WORKFLOW
 * DEFINITION entity (`workflows.definition`) via the visual editor save path.
 *
 * The visual editor (`backend/definitions/visual-editor`) is a React-Flow graph
 * that saves via a raw `apiCall` PUT to `/api/workflows/definitions/<id>` with a
 * hand-built optimistic-lock header (captured `updatedAt`). The route uses
 * `validateCrudMutationGuard` + `enforceCommandOptimisticLock` (resourceKind
 * `workflows.definition`). This is the highest-value record_locks target
 * (long-lived edits): presence is mounted on the editor and its 409 is routed
 * through the unified conflict surface. A stale save 409s; a fresh-version save
 * succeeds — exercising the exact PUT path the visual editor uses.
 *
 * Self-contained: creates its own definition, restores settings and deletes the
 * definition in `finally`.
 */
test.describe('TC-LOCK-WF-visual-editor: optimistic conflict on workflow definition save', () => {
  test.describe.configure({ timeout: 120_000 });

  const CONFLICT_CODES = ['optimistic_lock_conflict', 'record_lock_conflict'];

  test('a stale visual-editor save 409s; a fresh-version save succeeds', async ({ request }) => {
    const superadminToken = await getAuthToken(request, 'superadmin');
    const adminToken = await getAuthToken(request, 'admin');

    let previousSettings: RecordLockSettings | null = null;
    let definitionId: string | null = null;
    const stamp = Date.now();

    try {
      previousSettings = await getRecordLockSettings(request, superadminToken);
      await saveRecordLockSettings(request, superadminToken, {
        ...previousSettings,
        enabled: true,
        strategy: 'optimistic',
        enabledResources: ['workflows.definition'],
      });

      definitionId = await createWorkflowDefinitionFixture(
        request,
        adminToken,
        buildMinimalDefinitionPayload(stamp, '-wf-lock'),
      );

      const baseUpdatedAt = await getWorkflowDefinitionUpdatedAt(request, adminToken, definitionId);
      expect(baseUpdatedAt).toBeTruthy();

      const incoming = await updateWorkflowDefinitionName(
        request,
        adminToken,
        definitionId,
        `QA Lock WF incoming ${stamp}`,
        baseUpdatedAt,
      );
      expect(incoming.status).toBeLessThan(300);

      const stale = await updateWorkflowDefinitionName(
        request,
        adminToken,
        definitionId,
        `QA Lock WF stale ${stamp}`,
        baseUpdatedAt,
      );
      expect(stale.status).toBe(409);
      expect(CONFLICT_CODES).toContain(stale.body?.code as string);

      const freshUpdatedAt = await getWorkflowDefinitionUpdatedAt(request, adminToken, definitionId);
      expect(freshUpdatedAt).toBeTruthy();
      expect(freshUpdatedAt).not.toBe(baseUpdatedAt);

      const resaved = await updateWorkflowDefinitionName(
        request,
        adminToken,
        definitionId,
        `QA Lock WF resaved ${stamp}`,
        freshUpdatedAt,
      );
      expect(resaved.status).toBeLessThan(300);
    } finally {
      await deleteWorkflowDefinitionIfExists(request, adminToken, definitionId);
      if (previousSettings) {
        await saveRecordLockSettings(request, superadminToken, previousSettings).catch(() => {});
      }
    }
  });
});
