import { expect, test } from '@playwright/test';
import {
  createCompanyFixture,
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api';

/**
 * TC-CRM-067: Deals list `isStuck` filter (SPEC-048 Phase 1c)
 *
 * Verifies that `GET /api/customers/deals?isStuck=true` honors the per-tenant
 * `stuck_threshold_days` setting:
 *   - With threshold=365 (way longer than the test's deal age), the fresh deal is not
 *     stuck → list returns zero rows.
 *   - The same deal is still present in the unfiltered listing → confirms the filter
 *     is what excludes the row, not a deeper RBAC/visibility issue.
 *   - `?isStuck=false` does not push any extra filter (legacy boolean handling).
 */
test.describe('TC-CRM-067: Deals isStuck filter', () => {
  test('returns zero stuck deals when threshold exceeds the deal age, and includes the deal in unfiltered listings', async ({ request }) => {
    const token = await getAuthToken(request);
    const companyName = `TC-CRM-067 Co ${Date.now()}`;
    const pipelineName = `TC-CRM-067 Pipeline ${Date.now()}`;
    const dealTitle = `TC-CRM-067 Deal ${Date.now()}`;

    let companyId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    let dealId: string | null = null;
    let savedThreshold: number | null = null;

    try {
      // Snapshot current threshold so the finally block restores tenant state.
      const before = await apiRequest(request, 'GET', '/api/customers/settings/stuck-threshold', { token });
      if (before.ok()) {
        const beforeBody = (await before.json()) as { stuckThresholdDays?: number };
        savedThreshold = typeof beforeBody.stuckThresholdDays === 'number' ? beforeBody.stuckThresholdDays : null;
      }

      // Set threshold to its maximum (365 days). The deal we are about to create will be
      // newly created → daysInCurrentStage = 0, which is < 365 → not stuck.
      const putResponse = await apiRequest(request, 'PUT', '/api/customers/settings/stuck-threshold', {
        token,
        data: { stuckThresholdDays: 365 },
      });
      expect(putResponse.ok(), `PUT /api/customers/settings/stuck-threshold failed: ${putResponse.status()}`).toBeTruthy();

      companyId = await createCompanyFixture(request, token, companyName);
      pipelineId = await createPipelineFixture(request, token, { name: pipelineName });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Open', order: 0 });
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: stageId,
      });

      const baseQuery = `pipelineId=${encodeURIComponent(pipelineId)}&pipelineStageId=${encodeURIComponent(stageId)}`;

      // Sanity check: deal is in the unfiltered list.
      const unfiltered = await apiRequest(request, 'GET', `/api/customers/deals?${baseQuery}`, { token });
      expect(unfiltered.ok()).toBeTruthy();
      const unfilteredBody = (await unfiltered.json()) as { items?: Array<Record<string, unknown>> };
      expect(
        (unfilteredBody.items ?? []).some((row) => row.id === dealId),
        'Deal must appear in the unfiltered list',
      ).toBe(true);

      // With threshold=365 and a brand-new deal, isStuck=true must return zero matches.
      const stuckResponse = await apiRequest(request, 'GET', `/api/customers/deals?${baseQuery}&isStuck=true`, { token });
      expect(stuckResponse.ok(), `GET ?isStuck=true failed: ${stuckResponse.status()}`).toBeTruthy();
      const stuckBody = (await stuckResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(
        (stuckBody.items ?? []).some((row) => row.id === dealId),
        'Fresh deal must not appear when threshold >> deal age',
      ).toBe(false);

      // isStuck=false MUST NOT silently drop the deal — the boolean-false branch is a no-op filter.
      const notStuckResponse = await apiRequest(request, 'GET', `/api/customers/deals?${baseQuery}&isStuck=false`, { token });
      expect(notStuckResponse.ok()).toBeTruthy();
      const notStuckBody = (await notStuckResponse.json()) as { items?: Array<Record<string, unknown>> };
      expect(
        (notStuckBody.items ?? []).some((row) => row.id === dealId),
        'Deal must appear when isStuck=false (no-op filter)',
      ).toBe(true);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
      if (savedThreshold !== null) {
        await apiRequest(request, 'PUT', '/api/customers/settings/stuck-threshold', {
          token,
          data: { stuckThresholdDays: savedThreshold },
        }).catch(() => {});
      }
    }
  });
});
