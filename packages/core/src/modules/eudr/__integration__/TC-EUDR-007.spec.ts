import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr', 'customers'],
}

const PRODUCT_MAPPINGS_PATH = '/api/eudr/product-mappings'
const STATEMENTS_PATH = '/api/eudr/statements'
const EVIDENCE_SUBMISSIONS_PATH = '/api/eudr/evidence-submissions'
const RISK_ASSESSMENTS_PATH = '/api/eudr/risk-assessments'
const CUSTOMERS_COMPANIES_PATH = '/api/customers/companies'

type StatementRow = {
  id: string
  title?: string | null
  status?: string | null
  quantityKg?: string | number | null
  submittedAt?: string | null
  referenceNumber?: string | null
  verificationNumber?: string | null
  referenceIssuedAt?: string | null
  latestRisk?: {
    conclusion?: string | null
    overallTier?: string | null
  } | null
}

type ListResponse<T> = {
  items?: T[]
}

function isoDaysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

function completeSubmissionFields(stamp: string, originCountry: string): Record<string, unknown> {
  return {
    originCountry,
    geolocation: { type: 'Point', coordinates: [-48.5, -21.2] },
    quantityKg: 1500,
    harvestFrom: isoDaysAgo(90),
    harvestTo: isoDaysAgo(30),
    producerName: `TC-EUDR-007 Producer ${originCountry} ${stamp}`,
    attachmentIds: [randomUUID()],
  }
}

function statementCreatePayload(title: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title,
    commodity: 'coffee',
    ...overrides,
  }
}

