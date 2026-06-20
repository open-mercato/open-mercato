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
 * TC-CRM-066: Deals `_pipeline` response enricher (SPEC-048 Phase 1b)
 *
 * Verifies `/api/customers/deals` returns the `_pipeline` enrichment block with the
 * four derived fields (openActivitiesCount, daysInCurrentStage, isStuck, isOverdue) and
 * that the values reflect the persisted state (open vs overdue, fresh vs stuck).
 */
test.describe('TC-CRM-066: Deals _pipeline response enricher', () => {
  test('returns _pipeline block with correct defaults for a freshly created deal', async ({ request }) => {
    const token = await getAuthToken(request);
    const companyName = `TC-CRM-066 Co ${Date.now()}`;
    const pipelineName = `TC-CRM-066 Pipeline ${Date.now()}`;
    const dealTitle = `TC-CRM-066 Deal ${Date.now()}`;

    let companyId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    let dealId: string | null = null;

    try {
      companyId = await createCompanyFixture(request, token, companyName);
      pipelineId = await createPipelineFixture(request, token, { name: pipelineName });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Open', order: 0 });
      dealId = await createDealFixture(request, token, {
        title: dealTitle,
        companyIds: [companyId],
        pipelineId,
        pipelineStageId: stageId,
      });

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals?pipelineId=${encodeURIComponent(pipelineId)}&pipelineStageId=${encodeURIComponent(stageId)}`,
        { token },
      );
      expect(listResponse.ok(), `GET /api/customers/deals failed: ${listResponse.status()}`).toBeTruthy();
      const body = (await listResponse.json()) as { items?: Array<Record<string, unknown>> };
      const items = body.items ?? [];
      const found = items.find((row) => row.id === dealId);
      expect(found, 'Newly created deal should appear in the list').toBeTruthy();

      const pipelineBlock = found?._pipeline as Record<string, unknown> | undefined;
      expect(pipelineBlock, '_pipeline enricher block must be present on every deal').toBeTruthy();
      expect(typeof pipelineBlock?.openActivitiesCount, 'openActivitiesCount must be numeric').toBe('number');
      expect(typeof pipelineBlock?.daysInCurrentStage, 'daysInCurrentStage must be numeric').toBe('number');
      expect(typeof pipelineBlock?.isStuck, 'isStuck must be boolean').toBe('boolean');
      expect(typeof pipelineBlock?.isOverdue, 'isOverdue must be boolean').toBe('boolean');

      // Fresh deal: no open interactions, zero days in stage, not stuck, not overdue.
      expect(pipelineBlock?.openActivitiesCount).toBe(0);
      expect(pipelineBlock?.daysInCurrentStage).toBe(0);
      expect(pipelineBlock?.isStuck).toBe(false);
      expect(pipelineBlock?.isOverdue).toBe(false);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });

  test('marks an open deal with a past expected_close_at as isOverdue', async ({ request }) => {
    const token = await getAuthToken(request);
    const companyName = `TC-CRM-066 OD Co ${Date.now()}`;
    const pipelineName = `TC-CRM-066 OD Pipeline ${Date.now()}`;
    const dealTitle = `TC-CRM-066 OD Deal ${Date.now()}`;

    let companyId: string | null = null;
    let pipelineId: string | null = null;
    let stageId: string | null = null;
    let dealId: string | null = null;

    try {
      companyId = await createCompanyFixture(request, token, companyName);
      pipelineId = await createPipelineFixture(request, token, { name: pipelineName });
      stageId = await createPipelineStageFixture(request, token, { pipelineId, label: 'Open', order: 0 });

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const createResponse = await apiRequest(request, 'POST', '/api/customers/deals', {
        token,
        data: {
          title: dealTitle,
          companyIds: [companyId],
          pipelineId,
          pipelineStageId: stageId,
          expectedCloseAt: yesterday,
          status: 'open',
        },
      });
      expect(createResponse.ok(), `deal create failed: ${createResponse.status()}`).toBeTruthy();
      const createBody = (await createResponse.json()) as Record<string, unknown>;
      dealId = (createBody.dealId ?? createBody.id) as string;
      expect(dealId, 'Deal create must return an id').toBeTruthy();

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/deals?pipelineId=${encodeURIComponent(pipelineId)}&pipelineStageId=${encodeURIComponent(stageId)}`,
        { token },
      );
      const body = (await listResponse.json()) as { items?: Array<Record<string, unknown>> };
      const items = body.items ?? [];
      const found = items.find((row) => row.id === dealId);
      const pipelineBlock = found?._pipeline as Record<string, unknown> | undefined;
      expect(pipelineBlock?.isOverdue, 'isOverdue must flip true when status=open and expectedCloseAt is in the past').toBe(true);
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId);
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId);
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId);
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId);
    }
  });
});
