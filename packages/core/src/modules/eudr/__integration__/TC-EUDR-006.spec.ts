import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'customers'],
}

const STATEMENTS_PATH = '/api/eudr/statements'
const EVIDENCE_SUBMISSIONS_PATH = '/api/eudr/evidence-submissions'
const RISK_ASSESSMENTS_PATH = '/api/eudr/risk-assessments'
const MITIGATION_ACTIONS_PATH = '/api/eudr/mitigation-actions'
const CUSTOMERS_COMPANIES_PATH = '/api/customers/companies'

type RiskAssessmentRow = {
  id: string
  statementId?: string | null
  criteria?: unknown
  conclusion?: string | null
  countryRisks?: unknown
  overallTier?: string | null
  isSimplified?: boolean | null
  assessedAt?: string | null
  reviewDueAt?: string | null
}

type MitigationActionRow = {
  id: string
  riskAssessmentId?: string | null
  actionType?: string | null
  title?: string | null
  status?: string | null
  completedAt?: string | null
}

type ListResponse<T> = {
  items?: T[]
}

function isoDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

function isoDaysFromNow(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function completeSubmissionFields(suffix: string, originCountry: string): Record<string, unknown> {
  return {
    originCountry,
    geolocation: { type: 'Point', coordinates: [-48.5, -21.2] },
    quantityKg: 1500,
    harvestFrom: isoDaysAgo(90),
    harvestTo: isoDaysAgo(30),
    producerName: `TC-EUDR-006 Producer ${suffix}`,
    attachmentIds: [randomUUID()],
    status: 'verified',
  }
}

function extractCountryRiskMap(value: unknown): Map<string, string> {
  const risks = new Map<string, string>()
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as Record<string, unknown>
      const country = typeof record.country === 'string'
        ? record.country
        : typeof record.countryCode === 'string'
          ? record.countryCode
          : typeof record.originCountry === 'string'
            ? record.originCountry
            : null
      const tier = typeof record.tier === 'string' ? record.tier : null
      if (country && tier) risks.set(country, tier)
    }
    return risks
  }
  if (typeof value === 'object' && value !== null) {
    for (const [country, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'string') {
        risks.set(country, entry)
      } else if (typeof entry === 'object' && entry !== null) {
        const tier = (entry as Record<string, unknown>).tier
        if (typeof tier === 'string') risks.set(country, tier)
      }
    }
  }
  return risks
}

function expectDateCloseToOneYearAfter(reviewDueAt: string | null | undefined, assessedAt: string | null | undefined): void {
  expect(typeof reviewDueAt === 'string' && reviewDueAt.length > 0, 'reviewDueAt should be returned').toBe(true)
  expect(typeof assessedAt === 'string' && assessedAt.length > 0, 'assessedAt should be returned').toBe(true)
  const assessedDate = new Date(assessedAt ?? '')
  const expected = new Date(assessedDate)
  expected.setUTCFullYear(expected.getUTCFullYear() + 1)
  const actualTime = new Date(reviewDueAt ?? '').getTime()
  expect(Number.isNaN(actualTime), 'reviewDueAt should parse as a date').toBe(false)
  const driftMs = Math.abs(actualTime - expected.getTime())
  expect(driftMs).toBeLessThanOrEqual(48 * 60 * 60 * 1000)
}

async function createStatement(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', STATEMENTS_PATH, {
    token,
    data: { title, commodity: 'coffee' },
  })
  expect(response.status(), `create statement failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Statement create response should include id')
}

async function createSubmission(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', EVIDENCE_SUBMISSIONS_PATH, { token, data })
  expect(response.status(), `create evidence submission failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Evidence submission create response should include id')
}

