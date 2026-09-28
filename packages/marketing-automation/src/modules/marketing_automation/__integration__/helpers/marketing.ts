import type { APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const CAMPAIGNS_PATH = '/api/marketing_automation/campaigns'
export const PALETTE_PATH = '/api/marketing_automation/palette'

export type CampaignGraph = {
  updatedAt: string
  name: string
  description?: string | null
  triggers: Array<Record<string, unknown>>
  definition: Record<string, unknown>
}

export type CampaignDetail = {
  id: string
  name: string
  isEnabled: boolean
  updatedAt: string
  triggers: Array<Record<string, unknown>>
  definition: {
    version: number
    audience: unknown
    steps: Array<{ id: string; type: string; params: Record<string, unknown> }>
    canvas?: { nodePositions?: Record<string, { x: number; y: number }> }
  }
}

export async function createCampaign(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', CAMPAIGNS_PATH, { token, data: { name } })
  if (!response.ok()) throw new Error(`campaign create failed: ${response.status()}`)
  const body = await readJsonSafe<{ id?: string }>(response)
  if (!body?.id) throw new Error('campaign create returned no id')
  return body.id
}

export async function getCampaign(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CampaignDetail> {
  const response = await apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${id}`, { token })
  if (!response.ok()) throw new Error(`campaign read failed: ${response.status()}`)
  const body = await readJsonSafe<CampaignDetail>(response)
  if (!body) throw new Error('campaign read returned no body')
  return body
}

export async function saveGraph(
  request: APIRequestContext,
  token: string,
  id: string,
  graph: CampaignGraph,
) {
  return apiRequest(request, 'PUT', `${CAMPAIGNS_PATH}/${id}/save-graph`, { token, data: graph })
}

export async function deleteCampaignIfExists(
  request: APIRequestContext,
  token: string,
  id: string | null,
): Promise<void> {
  if (!id) return
  await apiRequest(request, 'DELETE', `${CAMPAIGNS_PATH}/${id}`, { token }).catch(() => undefined)
}

/** A minimal runnable graph: one trigger, no audience, one sending step. */
export function minimalGraph(updatedAt: string, name: string): CampaignGraph {
  return {
    updatedAt,
    name,
    triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
    definition: {
      version: 1,
      audience: null,
      steps: [
        { id: 'step-email', type: 'send_email', params: { subject: 'QA', bodyHtml: '<p>QA</p>' } },
      ],
    },
  }
}

/** Taking a campaign live is a separate endpoint behind `campaigns.publish`. */
export async function setEnabled(
  request: APIRequestContext,
  token: string,
  id: string,
  input: { updatedAt: string; isEnabled: boolean },
) {
  return apiRequest(request, 'PUT', `${CAMPAIGNS_PATH}/${id}/enabled`, { token, data: input })
}

/** Dry run — reports what would happen and sends nothing. */
export async function testDispatch(
  request: APIRequestContext,
  token: string,
  id: string,
  input: { subjectEntityId: string; trigger?: Record<string, unknown> },
) {
  return apiRequest(request, 'POST', `${CAMPAIGNS_PATH}/${id}/test-dispatch`, { token, data: input })
}

export async function listRuns(
  request: APIRequestContext,
  token: string,
  id: string,
  status?: string,
) {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  return apiRequest(request, 'GET', `${CAMPAIGNS_PATH}/${id}/runs${query}`, { token })
}
