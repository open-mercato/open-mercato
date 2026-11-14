import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createDealFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-STAGE-PROB-001: pipeline stage default probabilities
 * (spec: .ai/specs/2026-10-22-pipeline-stage-default-probabilities.md).
 *
 * A pipeline opted into `stageProbabilitiesEnabled` sets a deal's probability to the
 * target stage's `defaultProbability` whenever the deal enters a stage and the request
 * does not carry an explicit probability (the Kanban / stepper payload). An explicit
 * value always wins and a save without a stage change never resets an override.
 */
const PIPELINES = '/api/customers/pipelines'
const STAGES = '/api/customers/pipeline-stages'
const DEALS = '/api/customers/deals'

async function getDealProbability(request: APIRequestContext, token: string, id: string): Promise<number | null> {
  const res = await apiRequest(request, 'GET', `${DEALS}/${id}`, { token })
  const body = (await readJsonSafe(res)) as Record<string, unknown> | null
  expect(res.ok(), `GET deal ${id} failed: ${res.status()} ${JSON.stringify(body)}`).toBeTruthy()
  const deal = (body?.deal ?? body) as Record<string, unknown>
  const value = deal.probability
  return typeof value === 'number' ? value : value == null ? null : Number(value)
}

async function updateDeal(request: APIRequestContext, token: string, data: Record<string, unknown>) {
  const res = await apiRequest(request, 'PUT', DEALS, { token, data })
  expect(res.ok(), `PUT deal failed: ${res.status()} ${JSON.stringify(await readJsonSafe(res))}`).toBeTruthy()
}

async function setStageDefault(request: APIRequestContext, token: string, id: string, defaultProbability: number | null) {
  const res = await apiRequest(request, 'PUT', STAGES, { token, data: { id, defaultProbability } })
  expect(res.ok(), `PUT stage failed: ${res.status()} ${JSON.stringify(await readJsonSafe(res))}`).toBeTruthy()
}

async function setPipelineFlag(request: APIRequestContext, token: string, id: string, enabled: boolean) {
  const res = await apiRequest(request, 'PUT', PIPELINES, { token, data: { id, stageProbabilitiesEnabled: enabled } })
  expect(res.ok(), `PUT pipeline failed: ${res.status()} ${JSON.stringify(await readJsonSafe(res))}`).toBeTruthy()
}

test.describe('TC-CRM-STAGE-PROB-001: pipeline stage default probabilities', () => {
  test('stage moves apply the default, explicit values and overrides are preserved', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let pipelineId: string | null = null
    let stageAId: string | null = null
    let stageBId: string | null = null
    let dealId: string | null = null

    try {
      pipelineId = await createPipelineFixture(request, token, { name: `TC-STAGE-PROB ${stamp}` })
      stageAId = await createPipelineStageFixture(request, token, { pipelineId, label: `Qualify ${stamp}`, order: 0 })
      stageBId = await createPipelineStageFixture(request, token, { pipelineId, label: `Negotiate ${stamp}`, order: 1 })
      await setPipelineFlag(request, token, pipelineId, true)
      await setStageDefault(request, token, stageAId, 20)
      await setStageDefault(request, token, stageBId, 60)

      const pipelinesRes = await apiRequest(request, 'GET', PIPELINES, { token })
      const pipelines = (await readJsonSafe(pipelinesRes)) as { items?: Array<Record<string, unknown>> }
      expect(pipelines.items?.find((item) => item.id === pipelineId)?.stageProbabilitiesEnabled).toBe(true)

      const stagesRes = await apiRequest(request, 'GET', `${STAGES}?pipelineId=${encodeURIComponent(pipelineId)}`, { token })
      const stages = (await readJsonSafe(stagesRes)) as { items?: Array<Record<string, unknown>> }
      expect(stages.items?.find((item) => item.id === stageAId)?.defaultProbability).toBe(20)
      expect(stages.items?.find((item) => item.id === stageBId)?.defaultProbability).toBe(60)

      dealId = await createDealFixture(request, token, { title: `Stage prob deal ${stamp}`, pipelineId, pipelineStageId: stageAId })
      expect(await getDealProbability(request, token, dealId)).toBe(20)

      await updateDeal(request, token, { id: dealId, pipelineStageId: stageBId })
      expect(await getDealProbability(request, token, dealId)).toBe(60)

      await updateDeal(request, token, { id: dealId, probability: 33 })
      expect(await getDealProbability(request, token, dealId)).toBe(33)

      await updateDeal(request, token, { id: dealId, pipelineStageId: stageAId, probability: 45 })
      expect(await getDealProbability(request, token, dealId)).toBe(45)

      await setPipelineFlag(request, token, pipelineId, false)
      await updateDeal(request, token, { id: dealId, pipelineStageId: stageBId })
      expect(await getDealProbability(request, token, dealId)).toBe(45)
    } finally {
      await deleteEntityIfExists(request, token, DEALS, dealId)
      await deleteEntityByBody(request, token, STAGES, stageAId)
      await deleteEntityByBody(request, token, STAGES, stageBId)
      await deleteEntityByBody(request, token, PIPELINES, pipelineId)
    }
  })
})
