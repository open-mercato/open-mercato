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
      // SPEC-048 kanban redesign: the pipeline selector is now a chip+popover, not a
      // <label>Pipeline<Select/></label>. The chip button is rendered with
      // aria-label="Pipeline: <value>" (PipelineFilterPopover → ChipButton); selecting a
      // pipeline is a two-step interaction (open chip → click radio row → click Apply).
      const pipelineChip = page.getByRole('button', { name: /^Pipeline:/ });
      await expect(pipelineChip).toBeVisible({ timeout: 10_000 });
      await pipelineChip.click();
      // Inside the popover dialog, each pipeline row is a `<button role="radio">` —
      // the `role` override means Playwright's accessibility tree exposes them as radios,
      // NOT buttons. Use `getByRole('radio', ...)` so the test matches the actual ARIA role
      // (see PipelineFilterPopover.tsx). The Apply button keeps its native button role.
      const pipelinePopover = page.getByRole('dialog').last();
      await pipelinePopover.getByRole('radio', { name: pipelineName, exact: true }).click();
      await pipelinePopover.getByRole('button', { name: 'Apply', exact: true }).click();
      // After filtering to the test pipeline, the deal (already moved to Win via API) should
      // render inside the Win lane. Lane wrapper is an unlabelled flex container — we locate
      // it as the outermost <div> containing both the stage label and the deal title.
      const winLane = page
        .locator('main div')
        .filter({ has: page.getByText(/^Win$/) })
        .filter({ has: page.getByText(dealTitle, { exact: true }) })
        .first();
      await expect(winLane).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', winStageId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', openStageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });
});
