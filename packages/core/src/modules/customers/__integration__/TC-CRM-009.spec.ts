import { expect, test } from '@playwright/test';
import { createCompanyFixture, createDealFixture, createPipelineFixture, createPipelineStageFixture, deleteEntityIfExists, deleteEntityByBody } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-009: Update Deal Pipeline Stage
 * Source: .ai/qa/scenarios/TC-CRM-009-deal-pipeline-update.md
 */
test.describe('TC-CRM-009: Update Deal Pipeline Stage', () => {
  test('should update a deal pipeline stage to Win and reflect it in the pipeline board', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;
    let pipelineId: string | null = null;
    let openStageId: string | null = null;
    let winStageId: string | null = null;

    const companyName = `QA TC-CRM-009 Co ${Date.now()}`;
    const dealTitle = `QA TC-CRM-009 Deal ${Date.now()}`;
    const pipelineName = `QA TC-CRM-009 Pipeline ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      pipelineId = await createPipelineFixture(request, token, { name: pipelineName });
      openStageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Open', order: 0 });
      winStageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Win', order: 1 });
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: openStageId,
      });

      // Move the deal to the "Win" stage via API — the deal detail v3 UI no longer exposes
      // a pipelineStageId select outside the (collapsed-by-default) form panel, and the
      // stepper/closure buttons drive closure state instead of stage advancement. Exercising
      // the change through the public API keeps the test focused on "deal moves to Win stage
      // and pipeline board reflects it".
      const updateResponse = await apiRequest(request, 'PUT', '/api/customers/deals', {
        token,
        data: { id: dealId, pipelineId, pipelineStageId: winStageId },
      });
      expect(updateResponse.status(), `PUT /api/customers/deals returned ${updateResponse.status()}`).toBeLessThan(400);

      await login(page, 'admin');
      await page.goto('/backend/customers/deals/pipeline');
      // Pipeline picker is a Radix Select inside <label>Pipeline ...</label>.
      // The page also has a "Sort by" Select — scope by the wrapping label so
      // .first() doesn't accidentally pick Sort while the pipelines query loads.
      const pipelineCombobox = page
        .locator('label')
        .filter({ has: page.getByText('Pipeline', { exact: true }) })
        .getByRole('combobox');
      await expect(pipelineCombobox).toBeVisible({ timeout: 10_000 });
      await pipelineCombobox.click();
      await page.getByRole('option', { name: pipelineName, exact: true }).click();
      const winLane = page.locator('main').locator('div').filter({ has: page.getByText(/^Win$/) }).first();
      await expect(winLane).toContainText(dealTitle);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', winStageId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', openStageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });
});
