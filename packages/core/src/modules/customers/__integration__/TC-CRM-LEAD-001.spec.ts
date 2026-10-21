import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

/**
 * TC-CRM-LEAD-001: lead capture, qualification, duplicate advice and one-time conversion.
 *
 * Covers the paths the lead-first CRM depends on: a lead is created in the default
 * pipeline, duplicate contact data is reported without blocking, a person and deal
 * are created from lead data before conversion, conversion records lineage once,
 * and a second conversion is rejected. It also pins the tenant kill switch, because
 * a disabled capability that still serves the list route is a data-exposure bug.
 */

const LEADS = '/api/customers/leads'
const SETTINGS = '/api/customers/lead-settings'
const PEOPLE = '/api/customers/people'
const DEALS = '/api/customers/deals'
const PIPELINES = '/api/customers/lead-pipelines'
const STAGES = '/api/customers/lead-pipeline-stages'

const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

type LeadRow = {
  id: string
  updatedAt?: string
  pipelineId?: string | null
  stageId?: string | null
  outcome?: string | null
  convertedAt?: string | null
  createdPersonId?: string | null
  createdDealId?: string | null
}

async function readLead(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  id: string,
): Promise<LeadRow | null> {
  const response = await apiRequest(request, 'GET', `${LEADS}?id=${encodeURIComponent(id)}`, { token })
  expect(response.ok(), `GET ${LEADS}?id= failed with ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { items?: LeadRow[] }
  return (body.items ?? []).find((item) => item.id === id) ?? null
}

async function setLeadsEnabled(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  enabled: boolean,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', SETTINGS, { token, data: { leadsEnabled: enabled } })
  expect(response.ok(), `PUT ${SETTINGS} failed with ${response.status()}`).toBeTruthy()
}

async function createLeadPipelineFixture(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  suffix: string,
): Promise<{ pipelineId: string; stageId: string }> {
  const pipelineResponse = await apiRequest(request, 'POST', PIPELINES, {
    token,
    data: { name: `QA lead pipeline ${suffix}`, code: `qa-${suffix}` },
  })
  expect(pipelineResponse.ok(), `POST ${PIPELINES} failed with ${pipelineResponse.status()}`).toBeTruthy()
  const pipelineBody = (await pipelineResponse.json()) as { pipelineId?: string }
  const pipelineId = pipelineBody.pipelineId ?? null
  expect(pipelineId, `POST ${PIPELINES} returned no id`).toBeTruthy()

  const stages = [
    { code: 'new', name: 'New', kind: 'open', position: 0 },
    { code: 'contacted', name: 'Contacted', kind: 'open', position: 1 },
    { code: 'qualified', name: 'Qualified', kind: 'open', position: 2 },
    { code: 'won', name: 'Won', kind: 'won', position: 3 },
    { code: 'lost', name: 'Lost', kind: 'lost', position: 4 },
  ] as const
  let firstOpenStageId: string | null = null
  for (const stage of stages) {
    const stageResponse = await apiRequest(request, 'POST', STAGES, {
      token,
      data: { pipelineId, ...stage },
    })
    expect(stageResponse.ok(), `POST ${STAGES} failed with ${stageResponse.status()}`).toBeTruthy()
    const stageBody = (await stageResponse.json()) as { stageId?: string }
    if (stage.kind === 'open' && !firstOpenStageId) {
      firstOpenStageId = stageBody.stageId ?? null
    }
  }
  expect(firstOpenStageId, 'the fixture pipeline must have an open stage').toBeTruthy()

  return { pipelineId: pipelineId as string, stageId: firstOpenStageId as string }
}

test.describe('TC-CRM-LEAD-001: lead funnel', () => {
  test('captures, qualifies, links and converts a lead once', async ({ request }) => {
    const token = await getAuthToken(request)
    const suffix = `${Date.now()}`
    const email = `lead-${suffix}@example.com`
    let pipelineId: string | null = null
    let leadId: string | null = null
    let duplicateLeadId: string | null = null
    let personId: string | null = null
    let dealId: string | null = null

    try {
      const pipeline = await createLeadPipelineFixture(request, token, suffix)
      pipelineId = pipeline.pipelineId
      const createResponse = await apiRequest(request, 'POST', LEADS, {
        token,
        data: {
          displayName: `Lead ${suffix}`,
          primaryEmail: email,
          source: 'integration',
          pipelineId: pipeline.pipelineId,
          stageId: pipeline.stageId,
          personData: { firstName: 'Sara', lastName: 'Omar', jobTitle: 'Fleet manager' },
          dealData: { title: `Fleet deal ${suffix}`, valueAmount: '15000', valueCurrency: 'SAR' },
        },
      })
      expect(createResponse.ok(), `POST ${LEADS} failed with ${createResponse.status()}`).toBeTruthy()
      leadId = ((await createResponse.json()) as { id?: string }).id ?? null
      expect(leadId).toBeTruthy()

      const created = await readLead(request, token, leadId as string)
      expect(created?.pipelineId).toBeTruthy()
      expect(created?.stageId).toBeTruthy()
      expect(created?.outcome).toBe('open')

      const duplicateResponse = await apiRequest(request, 'POST', LEADS, {
        token,
        data: { displayName: `Duplicate ${suffix}`, primaryEmail: email },
      })
      expect(duplicateResponse.ok()).toBeTruthy()
      duplicateLeadId = ((await duplicateResponse.json()) as { id?: string }).id ?? null

      const checkResponse = await apiRequest(request, 'POST', `${LEADS}/duplicate-check`, {
        token,
        data: { primaryEmail: email, excludeLeadId: duplicateLeadId },
      })
      expect(checkResponse.ok(), `duplicate-check failed with ${checkResponse.status()}`).toBeTruthy()
      const duplicates = (await checkResponse.json()) as { items?: Array<{ id: string; kind: string; matchedOn: string[] }> }
      const match = (duplicates.items ?? []).find((item) => item.id === leadId)
      expect(match).toBeTruthy()
      expect(match?.matchedOn).toContain('email')

      const stagesResponse = await apiRequest(request, 'GET', '/api/customers/lead-pipeline-stages', { token })
      const stagesBody = (await stagesResponse.json()) as { items?: Array<{ id: string; pipelineId: string; kind: string; position: number }> }
      const openStages = (stagesBody.items ?? [])
        .filter((stage) => stage.pipelineId === created?.pipelineId && stage.kind === 'open')
        .sort((left, right) => left.position - right.position)
      expect(openStages.length).toBeGreaterThan(1)
      const targetStage = openStages[openStages.length - 1]

      const advanceResponse = await apiRequest(request, 'POST', `${LEADS}/advance-stage`, {
        token,
        headers: created?.updatedAt ? { [LOCK_HEADER]: created.updatedAt } : undefined,
        data: { id: leadId, stageId: targetStage.id },
      })
      expect(advanceResponse.ok(), `advance-stage failed with ${advanceResponse.status()}`).toBeTruthy()

      const afterAdvance = await readLead(request, token, leadId as string)
      expect(afterAdvance?.stageId).toBe(targetStage.id)

      const personResponse = await apiRequest(request, 'POST', `${LEADS}/create-person`, {
        token,
        headers: afterAdvance?.updatedAt ? { [LOCK_HEADER]: afterAdvance.updatedAt } : undefined,
        data: { id: leadId },
      })
      expect(personResponse.ok(), `create-person failed with ${personResponse.status()}`).toBeTruthy()
      personId = ((await personResponse.json()) as { personId?: string }).personId ?? null
      expect(personId).toBeTruthy()

      const afterPerson = await readLead(request, token, leadId as string)
      const convertResponse = await apiRequest(request, 'POST', `${LEADS}/convert`, {
        token,
        headers: afterPerson?.updatedAt ? { [LOCK_HEADER]: afterPerson.updatedAt } : undefined,
        data: {
          id: leadId,
          person: { mode: 'create' },
          deal: { mode: 'create' },
        },
      })
      expect(convertResponse.ok(), `convert failed with ${convertResponse.status()}`).toBeTruthy()
      const conversion = (await convertResponse.json()) as { personId?: string; dealId?: string }
      expect(conversion.personId).toBe(personId)
      dealId = conversion.dealId ?? null
      expect(dealId).toBeTruthy()

      const converted = await readLead(request, token, leadId as string)
      expect(converted?.outcome).toBe('won')
      expect(converted?.convertedAt).toBeTruthy()
      expect(converted?.createdDealId).toBe(dealId)

      const secondConvert = await apiRequest(request, 'POST', `${LEADS}/convert`, {
        token,
        headers: converted?.updatedAt ? { [LOCK_HEADER]: converted.updatedAt } : undefined,
        data: { id: leadId, deal: { mode: 'create' } },
      })
      expect(secondConvert.status(), 'a converted lead must reject a second conversion').toBe(409)

      const historyResponse = await apiRequest(request, 'GET', `${LEADS}/history?leadId=${encodeURIComponent(leadId as string)}`, { token })
      const historyBody = (await historyResponse.json()) as { items?: Array<{ entryType: string }> }
      const entryTypes = (historyBody.items ?? []).map((entry) => entry.entryType)
      expect(entryTypes).toContain('created')
      expect(entryTypes).toContain('stage_changed')
      expect(entryTypes).toContain('person_created')
      expect(entryTypes).toContain('converted')

      await setLeadsEnabled(request, token, false)
      const disabledList = await apiRequest(request, 'GET', LEADS, { token })
      expect(disabledList.status(), 'a disabled lead capability must reject list reads').toBe(403)
      await setLeadsEnabled(request, token, true)
    } finally {
      await deleteEntityByBody(request, token, DEALS, dealId)
      await deleteEntityIfExists(request, token, PEOPLE, personId)
      await deleteEntityIfExists(request, token, LEADS, leadId)
      await deleteEntityIfExists(request, token, LEADS, duplicateLeadId)
      await deleteEntityByBody(request, token, PIPELINES, pipelineId)
      try {
        await setLeadsEnabled(request, token, true)
      } catch {
        // best-effort restore
      }
    }
  })
})
