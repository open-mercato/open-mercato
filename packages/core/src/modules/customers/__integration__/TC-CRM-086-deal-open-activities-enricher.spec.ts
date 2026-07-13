import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  createDealFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-086: Deal open-activities enricher counts a non-terminal in_progress interaction.
 *
 * Spec: .ai/specs/2026-06-18-configurable-crm-interaction-statuses.md
 *   - The deals list enricher (`customers.deal-pipeline-state`) computes
 *     `_pipeline.openActivitiesCount` as interactions on the deal whose status is
 *     NOT terminal. After the open-set unification, an `in_progress` interaction
 *     must be counted (Phase 1 sourced the terminal set from the shared helper).
 */
async function fetchDealPipeline(
  request: APIRequestContext,
  token: string,
  dealId: string,
): Promise<{ openActivitiesCount?: number } | null> {
  const res = await apiRequest(request, 'GET', `/api/customers/deals?ids=${dealId}&pageSize=100`, { token })
  expect(res.ok(), `GET /api/customers/deals returned ${res.status()}`).toBeTruthy()
  const body = (await res.json().catch(() => null)) as
    | { items?: Array<{ id?: string; _pipeline?: { openActivitiesCount?: number } }> }
    | null
  const match = (body?.items ?? []).find((item) => item.id === dealId)
  return match?._pipeline ?? null
}

test.describe('TC-CRM-086: Deal open-activities enricher', () => {
  test('counts an in_progress interaction toward openActivitiesCount', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let companyId: string | null = null
    let dealId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()

    try {
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-086 Co ${stamp}`)
      dealId = await createDealFixture(request, token, {
        title: `QA TC-CRM-086 Deal ${stamp}`,
        companyIds: [companyId],
      })

      const baseline = await fetchDealPipeline(request, token, dealId)
      const baselineCount = baseline?.openActivitiesCount ?? 0

      const createRes = await apiRequest(request, 'POST', '/api/customers/interactions', {
        token,
        data: {
          entityId: companyId,
          dealId,
          interactionType: 'task',
          title: `QA TC-CRM-086 in_progress ${stamp}`,
          status: 'in_progress',
        },
      })
      expect(createRes.ok(), `POST interaction returned ${createRes.status()}`).toBeTruthy()
      interactionId = ((await createRes.json().catch(() => null)) as { id?: string } | null)?.id ?? null
      expect(interactionId, 'interaction create should expose an id').toBeTruthy()

      const enriched = await fetchDealPipeline(request, token, dealId)
      expect(enriched, 'deal response MUST carry the _pipeline enricher payload').toBeTruthy()
      expect(
        enriched?.openActivitiesCount ?? 0,
        'in_progress interaction MUST raise the open-activities count',
      ).toBe(baselineCount + 1)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/deals', dealId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
