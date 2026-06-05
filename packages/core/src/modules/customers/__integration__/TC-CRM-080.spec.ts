import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-080: Interaction cancellation and conflict detection.
 * Issue: https://github.com/open-mercato/open-mercato/issues/2458
 *
 * Verified-against-source deviations from the (auto-generated) issue surfaces:
 * - Conflict detection is `GET /api/customers/interactions/conflicts` with
 *   `date`/`startTime`/`duration`/`userId` query params (not a POST), returning
 *   `{ ok, result: { hasConflicts, conflicts } }`. It surfaces overlapping
 *   PLANNED interactions for the given owner/author.
 * - `POST /api/customers/interactions/cancel` `{ id }` → 200 `{ ok }`, sets
 *   status to `'canceled'` (US spelling), and is idempotent.
 * - There is no `GET /api/customers/interactions/[id]`; status is read via the
 *   list endpoint (`?entityId=`, `?status=planned`).
 */
test.describe('TC-CRM-080: Interaction cancellation and conflict detection', () => {
  test('detects scheduling conflicts and cancels an interaction idempotently', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    let token: string | null = null;
    let companyId: string | null = null;
    let interactionId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');
      const { userId } = getTokenScope(token);
      expect(userId.length > 0, 'admin token carries a user id').toBe(true);

      companyId = await createCompanyFixture(request, token, `TC-CRM-080 Co ${stamp}`);

      // A future UTC slot computed at runtime (no static date literal / time-bomb)
      // while keeping the conflict-window math deterministic within the run.
      const slot = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      slot.setUTCHours(10, 0, 0, 0);
      const scheduledAt = slot.toISOString();
      const scheduledDate = scheduledAt.slice(0, 10);
      const scheduledTime = scheduledAt.slice(11, 16);

      const createResp = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          interactionType: 'meeting',
          status: 'planned',
          scheduledAt,
          ownerUserId: userId,
          title: `TC-CRM-080 Planned ${stamp}`,
        },
      });
      expect(createResp.status(), 'interaction create returns 201').toBe(201);
      interactionId = (await readJsonSafe<{ id: string }>(createResp))?.id ?? null;
      expect((interactionId ?? '').length > 0, 'interaction create returns an id').toBe(true);

      // Conflict detection over the overlapping window for this owner.
      const conflictResp = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions/conflicts?date=${scheduledDate}&startTime=${scheduledTime}&duration=60&userId=${userId}`,
        { token },
      );
      expect(conflictResp.status(), 'conflicts GET returns 200').toBe(200);
      const conflictBody = await readJsonSafe<{ ok: boolean; result: { hasConflicts: boolean; conflicts: Array<{ id: string }> } }>(conflictResp);
      expect(conflictBody?.ok).toBe(true);
      expect(conflictBody?.result.hasConflicts).toBe(true);
      expect(conflictBody?.result.conflicts.some((conflict) => conflict.id === interactionId)).toBe(true);

      // Cancel the interaction.
      const cancel = await apiRequest(request, 'POST', '/api/customers/interactions/cancel', { token, data: { id: interactionId } });
      expect(cancel.status(), 'cancel returns 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(cancel))?.ok).toBe(true);

      // Status is now 'canceled' and the interaction leaves the planned list.
      const listAll = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}`, { token });
      const allItems = (await readJsonSafe<{ items: Array<{ id: string; status: string }> }>(listAll))?.items ?? [];
      expect(allItems.find((item) => item.id === interactionId)?.status).toBe('canceled');

      const listPlanned = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}&status=planned`, { token });
      const plannedIds = (await readJsonSafe<{ items: Array<{ id: string }> }>(listPlanned))?.items?.map((item) => item.id) ?? [];
      expect(plannedIds).not.toContain(interactionId);

      // Cancelling again is idempotent.
      const cancelAgain = await apiRequest(request, 'POST', '/api/customers/interactions/cancel', { token, data: { id: interactionId } });
      expect(cancelAgain.status(), 're-cancel is idempotent (200)').toBe(200);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
    }
  });
});
