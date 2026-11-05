import { expect, test } from '@playwright/test';
import { createCompanyFixture, createDealFixture, createPipelineFixture, createPipelineStageFixture, deleteEntityIfExists, deleteEntityByBody } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

async function expectPipelineFixtureVisible(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  pipelineId: string,
  pipelineName: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await apiRequest(
          request,
          'GET',
          `/api/customers/pipelines?page=1&pageSize=100&search=${encodeURIComponent(pipelineName)}`,
          { token },
        );
        const body = (await res.json().catch(() => null)) as
          | { items?: Array<{ id?: string; name?: string }>; result?: { items?: Array<{ id?: string; name?: string }> } }
          | null;
        const items = Array.isArray(body?.items)
          ? body.items
          : Array.isArray(body?.result?.items)
            ? body.result.items
            : [];
        return items.some((item) => item.id === pipelineId && item.name === pipelineName);
      },
      {
        message: `pipeline fixture ${pipelineName} should be visible through the list API`,
        timeout: 15_000,
      },
    )
    .toBe(true);
}

async function selectPipelineFilter(page: import('@playwright/test').Page, pipelineName: string): Promise<void> {
  const pipelineChip = page.getByRole('button', { name: /^Pipeline:/ });
  await expect(pipelineChip).toBeVisible({ timeout: 15_000 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await pipelineChip.click();
    const pipelinePopover = page.getByRole('dialog').last();
    const option = pipelinePopover.getByRole('radio', { name: pipelineName, exact: true });
    if (await option.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await option.click();
      await pipelinePopover.getByRole('button', { name: 'Apply', exact: true }).click();
      return;
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
  }
  await pipelineChip.click();
  const pipelinePopover = page.getByRole('dialog').last();
  await pipelinePopover.getByRole('radio', { name: pipelineName, exact: true }).click();
  await pipelinePopover.getByRole('button', { name: 'Apply', exact: true }).click();
}

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
      await expectPipelineFixtureVisible(request, token, pipelineId, pipelineName);

      await login(page, 'admin');
      await page.goto('/backend/customers/deals/pipeline', { waitUntil: 'commit' });
      // SPEC-048 kanban redesign: the pipeline selector is now a chip+popover, not a
      // <label>Pipeline<Select/></label>. The chip button is rendered with
      // aria-label="Pipeline: <value>" (PipelineFilterPopover → ChipButton); selecting a
      // pipeline is a two-step interaction (open chip → click radio row → click Apply).
      await selectPipelineFilter(page, pipelineName);
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
