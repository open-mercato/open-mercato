import { test, expect } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api';
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures';
import {
  createPipelineFixture,
  createPipelineStageFixture,
  createDealFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures';

/**
 * TC-CRM-075: Pipeline and stage CRUD via the settings API.
 * Issue: https://github.com/open-mercato/open-mercato/issues/2458
 *
 * Verified-against-source deviations from the (auto-generated) issue surfaces:
 * - There is no `GET /api/customers/pipelines/[id]` detail route. Stage ordering
 *   is read via `GET /api/customers/pipeline-stages?pipelineId=` (ordered by `order`).
 * - There is no `PUT|DELETE /api/customers/pipeline-stages/[id]` subroute. Stage
 *   update/delete go to the collection route with the id in the BODY.
 * - POST pipeline / stage return 201 `{ id }`; reorder takes `{ stages: [{ id, order }] }`.
 * - Deleting a stage that still has active deals returns 409.
 */
test.describe('TC-CRM-075: Pipeline and stage CRUD via settings API', () => {
  test('creates a pipeline, manages stages, and guards stage-with-deals deletion', async ({ request }) => {
    test.slow();

    const stamp = Date.now();
    let token: string | null = null;
    let pipelineId: string | null = null;
    const stageIds: string[] = [];
    let dealId: string | null = null;

    try {
      token = await getAuthToken(request, 'admin');

      // 1. Create a pipeline.
      pipelineId = await createPipelineFixture(request, token, { name: `TC-CRM-075 Renewals ${stamp}` });

      // 2. Create 3 stages.
      const qualificationId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Qualification', order: 0 });
      const proposalId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Proposal', order: 1 });
      const closedWonId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Closed Won', order: 2 });
      stageIds.push(qualificationId, proposalId, closedWonId);

      // 3. Reorder so 'Closed Won' is first.
      const reorder = await apiRequest(request, 'POST', '/api/customers/pipeline-stages/reorder', {
        token,
        data: {
          stages: [
            { id: closedWonId, order: 0 },
            { id: qualificationId, order: 1 },
            { id: proposalId, order: 2 },
          ],
        },
      });
      expect(reorder.status(), 'reorder returns 200').toBe(200);
      expect((await readJsonSafe<{ ok?: boolean }>(reorder))?.ok).toBe(true);

      // 4. Verify the new order via the stages list.
      const afterReorder = await apiRequest(request, 'GET', `/api/customers/pipeline-stages?pipelineId=${pipelineId}`, { token });
      expect(afterReorder.status()).toBe(200);
      const reorderedItems = (await readJsonSafe<{ items: Array<{ id: string; label: string; order: number }> }>(afterReorder))?.items ?? [];
      expect(reorderedItems.map((stage) => stage.id)).toEqual([closedWonId, qualificationId, proposalId]);
      expect(reorderedItems[0]?.label).toBe('Closed Won');

      // 5. Update a stage label (collection route, id in body).
      const update = await apiRequest(request, 'PUT', '/api/customers/pipeline-stages', {
        token,
        data: { id: qualificationId, label: 'Qualification (Updated)' },
      });
      expect(update.status(), 'stage update returns 200').toBe(200);
      const afterUpdate = await apiRequest(request, 'GET', `/api/customers/pipeline-stages?pipelineId=${pipelineId}`, { token });
      const updatedStage = (await readJsonSafe<{ items: Array<{ id: string; label: string }> }>(afterUpdate))?.items?.find((stage) => stage.id === qualificationId);
      expect(updatedStage?.label).toBe('Qualification (Updated)');

      // 6. Delete a stage (collection route, id in body) and confirm removal.
      const del = await apiRequest(request, 'DELETE', '/api/customers/pipeline-stages', { token, data: { id: proposalId } });
      expect(del.status(), 'stage delete returns 200').toBe(200);
      stageIds.splice(stageIds.indexOf(proposalId), 1);
      const afterDelete = await apiRequest(request, 'GET', `/api/customers/pipeline-stages?pipelineId=${pipelineId}`, { token });
      const remainingIds = (await readJsonSafe<{ items: Array<{ id: string }> }>(afterDelete))?.items?.map((stage) => stage.id) ?? [];
      expect(remainingIds).not.toContain(proposalId);
      expect(remainingIds).toEqual(expect.arrayContaining([qualificationId, closedWonId]));

      // 7. The pipeline is listed.
      const pipelines = await apiRequest(request, 'GET', '/api/customers/pipelines', { token });
      const pipelineIds = (await readJsonSafe<{ items: Array<{ id: string }> }>(pipelines))?.items?.map((pipeline) => pipeline.id) ?? [];
      expect(pipelineIds).toContain(pipelineId);

      // 8. Deleting a stage that still has active deals is blocked with 409.
      dealId = await createDealFixture(request, token, { title: `TC-CRM-075 Deal ${stamp}`, pipelineId, pipelineStageId: qualificationId });
      const blocked = await apiRequest(request, 'DELETE', '/api/customers/pipeline-stages', { token, data: { id: qualificationId } });
      expect(blocked.status(), 'deleting a stage with active deals returns 409').toBe(409);
    } finally {
      // Delete the deal first so the remaining stages are no longer referenced by active deals.
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      for (const stageId of stageIds) {
        await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      }
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });
});
