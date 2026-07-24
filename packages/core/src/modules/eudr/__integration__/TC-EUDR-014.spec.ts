import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteUserAclInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = {
  dependsOnModules: ['eudr'],
}

const STATEMENTS_PATH = '/api/eudr/statements'
const RISK_PATH = '/api/eudr/risk-assessments'
const MITIGATION_PATH = '/api/eudr/mitigation-actions'
const ANNUAL_PATH = '/api/eudr/reports/annual'

type AnnualReport = {
  year?: number
  statements?: {
    total?: number
    byStatus?: Record<string, number>
    byCommodity?: Array<{
      commodity?: string
      count?: number
      quantityKg?: string | number | null
      supplementaryQuantities?: Array<{ unit?: string; quantity?: string }>
    }>
  }
  countries?: unknown
  risk?: unknown
  mitigation?: unknown
}

async function createStatement(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', STATEMENTS_PATH, { token, data })
  expect(response.status(), `create statement failed: ${response.status()}`).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  return expectId(body?.id, 'Statement create response should include id')
}

async function submitViaSmeTraderPath(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', STATEMENTS_PATH, {
    token,
    data: { id, status: 'submitted' },
  })
  expect(response.status(), `sme-trader submit failed: ${response.status()}`).toBe(200)
}

async function makeAvailableAndWithdraw(
  request: APIRequestContext,
  token: string,
  id: string,
  referenceNumber: string,
): Promise<void> {
  await makeAvailable(request, token, id, referenceNumber)
  const withdrawnResponse = await apiRequest(request, 'PUT', STATEMENTS_PATH, {
    token,
    data: { id, status: 'withdrawn' },
  })
  expect(withdrawnResponse.status(), `withdraw transition failed: ${withdrawnResponse.status()}`).toBe(200)
}

async function backdateSubmittedAt(id: string, isoTimestamp: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      'update eudr_due_diligence_statements set submitted_at = $2 where id = $1',
      [id, isoTimestamp],
    )
  })
}

async function setReferenceIssuedAt(id: string, isoTimestamp: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      'update eudr_due_diligence_statements set reference_issued_at = $2 where id = $1',
      [id, isoTimestamp],
    )
  })
}

async function makeAvailable(
  request: APIRequestContext,
  token: string,
  id: string,
  referenceNumber: string,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', STATEMENTS_PATH, {
    token,
    data: {
      id,
      status: 'available',
      referenceNumber,
      verificationNumber: `VER-${referenceNumber}`,
    },
  })
  expect(response.status(), `available transition failed: ${response.status()}`).toBe(200)
}

async function deleteStatementIfExists(
  request: APIRequestContext,
  token: string | null,
  id: string | null,
): Promise<void> {
  if (!token || !id) return
  await apiRequest(request, 'DELETE', `${STATEMENTS_PATH}?id=${encodeURIComponent(id)}`, { token }).catch(() => undefined)
}

/**
 * TC-EUDR-014: Art. 12(3) annual due-diligence report.
 *
 * Fixtures: one draft statement (must never appear), two submitted statements
 * and one withdrawn statement in the current year via the SME-trader gate path
 * (distinct supplementary units incl. a malicious formula-shaped unit), one
 * submitted statement backdated to the previous year directly in Postgres
 * (submitted_at is server-stamped, so API fixtures cannot cross years).
 *
 * Asserts year bucketing, per-unit supplementary grouping, CSV delivery with
 * neutralized formula cell, the empty-year shape, and the auth gates.
 */
