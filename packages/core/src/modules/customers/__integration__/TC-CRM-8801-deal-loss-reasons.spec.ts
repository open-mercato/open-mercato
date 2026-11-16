import { test, expect, type APIRequestContext } from '@playwright/test';
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import {
  createCompanyFixture,
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';

export const integrationMeta = { dependsOnModules: ['customers'] };

type OwnedFixture = { resource: string; id: string | null; path: string; idIn: 'query' | 'body' };

async function deleteOwnedFixtures(
  request: APIRequestContext,
  token: string | null,
  fixtures: OwnedFixture[],
): Promise<string[]> {
  const failures: string[] = [];
  if (!token) return failures;
  for (const fixture of fixtures) {
    if (!fixture.id) continue;
    try {
      const response = fixture.idIn === 'query'
        ? await apiRequest(request, 'DELETE', `${fixture.path}?id=${encodeURIComponent(fixture.id)}`, { token })
        : await apiRequest(request, 'DELETE', fixture.path, { token, data: { id: fixture.id } });
      if (response.status() !== 200 && response.status() !== 404) {
        failures.push(`${fixture.resource} ${fixture.id}: HTTP ${response.status()}`);
      }
    } catch (error) {
      failures.push(`${fixture.resource} ${fixture.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

/**
 * TC-CRM-8801: a deal can be marked lost with a reason when only CRM modules are enabled.
 * Issue: #8801. Spec: .ai/specs/2026-11-05-issue-8784-module-dependency-integrity.md (resolution E1).
 *
 * `customers` seeds the `sales.deal_loss_reason` dictionary itself, so this spec declares no
 * dependency on `sales` and must pass in an app without it (for example the `crm` preset).
 */
test.describe('TC-CRM-8801: Mark a deal as lost with a loss reason', () => {
  test('lists the seeded loss reasons and closes the deal as lost with the chosen reason', async ({
    page,
    request,
  }, testInfo) => {
    test.slow();

    let token: string | null = null;
    let companyId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    let dealId: string | null = null;
    const stamp = Date.now();
    const dealTitle = `QA TC-CRM-8801 Deal ${stamp}`;
    let testFailed = true;

    try {
      token = await getAuthToken(request);
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-8801 Co ${stamp}`);
      pipelineId = await createPipelineFixture(request, token, { name: `QA TC-CRM-8801 Pipeline ${stamp}` });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Qualification', order: 0 });
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: stageId,
      });

      await login(page, 'admin');
      await page.goto(`/backend/customers/deals/${dealId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: dealTitle, exact: true })).toBeVisible({ timeout: 15000 });

      await page.getByRole('button', { name: 'Lost', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Mark deal as Lost?')).toBeVisible();
      await expect(dialog.getByText('Choose the closest reason from the dictionary.')).toBeVisible({ timeout: 10000 });

      await dialog.getByRole('button', { name: /Select loss reason/ }).click();
      await dialog.getByRole('button', { name: /No budget/ }).click();

      const confirmButton = dialog.getByRole('button', { name: 'Mark as Lost', exact: true });
      await expect(confirmButton).toBeEnabled();
      await confirmButton.click();
      await expect(dialog.getByText('Mark deal as Lost?')).toBeHidden({ timeout: 15000 });

      const detailResponse = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token });
      expect(detailResponse.ok(), `GET deal ${dealId}: ${detailResponse.status()}`).toBeTruthy();
      const detail = (await readJsonSafe(detailResponse)) as {
        deal?: { closureOutcome?: string | null; lossReasonId?: string | null };
      } | null;
      expect(detail?.deal?.closureOutcome).toBe('lost');
      expect(detail?.deal?.lossReasonId).toEqual(expect.any(String));
      testFailed = false;
    } finally {
      const cleanupFailures = await deleteOwnedFixtures(request, token, [
        { resource: 'deal', id: dealId, path: '/api/customers/deals', idIn: 'query' },
        { resource: 'pipeline stage', id: stageId, path: '/api/customers/pipeline-stages', idIn: 'body' },
        { resource: 'pipeline', id: pipelineId, path: '/api/customers/pipelines', idIn: 'body' },
        { resource: 'company', id: companyId, path: '/api/customers/companies', idIn: 'query' },
      ]);
      if (cleanupFailures.length > 0) {
        testInfo.annotations.push({ type: 'cleanup-failures', description: cleanupFailures.join('; ') });
        if (!testFailed) throw new Error(`Fixture cleanup failed: ${cleanupFailures.join('; ')}`);
      }
    }
  });
});
