import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  expectId,
  getTokenContext,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['incidents'],
}

const INCIDENTS_API = '/api/incidents'
const SEVERITIES_API = '/api/incidents/severities'
const AI_AVAILABILITY_API = '/api/incidents/ai/availability'
const AI_TRIAGE_API = '/api/incidents/ai/triage'
const TEST_PASSWORD = 'Incident-Ai-Use-1!'

type Scope = {
  organizationId: string
  tenantId: string
}

type ListResponse<T> = {
  items?: T[]
}

type SeverityRecord = {
  id: string
}

type AvailabilityResponse = {
  available?: boolean
}

type SimilarIncident = {
  id?: string
  number?: string
  title?: string
  status?: string
}

type TriageResponse = {
  suggestion?: unknown | null
  similar?: SimilarIncident[]
}

type SummaryResponse = {
  summary?: unknown
  keyEvents?: unknown
}

let token = ''
let scope: Scope
const createdIncidentIds = new Set<string>()

function uniqueSuffix(): string {
  return `${Date.now()}-${randomUUID().slice(0, 8)}`
}

function itemsFrom<T>(body: ListResponse<T> | null): T[] {
  return Array.isArray(body?.items) ? body.items : []
}

async function fetchSeverityId(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'GET', `${SEVERITIES_API}?isActive=true&pageSize=100`, { token })
  expect(response.status(), 'GET /api/incidents/severities should succeed').toBe(200)
  const body = await readJsonSafe<ListResponse<SeverityRecord>>(response)
  const severity = itemsFrom(body).find((item) => typeof item.id === 'string' && item.id.length > 0)
  expect(severity, 'at least one active severity should exist').toBeTruthy()
  return severity!.id
}

async function createIncident(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const response = await apiRequest(request, 'POST', INCIDENTS_API, {
    token,
    data: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      title: `INC AI degradation ${uniqueSuffix()}`,
      description: 'Playwright AI degradation fixture',
      severityId: await fetchSeverityId(request),
    },
  })
  expect(response.status(), 'POST /api/incidents should create an incident').toBe(201)
  const body = await readJsonSafe<{ id?: unknown }>(response)
  const id = expectId(body?.id, 'created incident should return id')
  createdIncidentIds.add(id)
  return id
}

async function deleteIncidentIfExists(request: import('@playwright/test').APIRequestContext, id: string | null): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `${INCIDENTS_API}?id=${encodeURIComponent(id)}`, { token })
  } catch {
    // Cleanup must not mask the assertion that already failed.
  } finally {
    createdIncidentIds.delete(id)
  }
}

function expectSimilarShape(similar: unknown): void {
  expect(Array.isArray(similar), 'similar should be an array').toBe(true)
  for (const item of similar as SimilarIncident[]) {
    expect(typeof item.id, 'similar item id should be present').toBe('string')
    expect(typeof item.title, 'similar item title should be present').toBe('string')
    expect(typeof item.status, 'similar item status should be present').toBe('string')
  }
}

test.describe('TC-INC-012: Incident AI degradation API', () => {
  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    scope = getTokenContext(token)
  })

  test.afterAll(async ({ request }) => {
    for (const id of Array.from(createdIncidentIds)) {
      await deleteIncidentIfExists(request, id)
    }
  })

  test('reports availability and degrades summary/triage without asserting AI content', async ({ request }) => {
    let incidentId: string | null = null

    try {
      const availabilityResponse = await apiRequest(request, 'GET', AI_AVAILABILITY_API, { token })
      expect(availabilityResponse.status(), 'GET /api/incidents/ai/availability should succeed').toBe(200)
      const availability = await readJsonSafe<AvailabilityResponse>(availabilityResponse)
      expect(typeof availability?.available, 'availability response should include a boolean').toBe('boolean')

      incidentId = await createIncident(request)
      const summaryResponse = await apiRequest(request, 'POST', `${INCIDENTS_API}/${incidentId}/ai/summary`, {
        token,
        data: {},
      })
      const triageResponse = await apiRequest(request, 'POST', AI_TRIAGE_API, {
        token,
        data: {
          title: `AI degradation triage ${uniqueSuffix()}`,
          description: 'Triage should fall back to similar incidents when AI is unavailable.',
        },
      })

      if (availability?.available === false) {
        expect(summaryResponse.status(), 'summary should return 503 when AI is unavailable').toBe(503)
        const summaryError = await readJsonSafe<{ code?: string }>(summaryResponse)
        const acceptableUnavailableCodes = ['ai_unavailable', 'no_provider_configured', 'api_key_missing']
        expect(
          acceptableUnavailableCodes.includes(summaryError?.code ?? ''),
          `summary degradation should return a typed AI-unavailable code (got ${summaryError?.code ?? 'none'})`,
        ).toBe(true)

        expect(triageResponse.status(), 'triage should return 503 when AI is unavailable').toBe(503)
        const triageError = await readJsonSafe<{ code?: string }>(triageResponse)
        expect(
          acceptableUnavailableCodes.includes(triageError?.code ?? ''),
          `triage degradation should return a typed AI-unavailable code (got ${triageError?.code ?? 'none'})`,
        ).toBe(true)
      } else {
        expect(summaryResponse.status(), 'summary should succeed when AI is available').toBe(200)
        const summary = await readJsonSafe<SummaryResponse>(summaryResponse)
        expect(typeof summary?.summary, 'summary response should include summary text').toBe('string')
        expect(Array.isArray(summary?.keyEvents), 'summary response should include keyEvents array').toBe(true)

        expect(triageResponse.status(), 'triage should succeed when AI is available').toBe(200)
        const triage = await readJsonSafe<TriageResponse>(triageResponse)
        expect(
          triage?.suggestion === null || (typeof triage?.suggestion === 'object' && triage.suggestion !== undefined),
          'triage suggestion should be nullable object-shaped',
        ).toBe(true)
        expectSimilarShape(triage?.similar)
      }
    } finally {
      await deleteIncidentIfExists(request, incidentId)
    }
  })

  test('requires incidents.ai.use for triage', async ({ request }) => {
    const stamp = uniqueSuffix()
    const email = `qa-inc-ai-no-use-${stamp}@acme.com`
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, token, {
        name: `qa_inc_ai_no_use_${stamp}`,
        tenantId: scope.tenantId,
      })
      await setRoleAclFeatures(request, token, {
        roleId,
        features: ['incidents.incident.view'],
      })
      userId = await createUserFixture(request, token, {
        email,
        password: TEST_PASSWORD,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: 'QA Incidents AI No Use User',
      })
      const limitedToken = await getAuthToken(request, email, TEST_PASSWORD)

      const denied = await apiRequest(request, 'POST', AI_TRIAGE_API, {
        token: limitedToken,
        data: {
          title: `Unauthorized AI triage ${uniqueSuffix()}`,
          description: 'This caller lacks incidents.ai.use.',
        },
      })
      expect(denied.status(), 'triage without incidents.ai.use should return 403').toBe(403)
    } finally {
      await deleteUserIfExists(request, token, userId)
      await deleteRoleIfExists(request, token, roleId)
    }
  })
})
