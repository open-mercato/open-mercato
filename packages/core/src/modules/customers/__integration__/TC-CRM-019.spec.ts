import { expect, test } from '@playwright/test';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createDealFixture, createPersonFixture, createPipelineFixture, createPipelineStageFixture, deleteEntityIfExists, deleteEntityByBody } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { expectOperation, undoOk } from '@open-mercato/core/helpers/integration/undoHarness';

/**
 * TC-CRM-019: Deal Association Remove And Undo
 */
test.describe('TC-CRM-019: Deal Association Remove And Undo', () => {
  test.setTimeout(120_000);

  test('should remove a linked person from deal and restore via undo', async ({ request }) => {
    test.slow();

    let token: string | null = null;
    let personId: string | null = null;
    let dealId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    const personDisplayName = `QA TC-CRM-019 Person ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `TCCRM019${Date.now()}`,
        displayName: personDisplayName,
      });
      pipelineId = await createPipelineFixture(request, token, { name: `QA TC-CRM-019 Pipeline ${Date.now()}` });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Open', order: 0 });
      dealId = await createDealFixture(request, token, {
        title: `QA TC-CRM-019 Deal ${Date.now()}`,
        personIds: [personId],
        pipelineId,
        pipelineStageId: stageId,
      });

      // Deal detail v3 decoupled the "Remove linked person" action from the deal header. Drive the
      // association change through the canonical PUT /api/customers/deals endpoint (which is what
      // the updated UI calls internally) and verify via the detail GET that undo restores the link.
      const putResp = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: { id: dealId, personIds: [] },
      });
      expect(putResp.status(), `PUT /api/customers/deals returned ${putResp.status()}`).toBeLessThan(400);
      const removeOp = expectOperation(putResp, 'customers.deals.remove-person');

      const afterRemoveResp = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}?include=people`, { token });
      const afterRemoveJson = (await afterRemoveResp.json()) as { linkedPersonIds?: string[] };
      expect(afterRemoveJson.linkedPersonIds ?? []).not.toContain(personId);

      await undoOk(request, token, removeOp.undoToken, 'undo customers.deals.remove-person');
      const afterUndoResp = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}?include=people`, { token });
      const afterUndoJson = (await afterUndoResp.json()) as { linkedPersonIds?: string[] };
      expect(afterUndoJson.linkedPersonIds ?? []).toContain(personId);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });
});