async function createProductMapping(
  request: APIRequestContext,
  token: string,
  stamp: string,
): Promise<string> {
  const response = await apiRequest(request, 'POST', PRODUCT_MAPPINGS_PATH, {
    token,
    data: {
      productId: randomUUID(),
      commodity: 'coffee',
      hsCode: '090111',
      productSnapshot: { name: `TC-EUDR-007 Product ${stamp}`, sku: `TC-EUDR-007-${stamp}` },
    },
  })
  expect(response.status(), `create product mapping failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Product mapping create response should include id')
}

async function createStatement(
  request: APIRequestContext,
  token: string,
  title: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await apiRequest(request, 'POST', STATEMENTS_PATH, {
    token,
    data: statementCreatePayload(title, overrides),
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

async function createCompleteVerifiedSubmission(
  request: APIRequestContext,
  token: string,
  input: {
    supplierEntityId: string
    statementId: string
    originCountry: string
    stamp: string
  },
): Promise<string> {
  const submissionId = await createSubmission(request, token, {
    supplierEntityId: input.supplierEntityId,
    commodity: 'coffee',
    statementId: input.statementId,
    ...completeSubmissionFields(input.stamp, input.originCountry),
  })
  const verifyResponse = await apiRequest(request, 'PUT', EVIDENCE_SUBMISSIONS_PATH, {
    token,
    data: { id: submissionId, status: 'verified' },
  })
  expect(verifyResponse.status(), `verify complete submission failed: ${verifyResponse.status()}`).toBe(200)
  return submissionId
}

async function createRiskAssessment(
  request: APIRequestContext,
  token: string,
  statementId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await apiRequest(request, 'POST', RISK_ASSESSMENTS_PATH, {
    token,
    data: {
      statementId,
      criteria: {},
      conclusion: 'negligible',
      ...overrides,
    },
  })
  expect(response.status(), `create risk assessment failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Risk assessment create response should include id')
}

async function updateStatement(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  return apiRequest(request, 'PUT', STATEMENTS_PATH, { token, data })
}

async function readStatementById(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<StatementRow | null> {
  const response = await apiRequest(request, 'GET', `${STATEMENTS_PATH}?ids=${encodeURIComponent(id)}`, { token })
  expect(response.status(), `GET statement by ids should return 200: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<ListResponse<StatementRow>>(response)
  return body?.items?.find((item) => item.id === id) ?? null
}

async function readStatementsByIds(
  request: APIRequestContext,
  token: string,
  ids: string[],
): Promise<StatementRow[]> {
  const response = await apiRequest(request, 'GET', `${STATEMENTS_PATH}?ids=${encodeURIComponent(ids.join(','))}`, { token })
  expect(response.status(), `GET statements by ids should return 200: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<ListResponse<StatementRow>>(response)
  return body?.items ?? []
}

async function expectGateReason(response: APIResponse, expectedReason: string): Promise<void> {
  expect(response.status(), `gate response for ${expectedReason} should return 400`).toBe(400)
  const body = await readJsonSafe<{ details?: { reasons?: string[] } }>(response)
  expect(Array.isArray(body?.details?.reasons), 'gate response should expose details.reasons array').toBe(true)
  expect(body?.details?.reasons).toContain(expectedReason)
}

async function expectErrorKey(response: APIResponse, expectedKey: string): Promise<void> {
  expect(response.status(), `response for ${expectedKey} should return 400`).toBe(400)
  const body = await readJsonSafe(response)
  expect(JSON.stringify(body), `error response should contain ${expectedKey}`).toContain(expectedKey)
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

async function createSubmittedStatement(
  request: APIRequestContext,
  token: string,
  input: {
    supplierEntityId: string
    title: string
    stamp: string
    originCountry?: string
    createAssessment?: boolean
    statementOverrides?: Record<string, unknown>
  },
): Promise<{ statementId: string; submissionId: string; assessmentId: string | null }> {
  const originCountry = input.originCountry ?? 'BR'
  const statementId = await createStatement(request, token, input.title, input.statementOverrides ?? {})
  const submissionId = await createCompleteVerifiedSubmission(request, token, {
    supplierEntityId: input.supplierEntityId,
    statementId,
    originCountry,
    stamp: input.stamp,
  })
  const assessmentId = input.createAssessment === false
    ? null
    : await createRiskAssessment(request, token, statementId)
  const submitResponse = await updateStatement(request, token, { id: statementId, status: 'submitted' })
  expect(submitResponse.status(), `submit statement failed: ${submitResponse.status()}`).toBe(200)
  return { statementId, submissionId, assessmentId }
}

/**
 * TC-EUDR-007: Due diligence statement lifecycle gates.
 */
test.describe('TC-EUDR-007: Statement lifecycle', () => {
  test('requires valid transition order, complete submissions, and risk conclusion before submit', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomUUID()}`
    const statementIds: string[] = []
    const submissionIds: string[] = []
    const assessmentIds: string[] = []
    let supplierId: string | null = null
    let mappingId: string | null = null

    try {
      supplierId = await createCompanyFixture(request, token, `TC-EUDR-007 Supplier ${stamp}`)
      mappingId = await createProductMapping(request, token, stamp)

      const invalidCreateResponse = await apiRequest(request, 'POST', STATEMENTS_PATH, {
        token,
        data: statementCreatePayload(`TC-EUDR-007 Invalid available ${stamp}`, { status: 'available' }),
      })
      await expectErrorKey(invalidCreateResponse, 'invalidTransition')

      const statementId = await createStatement(request, token, `TC-EUDR-007 Submit gate ${stamp}`)
      statementIds.push(statementId)

      const noSubmissionsResponse = await updateStatement(request, token, { id: statementId, status: 'submitted' })
      await expectGateReason(noSubmissionsResponse, 'eudr.gate.noSubmissions')

      const incompleteSubmissionId = await createSubmission(request, token, {
        supplierEntityId: supplierId,
        commodity: 'coffee',
        statementId,
      })
      submissionIds.push(incompleteSubmissionId)

      const incompleteSubmitResponse = await updateStatement(request, token, { id: statementId, status: 'submitted' })
      await expectGateReason(incompleteSubmitResponse, 'eudr.gate.submissionsNotReady')

      const completeSubmissionResponse = await apiRequest(request, 'PUT', EVIDENCE_SUBMISSIONS_PATH, {
        token,
        data: {
          id: incompleteSubmissionId,
          status: 'verified',
          ...completeSubmissionFields(stamp, 'BR'),
        },
      })
      expect(completeSubmissionResponse.status(), `complete linked submission failed: ${completeSubmissionResponse.status()}`).toBe(200)

      const missingRiskResponse = await updateStatement(request, token, { id: statementId, status: 'submitted' })
      await expectGateReason(missingRiskResponse, 'eudr.gate.riskConclusionMissing')

      const assessmentId = await createRiskAssessment(request, token, statementId)
      assessmentIds.push(assessmentId)

      const submitResponse = await updateStatement(request, token, { id: statementId, status: 'submitted' })
      expect(submitResponse.status(), `submit after risk assessment failed: ${submitResponse.status()}`).toBe(200)
      const submitted = await readStatementById(request, token, statementId)
      expect(submitted?.status).toBe('submitted')
      expect(typeof submitted?.submittedAt === 'string' && submitted.submittedAt.length > 0).toBe(true)
    } finally {
      for (const id of assessmentIds.reverse()) await deleteByCrudPath(request, token, RISK_ASSESSMENTS_PATH, id)
      for (const id of submissionIds.reverse()) await deleteByCrudPath(request, token, EVIDENCE_SUBMISSIONS_PATH, id)
      for (const id of statementIds.reverse()) await deleteByCrudPath(request, token, STATEMENTS_PATH, id)
      await deleteByCrudPath(request, token, PRODUCT_MAPPINGS_PATH, mappingId)
      await deleteEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })

  test('handles stale assessments, overdue review, simplified low-risk origins, and SME trader references', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomUUID()}`
    const statementIds: string[] = []
    const submissionIds: string[] = []
    const assessmentIds: string[] = []
    let supplierId: string | null = null
    let mappingId: string | null = null

    try {
      supplierId = await createCompanyFixture(request, token, `TC-EUDR-007 Supplier B ${stamp}`)
      mappingId = await createProductMapping(request, token, `${stamp}-B`)

      const staleStatementId = await createStatement(request, token, `TC-EUDR-007 Stale ${stamp}`)
      statementIds.push(staleStatementId)
      submissionIds.push(await createCompleteVerifiedSubmission(request, token, {
        supplierEntityId: supplierId,
        statementId: staleStatementId,
        originCountry: 'BR',
        stamp: `${stamp}-BR`,
      }))
      assessmentIds.push(await createRiskAssessment(request, token, staleStatementId))
      submissionIds.push(await createCompleteVerifiedSubmission(request, token, {
        supplierEntityId: supplierId,
        statementId: staleStatementId,
        originCountry: 'CI',
        stamp: `${stamp}-CI`,
      }))
      const staleSubmitResponse = await updateStatement(request, token, { id: staleStatementId, status: 'submitted' })
      await expectGateReason(staleSubmitResponse, 'eudr.gate.riskAssessmentStale')
      assessmentIds.push(await createRiskAssessment(request, token, staleStatementId))
      const staleResolvedResponse = await updateStatement(request, token, { id: staleStatementId, status: 'submitted' })
      expect(staleResolvedResponse.status(), `submit after reassessment failed: ${staleResolvedResponse.status()}`).toBe(200)

      const overdueStatementId = await createStatement(request, token, `TC-EUDR-007 Overdue ${stamp}`)
      statementIds.push(overdueStatementId)
      submissionIds.push(await createCompleteVerifiedSubmission(request, token, {
        supplierEntityId: supplierId,
        statementId: overdueStatementId,
        originCountry: 'BR',
        stamp: `${stamp}-overdue`,
      }))
      assessmentIds.push(await createRiskAssessment(request, token, overdueStatementId, {
        reviewDueAt: isoDaysAgo(1),
      }))
      const overdueSubmitResponse = await updateStatement(request, token, { id: overdueStatementId, status: 'submitted' })
      await expectGateReason(overdueSubmitResponse, 'eudr.gate.riskReviewOverdue')

      const simplifiedStatementId = await createStatement(request, token, `TC-EUDR-007 Simplified ${stamp}`)
      statementIds.push(simplifiedStatementId)
      submissionIds.push(await createCompleteVerifiedSubmission(request, token, {
        supplierEntityId: supplierId,
        statementId: simplifiedStatementId,
        originCountry: 'DE',
        stamp: `${stamp}-DE`,
      }))
      const simplifiedSubmitResponse = await updateStatement(request, token, { id: simplifiedStatementId, status: 'submitted' })
      expect(simplifiedSubmitResponse.status(), `simplified low-risk submit failed: ${simplifiedSubmitResponse.status()}`).toBe(200)

      const smeWithoutReferencesId = await createStatement(request, token, `TC-EUDR-007 SME missing ref ${stamp}`, {
        actorRole: 'sme_trader',
      })
      statementIds.push(smeWithoutReferencesId)
      const smeWithoutReferencesResponse = await updateStatement(request, token, { id: smeWithoutReferencesId, status: 'submitted' })
      await expectGateReason(smeWithoutReferencesResponse, 'eudr.gate.referencedStatementsRequired')

      const smeStatementId = await createStatement(request, token, `TC-EUDR-007 SME ok ${stamp}`, {
        actorRole: 'sme_trader',
        referencedStatements: [{ referenceNumber: '25TESTREF001' }],
      })
      statementIds.push(smeStatementId)
      const smeSubmitResponse = await updateStatement(request, token, { id: smeStatementId, status: 'submitted' })
      expect(smeSubmitResponse.status(), `SME trader referenced submit failed: ${smeSubmitResponse.status()}`).toBe(200)
    } finally {
      for (const id of assessmentIds.reverse()) await deleteByCrudPath(request, token, RISK_ASSESSMENTS_PATH, id)
      for (const id of submissionIds.reverse()) await deleteByCrudPath(request, token, EVIDENCE_SUBMISSIONS_PATH, id)
      for (const id of statementIds.reverse()) await deleteByCrudPath(request, token, STATEMENTS_PATH, id)
      await deleteByCrudPath(request, token, PRODUCT_MAPPINGS_PATH, mappingId)
      await deleteEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })

  test('enforces availability reference numbers, amendment windows, withdrawal, and downstream references', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomUUID()}`
    const statementIds: string[] = []
    const submissionIds: string[] = []
    const assessmentIds: string[] = []
    let supplierId: string | null = null
    let mappingId: string | null = null

    try {
      supplierId = await createCompanyFixture(request, token, `TC-EUDR-007 Supplier C ${stamp}`)
      mappingId = await createProductMapping(request, token, `${stamp}-C`)

      const submitted = await createSubmittedStatement(request, token, {
        supplierEntityId: supplierId,
        title: `TC-EUDR-007 Available gate ${stamp}`,
        stamp: `${stamp}-available`,
        // Seed a quantity so the post-window unchanged-echo regression below
        // exercises the numeric scale-padding comparison ('1500' vs '1500.000').
        statementOverrides: { quantityKg: 1500 },
      })
      statementIds.push(submitted.statementId)
      submissionIds.push(submitted.submissionId)
      if (submitted.assessmentId) assessmentIds.push(submitted.assessmentId)

      const availableWithoutReferencesResponse = await updateStatement(request, token, {
        id: submitted.statementId,
        status: 'available',
      })
      await expectGateReason(availableWithoutReferencesResponse, 'eudr.gate.referenceNumbersRequired')

      const oldReferenceIssuedAt = isoHoursAgo(100)
      const availableResponse = await updateStatement(request, token, {
        id: submitted.statementId,
        status: 'available',
        referenceNumber: `25TC007OLD${stamp.slice(0, 8)}`,
        verificationNumber: `VER-TC007-OLD-${stamp.slice(0, 8)}`,
        referenceIssuedAt: oldReferenceIssuedAt,
      })
      expect(availableResponse.status(), `available transition with references failed: ${availableResponse.status()}`).toBe(200)

      const elapsedAmendResponse = await updateStatement(request, token, {
        id: submitted.statementId,
        quantityKg: 1600,
      })
      await expectErrorKey(elapsedAmendResponse, 'amendWindowElapsed')

      // Regression: an unchanged numeric echo (PG returns scale-padded numerics,
      // e.g. '100.000') must NOT count as an amendment — non-guarded fields stay
      // editable after the window.
      const echoStatement = await readStatementById(request, token, submitted.statementId)
      expect(echoStatement?.quantityKg, 'fixture statement should carry a quantity for the echo check').not.toBeNull()
      const echoResponse = await updateStatement(request, token, {
        id: submitted.statementId,
        quantityKg: Number(echoStatement?.quantityKg),
        notes: `still editable after window ${stamp}`,
      })
      expect(echoResponse.status(), `unchanged numeric echo should not trip the amend guard: ${echoResponse.status()}`).toBe(200)

      const immutableIssuedAtResponse = await updateStatement(request, token, {
        id: submitted.statementId,
        referenceIssuedAt: new Date().toISOString(),
      })
      await expectErrorKey(immutableIssuedAtResponse, 'referenceIssuedAtImmutable')

      const fresh = await createSubmittedStatement(request, token, {
        supplierEntityId: supplierId,
        title: `TC-EUDR-007 Fresh available ${stamp}`,
        stamp: `${stamp}-fresh`,
      })
      statementIds.push(fresh.statementId)
      submissionIds.push(fresh.submissionId)
      if (fresh.assessmentId) assessmentIds.push(fresh.assessmentId)
      const freshAvailableResponse = await updateStatement(request, token, {
        id: fresh.statementId,
        status: 'available',
        referenceNumber: `25TC007NEW${stamp.slice(0, 8)}`,
        verificationNumber: `VER-TC007-NEW-${stamp.slice(0, 8)}`,
        referenceIssuedAt: new Date().toISOString(),
      })
      expect(freshAvailableResponse.status(), `fresh available transition failed: ${freshAvailableResponse.status()}`).toBe(200)
      const freshAmendResponse = await updateStatement(request, token, {
        id: fresh.statementId,
        quantityKg: 1700,
      })
      expect(freshAmendResponse.status(), `fresh amendment inside window failed: ${freshAmendResponse.status()}`).toBe(200)
      const withdrawnResponse = await updateStatement(request, token, { id: fresh.statementId, status: 'withdrawn' })
      expect(withdrawnResponse.status(), `withdraw available statement failed: ${withdrawnResponse.status()}`).toBe(200)

      const referenceNumber = `25TC007REF${stamp.slice(0, 8)}`
      const upstream = await createSubmittedStatement(request, token, {
        supplierEntityId: supplierId,
        title: `TC-EUDR-007 Upstream ${stamp}`,
        stamp: `${stamp}-upstream`,
      })
      statementIds.push(upstream.statementId)
      submissionIds.push(upstream.submissionId)
      if (upstream.assessmentId) assessmentIds.push(upstream.assessmentId)
      const upstreamAvailableResponse = await updateStatement(request, token, {
        id: upstream.statementId,
        status: 'available',
        referenceNumber,
        verificationNumber: `VER-${referenceNumber}`,
        referenceIssuedAt: new Date().toISOString(),
      })
      expect(upstreamAvailableResponse.status(), `upstream available transition failed: ${upstreamAvailableResponse.status()}`).toBe(200)

      const downstreamId = await createStatement(request, token, `TC-EUDR-007 Downstream ${stamp}`, {
        referencedStatements: [{ referenceNumber }],
      })
      statementIds.push(downstreamId)

      const referencedWithdrawResponse = await updateStatement(request, token, {
        id: upstream.statementId,
        status: 'withdrawn',
      })
      await expectErrorKey(referencedWithdrawResponse, 'referencedDownstream')
    } finally {
      for (const id of assessmentIds.reverse()) await deleteByCrudPath(request, token, RISK_ASSESSMENTS_PATH, id)
      for (const id of submissionIds.reverse()) await deleteByCrudPath(request, token, EVIDENCE_SUBMISSIONS_PATH, id)
      for (const id of statementIds.reverse()) await deleteByCrudPath(request, token, STATEMENTS_PATH, id)
      await deleteByCrudPath(request, token, PRODUCT_MAPPINGS_PATH, mappingId)
      await deleteEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })

  test('keeps archived statements read-only and exposes latest risk on statement lists', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomUUID()}`
    const statementIds: string[] = []
    const submissionIds: string[] = []
    const assessmentIds: string[] = []
    let supplierId: string | null = null
    let mappingId: string | null = null

    try {
      supplierId = await createCompanyFixture(request, token, `TC-EUDR-007 Supplier D ${stamp}`)
      mappingId = await createProductMapping(request, token, `${stamp}-D`)

      const archivedStatementId = await createStatement(request, token, `TC-EUDR-007 Archive ${stamp}`)
      statementIds.push(archivedStatementId)
      const archiveResponse = await updateStatement(request, token, { id: archivedStatementId, status: 'archived' })
      expect(archiveResponse.status(), `archive statement failed: ${archiveResponse.status()}`).toBe(200)
      const archivedEditResponse = await updateStatement(request, token, {
        id: archivedStatementId,
        title: `TC-EUDR-007 Archive edited ${stamp}`,
      })
      await expectErrorKey(archivedEditResponse, 'archivedReadOnly')
      const archivedReopenResponse = await updateStatement(request, token, { id: archivedStatementId, status: 'draft' })
      await expectErrorKey(archivedReopenResponse, 'invalidTransition')

      const assessedStatementId = await createStatement(request, token, `TC-EUDR-007 Latest risk ${stamp}`)
      statementIds.push(assessedStatementId)
      submissionIds.push(await createCompleteVerifiedSubmission(request, token, {
        supplierEntityId: supplierId,
        statementId: assessedStatementId,
        originCountry: 'BR',
        stamp: `${stamp}-risk`,
      }))
      assessmentIds.push(await createRiskAssessment(request, token, assessedStatementId))

      const unassessedStatementId = await createStatement(request, token, `TC-EUDR-007 No risk ${stamp}`)
      statementIds.push(unassessedStatementId)

      const statements = await readStatementsByIds(request, token, [assessedStatementId, unassessedStatementId])
      const assessed = statements.find((item) => item.id === assessedStatementId)
      const unassessed = statements.find((item) => item.id === unassessedStatementId)
      expect(assessed?.latestRisk).toEqual(expect.objectContaining({
        conclusion: 'negligible',
        overallTier: 'standard',
      }))
      expect(unassessed?.latestRisk ?? null).toBeNull()
    } finally {
      for (const id of assessmentIds.reverse()) await deleteByCrudPath(request, token, RISK_ASSESSMENTS_PATH, id)
      for (const id of submissionIds.reverse()) await deleteByCrudPath(request, token, EVIDENCE_SUBMISSIONS_PATH, id)
      for (const id of statementIds.reverse()) await deleteByCrudPath(request, token, STATEMENTS_PATH, id)
      await deleteByCrudPath(request, token, PRODUCT_MAPPINGS_PATH, mappingId)
      await deleteEntityIfExists(request, token, CUSTOMERS_COMPANIES_PATH, supplierId)
    }
  })
})
