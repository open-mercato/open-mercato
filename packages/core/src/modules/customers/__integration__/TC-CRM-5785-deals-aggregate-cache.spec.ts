import { expect, test, type APIRequestContext } from '@playwright/test'
import {
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { withClient } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'

type AggregateStage = {
  stageId: string
  count: number
  byCurrency: Array<{ currency: string; total: number; count: number }>
}

type AggregateResponse = {
  perStage?: AggregateStage[]
}

async function readAggregate(
  request: APIRequestContext,
  token: string,
  pipelineId: string,
  extraQuery = '',
): Promise<AggregateResponse> {
  const query = `pipelineId=${encodeURIComponent(pipelineId)}${extraQuery}`
  const response = await apiRequest(
    request,
    'GET',
    `/api/customers/deals/aggregate?${query}`,
    { token },
  )
  expect(response.status(), 'deals aggregate request should succeed').toBe(200)
  return (await readJsonSafe(response)) as AggregateResponse
}

function expectStageAggregate(
  response: AggregateResponse,
  stageId: string,
  expectedCount: number,
  expectedUsdTotal: number,
): void {
  const stage = (response.perStage ?? []).find((candidate) => candidate.stageId === stageId)
  expect(stage, 'aggregate should include the unique test stage').toBeTruthy()
  expect(stage?.count, 'stage deal count').toBe(expectedCount)
  const usd = (stage?.byCurrency ?? []).find((entry) => entry.currency === 'USD')
  expect(usd, 'stage aggregate should include USD totals').toBeTruthy()
  expect(usd?.count, 'USD deal count').toBe(expectedCount)
  expect(usd?.total, 'USD deal total').toBe(expectedUsdTotal)
}

test.describe('TC-CRM-5785: deals aggregate response cache', () => {
  test('hits the cache, bypasses dynamic filters, and invalidates after a supported deal write', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let pipelineId: string | null = null
    let stageId: string | null = null
    let firstDealId: string | null = null
    let secondDealId: string | null = null

    try {
      pipelineId = await createPipelineFixture(request, token, {
        name: `TC-CRM-5785 Pipeline ${stamp}`,
      })
      stageId = await createPipelineStageFixture(request, token, {
        pipelineId,
        label: `TC-CRM-5785 Stage ${stamp}`,
        order: 0,
      })
      firstDealId = await createDealFixture(request, token, {
        title: `TC-CRM-5785 First ${stamp}`,
        pipelineId,
        pipelineStageId: stageId,
        valueAmount: 100,
        valueCurrency: 'USD',
        status: 'open',
      })

      const warmed = await readAggregate(request, token, pipelineId)
      expectStageAggregate(warmed, stageId, 1, 100)

      await withClient(async (client) => {
        await client.query(
          'UPDATE customer_deals SET value_amount = $1 WHERE id = $2',
          [250, firstDealId],
        )
      })

      const cached = await readAggregate(request, token, pipelineId)
      expectStageAggregate(cached, stageId, 1, 100)

      const searchBypass = await readAggregate(request, token, pipelineId, '&search=')
      expectStageAggregate(searchBypass, stageId, 1, 250)

      const stuckBypass = await readAggregate(request, token, pipelineId, '&isStuck=false')
      expectStageAggregate(stuckBypass, stageId, 1, 250)

      secondDealId = await createDealFixture(request, token, {
        title: `TC-CRM-5785 Second ${stamp}`,
        pipelineId,
        pipelineStageId: stageId,
        valueAmount: 50,
        valueCurrency: 'USD',
        status: 'open',
      })

      const invalidated = await readAggregate(request, token, pipelineId)
      expectStageAggregate(invalidated, stageId, 2, 300)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/deals', secondDealId)
      await deleteEntityIfExists(request, token, '/api/customers/deals', firstDealId)
      await deleteEntityByBody(request, token, '/api/customers/pipeline-stages', stageId)
      await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId)
    }
  })
})
