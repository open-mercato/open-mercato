import { expect, test } from '@playwright/test';
import { createCompanyFixture, createDealFixture, createPipelineFixture, createPipelineStageFixture, deleteEntityIfExists, deleteEntityByBody } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
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

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`);

      // Select "Win" stage — scope to the CrudForm field wrapper to avoid
      // collisions with the status select which may also list "Win" entries.
      // Wait for enabled: the select is disabled until pipeline stages load.
      const pipelineStageSelect = page.locator('[data-crud-field-id="pipelineStageId"] select');
      await expect(pipelineStageSelect).toBeEnabled();
      await pipelineStageSelect.selectOption(winStageId!);
      const updateResponsePromise = page.waitForResponse((response) => {
        if (response.request().method() !== 'PUT') return false;
        let pathname = '';
        try {
          pathname = new URL(response.url()).pathname;
        } catch {
          return false;
        }
        return /^\/api\/customers\/deals(?:\/[^/]+)?$/i.test(pathname);
      });
      await page.getByRole('button', { name: /Update deal/i }).click();
      const updateResponse = await updateResponsePromise;
      expect(updateResponse.ok()).toBeTruthy();

      await page.goto('/backend/customers/deals/pipeline');
      await page.getByLabel('Pipeline').selectOption(pipelineId!);
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