async function readRiskAssessment(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<RiskAssessmentRow | null> {
  const response = await apiRequest(request, 'GET', `${RISK_ASSESSMENTS_PATH}?ids=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `GET risk assessment by ids should return 200: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<ListResponse<RiskAssessmentRow>>(response)
  return body?.items?.find((item) => item.id === id) ?? null
}

async function readMitigationAction(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<MitigationActionRow | null> {
  const response = await apiRequest(request, 'GET', `${MITIGATION_ACTIONS_PATH}?ids=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `GET mitigation action by ids should return 200: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<ListResponse<MitigationActionRow>>(response)
  return body?.items?.find((item) => item.id === id) ?? null
}

async function deleteByCrudPath(
  request: APIRequestContext,
  token: string | null,
  path: string,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', `${path}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

function expectErrorKey(body: unknown, errorKey: string): void {
  expect(JSON.stringify(body), `error response should contain ${errorKey}`).toContain(errorKey)
}

/**
 * TC-EUDR-006: Risk assessments and mitigation actions API coverage.
 */
test.describe('TC-EUDR-006: Risk assessments + mitigation API', () => {
  test('computes country risk, enforces mitigation gates, and protects server-owned fields', async ({ request }) => {
    const stamp = `${Date.now()}-${randomUUID()}`
    let supplierId: string | null = null
    let statementId: string | null = null
    let submissionBRId: string | null = null
    let submissionIDId: string | null = null
    let riskAssessmentId: string | null = null
    let mitigationActionId: string | null = null

    const unauthenticatedGet = await request.get(RISK_ASSESSMENTS_PATH)
    expect(unauthenticatedGet.status(), 'GET without auth should return 401').toBe(401)

    const unauthenticatedPost = await request.post(RISK_ASSESSMENTS_PATH, {
      data: { statementId: randomUUID(), criteria: {}, conclusion: 'negligible' },
    })
    expect(unauthenticatedPost.status(), 'POST without auth should return 401').toBe(401)

    const token = await getAuthToken(request, 'admin')

    try {
      supplierId = await createCompanyFixture(request, token, `TC-EUDR-006 Supplier ${stamp}`)
      statementId = await createStatement(request, token, `TC-EUDR-006 Statement ${stamp}`)
      submissionBRId = await createSubmission(request, token, {
        supplierEntityId: supplierId,
        commodity: 'coffee',
        statementId,
        ...completeSubmissionFields(`${stamp} BR`, 'BR'),
      })
      submissionIDId = await createSubmission(request, token, {
        supplierEntityId: supplierId,
        commodity: 'coffee',
        statementId,
        ...completeSubmissionFields(`${stamp} ID`, 'ID'),
      })

      const concernWithoutMitigationResponse = await apiRequest(request, 'POST', RISK_ASSESSMENTS_PATH, {
        token,
        data: {
          statementId,
          criteria: { land_title_permits: { answer: 'concern', note: 'x' } },
          conclusion: 'negligible',
        },
      })
      expect(concernWithoutMitigationResponse.status(), 'concerns require mitigation before negligible conclusion').toBe(400)
      expectErrorKey(await readJsonSafe(concernWithoutMitigationResponse), 'mitigationRequired')

      const createRiskResponse = await apiRequest(request, 'POST', RISK_ASSESSMENTS_PATH, {
        token,
        data: {
          statementId,
          criteria: { land_title_permits: { answer: 'concern', note: 'x' } },
          conclusion: 'non_negligible',
        },
      })
      expect(createRiskResponse.status(), `create risk assessment failed: ${createRiskResponse.status()}`).toBe(201)
      const createdRisk = await readJsonSafe<{ id?: string }>(createRiskResponse)
      riskAssessmentId = expectId(createdRisk?.id, 'Risk assessment create response should include id')

      const riskReadback = await readRiskAssessment(request, token, riskAssessmentId)
      expect(riskReadback?.conclusion).toBe('non_negligible')
      const riskMap = extractCountryRiskMap(riskReadback?.countryRisks)
      expect([...riskMap.keys()].sort()).toEqual(['BR', 'ID'])
      expect(riskMap.get('BR')).toBe('standard')
      expect(riskMap.get('ID')).toBe('standard')
      expect(riskReadback?.overallTier).toBe('standard')
      expect(riskReadback?.isSimplified).toBe(false)
      expectDateCloseToOneYearAfter(riskReadback?.reviewDueAt, riskReadback?.assessedAt)

      const serverComputedResponse = await apiRequest(request, 'POST', RISK_ASSESSMENTS_PATH, {
        token,
        data: {
          statementId,
          criteria: {},
          conclusion: 'non_negligible',
          countryRisks: [{ country: 'BR', tier: 'low' }],
          overallTier: 'low',
        },
      })
      expect(serverComputedResponse.status(), 'client-sent risk tier fields should be rejected').toBe(400)
      expectErrorKey(await readJsonSafe(serverComputedResponse), 'serverComputedField')

      const createActionResponse = await apiRequest(request, 'POST', MITIGATION_ACTIONS_PATH, {
        token,
        data: {
          riskAssessmentId,
          actionType: 'supplier_audit',
          title: `TC-EUDR-006 Supplier audit ${stamp}`,
          status: 'planned',
        },
      })
      expect(createActionResponse.status(), `create mitigation action failed: ${createActionResponse.status()}`).toBe(201)
      const createdAction = await readJsonSafe<{ id?: string }>(createActionResponse)
      mitigationActionId = expectId(createdAction?.id, 'Mitigation action create response should include id')

      const completeActionResponse = await apiRequest(request, 'PUT', MITIGATION_ACTIONS_PATH, {
        token,
        data: { id: mitigationActionId, status: 'completed' },
      })
      expect(completeActionResponse.status(), `complete mitigation action failed: ${completeActionResponse.status()}`).toBe(200)
      const completedAction = await readMitigationAction(request, token, mitigationActionId)
      expect(completedAction?.status).toBe('completed')
      expect(typeof completedAction?.completedAt === 'string' && completedAction.completedAt.length > 0).toBe(true)
      expect(Number.isNaN(new Date(completedAction?.completedAt ?? '').getTime())).toBe(false)

      const reopenActionResponse = await apiRequest(request, 'PUT', MITIGATION_ACTIONS_PATH, {
        token,
        data: { id: mitigationActionId, status: 'in_progress' },
      })
      expect(reopenActionResponse.status(), `reopen mitigation action failed: ${reopenActionResponse.status()}`).toBe(200)
      const reopenedAction = await readMitigationAction(request, token, mitigationActionId)
      expect(reopenedAction?.status).toBe('in_progress')
      expect(reopenedAction?.completedAt ?? null).toBeNull()

      const clientCompletedAtResponse = await apiRequest(request, 'PUT', MITIGATION_ACTIONS_PATH, {
        token,
        data: { id: mitigationActionId, status: 'completed', completedAt: isoDaysAgo(1) },
      })
      expect(clientCompletedAtResponse.status(), 'client-sent completedAt should be rejected').toBe(400)

      const completeAgainResponse = await apiRequest(request, 'PUT', MITIGATION_ACTIONS_PATH, {
        token,
        data: { id: mitigationActionId, status: 'completed' },
      })
      expect(completeAgainResponse.status(), `complete mitigation action for gate failed: ${completeAgainResponse.status()}`).toBe(200)

      const markNegligibleResponse = await apiRequest(request, 'PUT', RISK_ASSESSMENTS_PATH, {
        token,
        data: { id: riskAssessmentId, conclusion: 'negligible' },
      })
      expect(markNegligibleResponse.status(), `mark assessment negligible failed: ${markNegligibleResponse.status()}`).toBe(200)
      const negligibleReadback = await readRiskAssessment(request, token, riskAssessmentId)
      expect(negligibleReadback?.conclusion).toBe('negligible')

      const futureAssessedAtResponse = await apiRequest(request, 'POST', RISK_ASSESSMENTS_PATH, {
        token,
        data: {
          statementId,
          criteria: {},
          conclusion: 'non_negligible',
          assessedAt: isoDaysFromNow(1),
        },
      })
      expect(futureAssessedAtResponse.status(), 'future assessedAt should return 400').toBe(400)

      const unknownCriterionResponse = await apiRequest(request, 'POST', RISK_ASSESSMENTS_PATH, {
        token,
        data: {
          statementId,
          criteria: { unsupported_criterion: { answer: 'ok' } },
          conclusion: 'non_negligible',
        },
      })
      expect(unknownCriterionResponse.status(), 'unknown criteria keys should return 400').toBe(400)

      const unknownStatementResponse = await apiRequest(request, 'POST', RISK_ASSESSMENTS_PATH, {
        token,
        data: {
          statementId: randomUUID(),
          criteria: {},
          conclusion: 'negligible',
        },
      })
      expect([400, 404]).toContain(unknownStatementResponse.status())

      const employeeToken = await getAuthToken(request, 'employee')
      const employeeGetResponse = await apiRequest(request, 'GET', RISK_ASSESSMENTS_PATH, { token: employeeToken })
      expect(employeeGetResponse.status(), 'employee should be allowed to view risk assessments').toBe(200)
      const employeePostResponse = await apiRequest(request, 'POST', RISK_ASSESSMENTS_PATH, {
        token: employeeToken,
        data: { statementId, criteria: {}, conclusion: 'negligible' },
      })
      expect(employeePostResponse.status(), 'employee should not be allowed to create risk assessments').toBe(403)
    } finally {
      await deleteByCrudPath(request, token, MITIGATION_ACTIONS_PATH, mitigationActionId)
      await deleteByCrudPath(request, token, RISK_ASSESSMENTS_PATH, riskAssessmentId)
      await deleteByCrudPath(request, token, EVIDENCE_SUBMISSIONS_PATH, submissionIDId)
      await deleteByCrudPath(request, token, EVIDENCE_SUBMISSIONS_PATH, submissionBRId)
      await deleteByCrudPath(request, token, STATEMENTS_PATH, statementId)
      await deleteEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })
})
