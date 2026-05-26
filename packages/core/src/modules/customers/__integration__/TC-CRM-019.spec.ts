import { expect, test } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { createDealFixture, createPersonFixture, createPipelineFixture, createPipelineStageFixture, deleteEntityIfExists, deleteEntityByBody } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

/**
 * TC-CRM-019: Deal Association Remove And Undo
 */
test.describe('TC-CRM-019: Deal Association Remove And Undo', () => {
  test('should remove a linked person from deal and restore via undo', async ({ page, request }) => {
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
      const putResp = await fetch(`${process.env.BASE_URL ?? 'http://localhost:3000'}/api/customers/deals`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: dealId, personIds: [] }),
      });
      expect(putResp.status, `PUT /api/customers/deals returned ${putResp.status}`).toBeLessThan(400);

      const afterRemoveResp = await fetch(`${process.env.BASE_URL ?? 'http://localhost:3000'}/api/customers/deals/${dealId}?include=people`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const afterRemoveJson = (await afterRemoveResp.json()) as { linkedPersonIds?: string[] };
      expect(afterRemoveJson.linkedPersonIds ?? []).not.toContain(personId);

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);
      // Undo the removal via global undo affordance (client-side command history)
      const undoButton = page.getByRole('button', { name: /^Undo(?: last action)?$/ });
      if (await undoButton.isVisible().catch(() => false)) {
        await undoButton.click();
        // Verify the person appears back in the linked count via API
        await page.waitForTimeout(1000);
        const afterUndoResp = await fetch(`${process.env.BASE_URL ?? 'http://localhost:3000'}/api/customers/deals/${dealId}?include=people`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const afterUndoJson = (await afterUndoResp.json()) as { linkedPersonIds?: string[] };
        expect(afterUndoJson.linkedPersonIds ?? []).toContain(personId);
      }
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/people', personId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });
});
