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
const CUSTOMERS_COMPANIES_PATH = '/api/customers/companies'

type ExportGap = {
  submissionId?: string
  status?: string
  completenessScore?: number
  missingFields?: string[]
}

type StatementExport = {
  generatedAt?: string
  statement?: { id?: string; title?: string }
  submissions?: Array<{ id?: string; status?: string; completenessScore?: number }>
  productMappings?: unknown[]
  readiness?: {
    ready?: boolean
    submissionCount?: number
    verifiedCount?: number
    completeCount?: number
    gaps?: ExportGap[]
  }
}

function isoDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

function completeSubmissionFields(stamp: string, suffix: string): Record<string, unknown> {
  return {
    originCountry: 'BR',
    geolocation: { type: 'Point', coordinates: [-48.5, -21.2] },
    quantityKg: 1500,
    harvestFrom: isoDaysAgo(90),
    harvestTo: isoDaysAgo(30),
    producerName: `TC-EUDR-003 Producer ${suffix} ${stamp}`,
    attachmentIds: [randomUUID()],
  }
}

async function createStatement(
  request: APIRequestContext,
  token: string,
  title: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', STATEMENTS_PATH, {
    token,
    data: { title, commodity: 'cocoa' },
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
  const response = await apiRequest(request, 'POST', EVIDENCE_SUBMISSIONS_PATH, {
    token,
    data,
  })
  expect(response.status(), `create evidence submission failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Evidence submission create response should include id')
}

async function createRiskAssessment(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', RISK_ASSESSMENTS_PATH, {
    token,
    data,
  })
  expect(response.status(), `create risk assessment failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Risk assessment create response should include id')
}

async function exportStatement(
  request: APIRequestContext,
  token: string,
  statementId: string,
): Promise<{ status: number; body: StatementExport | null }> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/eudr/statements/${encodeURIComponent(statementId)}/export`,
    { token },
  )
  return { status: response.status(), body: await readJsonSafe<StatementExport>(response) }
}

async function deleteStatementIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', `${STATEMENTS_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

async function deleteSubmissionIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(
    request,
    'DELETE',
    `${EVIDENCE_SUBMISSIONS_PATH}?id=${encodeURIComponent(id)}`,
    { token },
  ).catch(() => undefined)
}

async function deleteRiskAssessmentIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(
    request,
    'DELETE',
    `${RISK_ASSESSMENTS_PATH}?id=${encodeURIComponent(id)}`,
    { token },
  ).catch(() => undefined)
}

/**
 * TC-EUDR-003: Due diligence statements + export readiness packet.
 */
test.describe('TC-EUDR-003: Statements + export packet', () => {
  test('exports readiness gaps until all linked submissions are verified and complete', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomUUID()}`
    const title = `TC-EUDR-003 ${stamp}`
    let supplierId: string | null = null
    let statementId: string | null = null
    let submissionAId: string | null = null
    let submissionBId: string | null = null
    let riskAssessmentId: string | null = null

    try {
      supplierId = await createCompanyFixture(request, token, `TC-EUDR-003 Supplier ${stamp}`)

      const missingTitleResponse = await apiRequest(request, 'POST', STATEMENTS_PATH, {
        token,
        data: { commodity: 'cocoa' },
      })
      expect(missingTitleResponse.status(), 'statement create without title should return 400').toBe(400)

      statementId = await createStatement(request, token, title)

      submissionAId = await createSubmission(request, token, {
        supplierEntityId: supplierId,
        commodity: 'cocoa',
        statementId,
        status: 'verified',
        ...completeSubmissionFields(stamp, 'A'),
      })
      submissionBId = await createSubmission(request, token, {
        supplierEntityId: supplierId,
        commodity: 'cocoa',
        statementId,
      })

      const firstExport = await exportStatement(request, token, statementId)
      expect(firstExport.status, `initial export failed: ${firstExport.status}`).toBe(200)
      expect(typeof firstExport.body?.generatedAt).toBe('string')
      expect(Number.isNaN(new Date(firstExport.body?.generatedAt ?? '').getTime())).toBe(false)
      expect(firstExport.body?.statement?.id).toBe(statementId)
      expect(firstExport.body?.statement?.title).toBe(title)
      expect(firstExport.body?.submissions).toHaveLength(2)
      expect(firstExport.body?.readiness).toEqual(expect.objectContaining({
        ready: false,
        submissionCount: 2,
        verifiedCount: 1,
        completeCount: 1,
      }))
      expect(firstExport.body?.readiness?.gaps).toHaveLength(1)
      const firstGap = firstExport.body?.readiness?.gaps?.[0]
      expect(firstGap).toEqual(expect.objectContaining({
        submissionId: submissionBId,
        status: 'draft',
        completenessScore: 0,
      }))
      expect(firstGap?.missingFields?.length ?? 0).toBeGreaterThan(0)

      const updateSubmissionBResponse = await apiRequest(request, 'PUT', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: {
          id: submissionBId,
          status: 'verified',
          ...completeSubmissionFields(stamp, 'B'),
        },
      })
      expect(updateSubmissionBResponse.status(), `update submission B failed: ${updateSubmissionBResponse.status()}`).toBe(200)

      const readyExport = await exportStatement(request, token, statementId)
      expect(readyExport.status, `ready export failed: ${readyExport.status}`).toBe(200)
      expect(readyExport.body?.readiness).toEqual(expect.objectContaining({
        ready: true,
        submissionCount: 2,
        verifiedCount: 2,
        completeCount: 2,
        gaps: [],
      }))

      const blockedSubmitResponse = await apiRequest(request, 'PUT', STATEMENTS_PATH, {
        token,
        data: { id: statementId, status: 'submitted' },
      })
      expect(
        blockedSubmitResponse.status(),
        'ready standard-risk statement without risk assessment should be blocked by the submit gate',
      ).toBe(400)
      const blockedSubmitBody = await readJsonSafe<{ details?: { reasons?: string[] } }>(blockedSubmitResponse)
      expect(Array.isArray(blockedSubmitBody?.details?.reasons), 'submit gate should expose reasons array').toBe(true)
      expect(blockedSubmitBody?.details?.reasons).toContain('eudr.gate.riskConclusionMissing')

      riskAssessmentId = await createRiskAssessment(request, token, {
        statementId,
        criteria: {},
        conclusion: 'negligible',
      })

      const submitResponse = await apiRequest(request, 'PUT', STATEMENTS_PATH, {
        token,
        data: { id: statementId, status: 'submitted' },
      })
      expect(submitResponse.status(), `submit statement after negligible risk assessment failed: ${submitResponse.status()}`).toBe(200)

      const missingExport = await exportStatement(request, token, randomUUID())
      expect(missingExport.status, 'exporting an unknown statement should return 404').toBe(404)

      const employeeToken = await getAuthToken(request, 'employee')
      const employeeExport = await exportStatement(request, employeeToken, statementId)
      expect(employeeExport.status, 'employee should be allowed to export statements').toBe(200)

      const employeeUpdateResponse = await apiRequest(request, 'PUT', STATEMENTS_PATH, {
        token: employeeToken,
        data: { id: statementId, title: `${title} employee edit` },
      })
      expect(employeeUpdateResponse.status(), 'employee should not be allowed to update statements').toBe(403)
    } finally {
      await deleteRiskAssessmentIfExists(request, token, riskAssessmentId)
      await deleteSubmissionIfExists(request, token, submissionBId)
      await deleteSubmissionIfExists(request, token, submissionAId)
      await deleteStatementIfExists(request, token, statementId)
      await deleteEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })
})
