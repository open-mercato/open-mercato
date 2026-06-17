import { expect, test } from '@playwright/test';
import { createCompanyFixture, createDealFixture, createPipelineFixture, createPipelineStageFixture, deleteEntityIfExists, deleteEntityByBody } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';

/**
 * TC-CRM-013: Pipeline View Navigation
 * Source: .ai/qa/scenarios/TC-CRM-013-pipeline-view-navigation.md
 */
test.describe('TC-CRM-013: Pipeline View Navigation', () => {
  test('should display pipeline columns, show deal card info, open detail, and return to list view', async ({ page, request }) => {
    let token: string | null = null;
    let companyId: string | null = null;
    let dealId: string | null = null;
    let pipelineId: string | null = null;
    let opportunityStageId: string | null = null;
    let winStageId: string | null = null;

    const companyName = `QA TC-CRM-013 Co ${Date.now()}`;
    const dealTitle = `QA TC-CRM-013 Deal ${Date.now()}`;
    const pipelineName = `QA TC-CRM-013 Pipeline ${Date.now()}`;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, companyName);
      pipelineId = await createPipelineFixture(request, token, { name: pipelineName });
      opportunityStageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Opportunity', order: 0 });
      winStageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Win', order: 1 });
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: opportunityStageId,
        valueAmount: 5000,
        valueCurrency: 'USD',
      });

      await login(page, 'admin');
      await page.goto('/backend/customers/deals/pipeline');
      // SPEC-048 renamed the page heading from "Sales Pipeline" to "Deals"
      // (customers.deals.kanban.pageTitle); the breadcrumb still says "Deals" too.
      await expect(page.getByRole('heading', { name: 'Deals', level: 1 })).toBeVisible();

      // SPEC-048 kanban redesign: pipeline selector is a chip+popover. See TC-CRM-009 for
      // the matching interaction. The chip's accessible name follows the pattern
      // "Pipeline: <value>" (PipelineFilterPopover → ChipButton).
      const pipelineChip = page.getByRole('button', { name: /^Pipeline:/ });
      await expect(pipelineChip).toBeVisible({ timeout: 10_000 });
      await pipelineChip.click();
      // Pipeline rows are `<Button role="radio">` (PipelineFilterPopover.tsx). Use radio
      // role, not button — Playwright reads the explicit `role` attribute over the native one.
      const pipelinePopover = page.getByRole('dialog').last();
      await pipelinePopover.getByRole('radio', { name: pipelineName, exact: true }).click();
      await pipelinePopover.getByRole('button', { name: 'Apply', exact: true }).click();

      await expect(page.getByText('Opportunity', { exact: true })).toBeVisible();
      await expect(page.getByText('Win', { exact: true })).toBeVisible();

      // SPEC-049 (UX review item 1) removed `role="article"` from DealCard so dnd-kit's
      // own `role="button"` can win and the card stays operable via keyboard. The card
      // now identifies itself via `aria-label="Deal: {title}"` + `aria-roledescription`.
      // Locate it by aria-label so the test doesn't depend on the (variable) role.
      const dealCard = page.locator(`[aria-label="Deal: ${dealTitle}"]`);
      await expect(dealCard).toBeVisible();
      // SPEC-048: DealCard.tsx renders value as decimal-formatted amount + separate
      // currency-code span (e.g. "5,000  USD") — no '$' glyph appears on the kanban card.
      // Scope to the deal card so we don't accidentally match a currency code elsewhere
      // on the page (e.g. lane-total breakdown).
      await expect(dealCard.getByText('USD', { exact: true })).toBeVisible();

      // Open the card's kebab menu and choose "Open deal". The menu items are
      // rendered via React portal, so the menuitem lookup is page-scoped, not card-scoped.
      await dealCard.getByRole('button', { name: 'Deal actions' }).click();
      await page.getByRole('menuitem', { name: 'Open deal', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/backend/customers/deals/${dealId}$`));
      await expect(page.getByText(dealTitle, { exact: true }).first()).toBeVisible();

      await page.goto('/backend/customers/deals');
      await expect(page.getByRole('heading', { name: 'Deals' })).toBeVisible();
      await page.getByPlaceholder(/Search by title/i).fill(dealTitle);
      const dealRow = page.locator('tr').filter({ hasText: dealTitle }).first();
      await expect(dealRow).toBeVisible();
      await expect(dealRow).toContainText('Opportunity');
      await expect.poll(async () => (await dealRow.textContent()) ?? '').toContain(pipelineName);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', winStageId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', opportunityStageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });

  test('keeps aggregate counts, paginated list totals, and Show more aligned', async ({ page, request }) => {
    test.slow();

    let token: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    let laterStageId: string | null = null;
    const dealIds: string[] = [];

    const timestamp = Date.now();
    const pipelineName = `QA TC-CRM-013 Pagination Pipeline ${timestamp}`;
    const stageName = 'Qualified';
    const laterStageName = 'Review';
    const titlePrefix = `QA TC-CRM-013 Page Deal ${timestamp}`;

    try {
      token = await getAuthToken(request);
      pipelineId = await createPipelineFixture(request, token, { name: pipelineName });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: stageName, order: 0 });
      laterStageId = await createPipelineStageFixture(request, token, { pipelineId, label: laterStageName, order: 1 });

      for (let index = 1; index <= 27; index += 1) {
        const dealId = await createDealFixture(request, token, {
          title: `${titlePrefix} ${String(index).padStart(2, '0')}`,
          pipelineId: pipelineId!,
          pipelineStageId: stageId!,
          valueAmount: 1000 + index,
          valueCurrency: 'USD',
        });
        dealIds.push(dealId);
      }

      const aggregateResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals/aggregate?pipelineId=${encodeURIComponent(pipelineId!)}`,
        { token },
      );
      expect(aggregateResponse.ok(), `GET aggregate failed: ${aggregateResponse.status()}`).toBeTruthy();
      const aggregateBody = (await aggregateResponse.json()) as {
        perStage?: Array<{ stageId?: string; count?: number }>;
      };
      const aggregateStage = (aggregateBody.perStage ?? []).find((row) => row.stageId === stageId);
      expect(aggregateStage?.count).toBe(27);

      const pageOneResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals?pipelineId=${encodeURIComponent(pipelineId!)}&pipelineStageId=${encodeURIComponent(stageId!)}&page=1&pageSize=25&sortField=updatedAt&sortDir=desc`,
        { token },
      );
      expect(pageOneResponse.ok(), `GET deals page 1 failed: ${pageOneResponse.status()}`).toBeTruthy();
      const pageOneBody = (await pageOneResponse.json()) as { items?: Array<Record<string, unknown>>; total?: number };
      expect(pageOneBody.items ?? []).toHaveLength(25);
      expect(pageOneBody.total).toBe(27);

      const pageTwoResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals?pipelineId=${encodeURIComponent(pipelineId!)}&pipelineStageId=${encodeURIComponent(stageId!)}&page=2&pageSize=25&sortField=updatedAt&sortDir=desc`,
        { token },
      );
      expect(pageTwoResponse.ok(), `GET deals page 2 failed: ${pageTwoResponse.status()}`).toBeTruthy();
      const pageTwoBody = (await pageTwoResponse.json()) as { items?: Array<Record<string, unknown>>; total?: number };
      expect(pageTwoBody.items ?? []).toHaveLength(2);
      expect(pageTwoBody.total).toBe(27);

      await login(page, 'admin');
      await page.goto('/backend/customers/deals/pipeline');
      const pipelineChip = page.getByRole('button', { name: /^Pipeline:/ });
      await expect(pipelineChip).toBeVisible({ timeout: 10_000 });
      await pipelineChip.click();
      const pipelinePopover = page.getByRole('dialog').last();
      await pipelinePopover.getByRole('radio', { name: pipelineName, exact: true }).click();
      await pipelinePopover.getByRole('button', { name: 'Apply', exact: true }).click();

      await expect(page.getByText(stageName, { exact: true })).toBeVisible();
      await expect(page.locator(`[aria-label="Deal: ${titlePrefix} 27"]`)).toBeVisible();
      await expect(page.locator(`[aria-label="Deal: ${titlePrefix} 01"]`)).not.toBeVisible();

      await page.getByRole('button', { name: new RegExp(`Load more deals in ${stageName}`) }).click();
      await expect(page.locator(`[aria-label="Deal: ${titlePrefix} 01"]`)).toBeVisible();
    } finally {
      for (const dealId of dealIds) {
        await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      }
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', laterStageId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });
});