test.describe('TC-EUDR-014: annual due-diligence report', () => {
  test('buckets by submitted year, groups supplementary units, serializes safe CSV', async ({ request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const currentYear = new Date().getUTCFullYear()
    const priorYear = currentYear - 1
    const maliciousUnit = '=SUM(A1:B2)'
    const smeBase = {
      commodity: 'cocoa' as const,
      actorRole: 'sme_trader',
      referencedStatements: [{ referenceNumber: `UPSTREAM${stamp.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}` }],
    }
    let draftId: string | null = null
    let submittedAId: string | null = null
    let submittedBId: string | null = null
    let withdrawnId: string | null = null
    let priorYearId: string | null = null
    let riskId: string | null = null
    let mitigationId: string | null = null
    let noFeatureUserId: string | null = null
    let statementsOnlyUserId: string | null = null
    let availableElapsedId: string | null = null
    let upstreamDdsId: string | null = null
    let downstreamDdsId: string | null = null

    try {
      draftId = await createStatement(request, token, {
        title: `TC-EUDR-014 Draft ${stamp}`,
        commodity: 'cocoa',
      })
      submittedAId = await createStatement(request, token, {
        ...smeBase,
        title: `TC-EUDR-014 A ${stamp}`,
        quantityKg: 100,
        supplementaryUnit: 'M3',
        supplementaryQuantity: 1.25,
      })
      submittedBId = await createStatement(request, token, {
        ...smeBase,
        title: `TC-EUDR-014 B ${stamp}`,
        quantityKg: 50,
        supplementaryUnit: maliciousUnit,
        supplementaryQuantity: 2,
      })
      withdrawnId = await createStatement(request, token, {
        ...smeBase,
        title: `TC-EUDR-014 Withdrawn ${stamp}`,
        quantityKg: 25,
      })
      priorYearId = await createStatement(request, token, {
        ...smeBase,
        title: `TC-EUDR-014 Prior ${stamp}`,
        quantityKg: 10,
      })
      await submitViaSmeTraderPath(request, token, submittedAId)
      await submitViaSmeTraderPath(request, token, submittedBId)
      await submitViaSmeTraderPath(request, token, withdrawnId)
      const withdrawnReference = `TC14W${stamp.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`.toUpperCase()
      await makeAvailableAndWithdraw(request, token, withdrawnId, withdrawnReference)
      await submitViaSmeTraderPath(request, token, priorYearId)
      await backdateSubmittedAt(priorYearId, `${priorYear}-06-15T12:00:00.000Z`)

      const riskResponse = await apiRequest(request, 'POST', RISK_PATH, {
        token,
        data: { statementId: submittedAId, criteria: {}, conclusion: 'non_negligible' },
      })
      expect(riskResponse.status(), `risk fixture failed: ${riskResponse.status()}`).toBe(201)
      riskId = expectId((await readJsonSafe<{ id?: string }>(riskResponse))?.id, 'risk id')
      const mitigationResponse = await apiRequest(request, 'POST', MITIGATION_PATH, {
        token,
        data: { riskAssessmentId: riskId, title: `TC-EUDR-014 Action ${stamp}`, status: 'completed' },
      })
      expect(mitigationResponse.status(), `mitigation fixture failed: ${mitigationResponse.status()}`).toBe(201)
      mitigationId = expectId((await readJsonSafe<{ id?: string }>(mitigationResponse))?.id, 'mitigation id')

      const currentResponse = await apiRequest(request, 'GET', `${ANNUAL_PATH}?year=${currentYear}`, { token })
      expect(currentResponse.status(), `annual report failed: ${currentResponse.status()}`).toBe(200)
      const current = await readJsonSafe<AnnualReport>(currentResponse)
      expect(current?.year).toBe(currentYear)
      const byStatus = current?.statements?.byStatus ?? {}
      expect(byStatus.draft ?? 0, 'drafts must never enter the annual report').toBe(0)
      expect(byStatus.withdrawn ?? 0, 'withdrawn statements remain in the annual report').toBeGreaterThanOrEqual(1)
      expect(
        current?.statements?.total ?? 0,
        'statement total should include the two submitted fixtures and the withdrawn fixture',
      ).toBeGreaterThanOrEqual(3)
      expect(
        current?.statements?.total ?? 0,
        'statement total should include every status bucket, including withdrawn',
      ).toBe(Object.values(byStatus).reduce((total, count) => total + count, 0))
      const cocoa = (current?.statements?.byCommodity ?? []).find((row) => row.commodity === 'cocoa')
      expect(cocoa, 'cocoa bucket should exist').toBeTruthy()
      expect(cocoa?.count ?? 0).toBeGreaterThanOrEqual(2)
      const supplementaryQuantities = cocoa?.supplementaryQuantities ?? []
      const units = supplementaryQuantities.map((entry) => entry.unit)
      expect(units, 'per-unit grouping should keep distinct units apart').toEqual(
        expect.arrayContaining(['M3', maliciousUnit.toUpperCase()]),
      )
      expect(supplementaryQuantities.find((entry) => entry.unit === 'M3')?.quantity).toBe('1.250')
      expect(
        supplementaryQuantities.find((entry) => entry.unit === maliciousUnit.toUpperCase())?.quantity,
      ).toBe('2.000')
      const riskBlock = current?.risk as { nonNegligible?: number } | undefined
      expect(riskBlock, 'risk block present for a full-feature caller').toBeTruthy()
      expect(riskBlock?.nonNegligible ?? 0, 'latest non-negligible assessment counted').toBeGreaterThanOrEqual(1)
      const mitigationBlock = current?.mitigation as { total?: number; completed?: number } | undefined
      expect(mitigationBlock?.completed ?? 0, 'completed mitigation counted').toBeGreaterThanOrEqual(1)

      const priorResponse = await apiRequest(request, 'GET', `${ANNUAL_PATH}?year=${priorYear}`, { token })
      expect(priorResponse.status()).toBe(200)
      const prior = await readJsonSafe<AnnualReport>(priorResponse)
      const priorTotal = prior?.statements?.total ?? 0
      expect(priorTotal, 'backdated statement should appear in the prior-year report').toBeGreaterThanOrEqual(1)

      const csvResponse = await apiRequest(request, 'GET', `${ANNUAL_PATH}?year=${currentYear}&format=csv`, { token })
      expect(csvResponse.status()).toBe(200)
      expect(csvResponse.headers()['content-type'] ?? '').toContain('text/csv')
      const csv = await csvResponse.text()
      expect(csv.split('\n')[0]).toContain('commodity')
      expect(csv, 'formula-shaped unit must be neutralized with a leading apostrophe').toContain("'=SUM")
      expect(csv, 'raw formula cell must not appear unneutralized').not.toMatch(/(^|,)"?=SUM/m)

      const emptyResponse = await apiRequest(request, 'GET', `${ANNUAL_PATH}?year=2021`, { token })
      expect(emptyResponse.status(), 'empty year must be a valid report, not 404').toBe(200)
      const empty = await readJsonSafe<AnnualReport>(emptyResponse)
      expect(empty?.statements?.total ?? -1).toBe(0)

      const invalidResponse = await apiRequest(request, 'GET', `${ANNUAL_PATH}?year=1999`, { token })
      expect(invalidResponse.status()).toBe(400)

      const anonymousResponse = await request.get(`${ANNUAL_PATH}?year=${currentYear}`)
      expect(anonymousResponse.status(), 'tokenless call must be rejected').toBe(401)

      const scope = getTokenContext(token)
      const noFeatureEmail = `tc-eudr-014-nofeature-${stamp}@example.com`
      noFeatureUserId = await createUserFixture(request, token, {
        email: noFeatureEmail,
        password: 'Valid1!Pass',
        organizationId: scope.organizationId,
        roles: ['employee'],
      })
      await setUserAclInDb({
        userId: noFeatureUserId,
        tenantId: scope.tenantId,
        features: ['notifications.view'],
        organizations: null,
      })
      const noFeatureToken = await getAuthToken(request, noFeatureEmail, 'Valid1!Pass')
      const forbiddenResponse = await apiRequest(request, 'GET', `${ANNUAL_PATH}?year=${currentYear}`, { token: noFeatureToken })
      expect(forbiddenResponse.status(), 'caller without eudr.statements.view must be rejected').toBe(403)

      const adminStatementRead = await apiRequest(request, 'GET', `${STATEMENTS_PATH}?id=${encodeURIComponent(submittedAId)}`, { token })
      expect(adminStatementRead.status()).toBe(200)
      const adminStatementBody = await readJsonSafe<{ items?: Array<{ latestRisk?: { conclusion?: string } }> }>(adminStatementRead)
      expect(
        adminStatementBody?.items?.[0]?.latestRisk?.conclusion,
        'risk-capable caller sees the latest assessment projection',
      ).toBe('non_negligible')

      const statementsOnlyEmail = `tc-eudr-014-stmts-${stamp}@example.com`
      statementsOnlyUserId = await createUserFixture(request, token, {
        email: statementsOnlyEmail,
        password: 'Valid1!Pass',
        organizationId: scope.organizationId,
        roles: ['employee'],
      })
      await setUserAclInDb({
        userId: statementsOnlyUserId,
        tenantId: scope.tenantId,
        features: ['eudr.statements.view'],
        organizations: null,
      })
      const statementsOnlyToken = await getAuthToken(request, statementsOnlyEmail, 'Valid1!Pass')
      const gatedStatementRead = await apiRequest(request, 'GET', `${STATEMENTS_PATH}?id=${encodeURIComponent(submittedAId)}`, { token: statementsOnlyToken })
      expect(gatedStatementRead.status(), 'statements.view alone still reads the statement').toBe(200)
      const gatedStatementBody = await readJsonSafe<{ items?: Array<{ id?: string; latestRisk?: unknown }> }>(gatedStatementRead)
      expect(gatedStatementBody?.items?.[0]?.id).toBe(submittedAId)
      expect(
        gatedStatementBody?.items?.[0]?.latestRisk,
        'caller without eudr.risk.view must not receive the latestRisk projection',
      ).toBeUndefined()

      availableElapsedId = await createStatement(request, token, {
        ...smeBase,
        title: `TC-EUDR-014 Elapsed ${stamp}`,
        quantityKg: 5,
      })
      await submitViaSmeTraderPath(request, token, availableElapsedId)
      const elapsedReference = `TC14EL${stamp.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`.toUpperCase()
      await makeAvailable(request, token, availableElapsedId, elapsedReference)
      await setReferenceIssuedAt(availableElapsedId, new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString())
      const elapsedDelete = await apiRequest(request, 'DELETE', `${STATEMENTS_PATH}?id=${encodeURIComponent(availableElapsedId)}`, { token })
      expect(elapsedDelete.status(), 'deleting an available statement after the amend window must fail').toBe(400)
      const elapsedDeleteBody = await readJsonSafe<{ error?: string }>(elapsedDelete)
      expect(elapsedDeleteBody?.error ?? '').toContain('amendWindowElapsed')
      const elapsedStillReadable = await apiRequest(request, 'GET', `${STATEMENTS_PATH}?id=${encodeURIComponent(availableElapsedId)}`, { token })
      const elapsedReadBody = await readJsonSafe<{ items?: Array<{ id?: string }> }>(elapsedStillReadable)
      expect(elapsedReadBody?.items?.[0]?.id, 'blocked delete must leave the statement readable').toBe(availableElapsedId)

      upstreamDdsId = await createStatement(request, token, {
        ...smeBase,
        title: `TC-EUDR-014 Upstream ${stamp}`,
        quantityKg: 5,
      })
      await submitViaSmeTraderPath(request, token, upstreamDdsId)
      const upstreamReference = `TC14UP${stamp.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`.toUpperCase()
      await makeAvailable(request, token, upstreamDdsId, upstreamReference)
      downstreamDdsId = await createStatement(request, token, {
        title: `TC-EUDR-014 Downstream ${stamp}`,
        commodity: 'cocoa',
        referencedStatements: [{ referenceNumber: upstreamReference }],
      })
      const referencedDelete = await apiRequest(request, 'DELETE', `${STATEMENTS_PATH}?id=${encodeURIComponent(upstreamDdsId)}`, { token })
      expect(referencedDelete.status(), 'deleting an available statement referenced downstream must fail').toBe(400)
      const referencedDeleteBody = await readJsonSafe<{ error?: string }>(referencedDelete)
      expect(referencedDeleteBody?.error ?? '').toContain('referencedDownstream')
      const downstreamCleanup = await apiRequest(request, 'DELETE', `${STATEMENTS_PATH}?id=${encodeURIComponent(downstreamDdsId)}`, { token })
      expect(downstreamCleanup.status(), 'draft downstream statement should delete cleanly').toBe(200)
      downstreamDdsId = null
      const unreferencedDelete = await apiRequest(request, 'DELETE', `${STATEMENTS_PATH}?id=${encodeURIComponent(upstreamDdsId)}`, { token })
      expect(
        unreferencedDelete.status(),
        'an in-window, unreferenced available statement must remain deletable',
      ).toBe(200)
      upstreamDdsId = null
    } finally {
      await deleteUserIfExists(request, token, noFeatureUserId)
      if (noFeatureUserId) await deleteUserAclInDb(noFeatureUserId)
      await deleteUserIfExists(request, token, statementsOnlyUserId)
      if (statementsOnlyUserId) await deleteUserAclInDb(statementsOnlyUserId)
      if (availableElapsedId) {
        await setReferenceIssuedAt(availableElapsedId, new Date().toISOString()).catch(() => undefined)
      }
      await deleteStatementIfExists(request, token, availableElapsedId)
      await deleteStatementIfExists(request, token, downstreamDdsId)
      await deleteStatementIfExists(request, token, upstreamDdsId)
      if (mitigationId) await apiRequest(request, 'DELETE', `${MITIGATION_PATH}?id=${encodeURIComponent(mitigationId)}`, { token }).catch(() => undefined)
      if (riskId) await apiRequest(request, 'DELETE', `${RISK_PATH}?id=${encodeURIComponent(riskId)}`, { token }).catch(() => undefined)
      await deleteStatementIfExists(request, token, draftId)
      await deleteStatementIfExists(request, token, submittedAId)
      await deleteStatementIfExists(request, token, submittedBId)
      await deleteStatementIfExists(request, token, withdrawnId)
      await deleteStatementIfExists(request, token, priorYearId)
    }
  })
})
