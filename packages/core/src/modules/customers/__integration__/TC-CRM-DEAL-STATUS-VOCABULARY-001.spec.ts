import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createCompanyFixture,
  createDealFixture,
  createPersonFixture,
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { DEAL_STATUS_RECLASSIFICATION_CODE, DEAL_STATUS_RECLASSIFICATION_HEADER, dealStatusReclassificationErrorSchema } from '../data/dealStatusVocabulary'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const SETTINGS_PATH = '/api/customers/settings/deal-status-vocabulary'
const VOCABULARY = { won: ['acquired', 'delivered'], lost: ['declined'], closed: ['finished'] }
const DEFAULT_VOCABULARY = { won: ['win', 'won'], lost: ['lost', 'loose'], closed: ['closed'] }

type Vocabulary = typeof VOCABULARY
type Settings = { vocabulary: Vocabulary; source: 'tenant' | 'env' | 'default'; updatedAt: string | null }
type Deal = { id: string; status: string; closureOutcome: 'won' | 'lost' | null; lossNotes: string | null; updatedAt: string }
type Fixture = { path: string; id: string; bodyDelete?: boolean }

async function readSettings(request: APIRequestContext, token: string, suffix = ''): Promise<Settings> {
  const response = await apiRequest(request, 'GET', `${SETTINGS_PATH}${suffix}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<Settings>(response)
  expect(body).not.toBeNull()
  return body!
}

async function saveSettings(
  request: APIRequestContext,
  token: string,
  vocabulary: Vocabulary | null,
  updatedAt?: string | null,
): Promise<Settings> {
  let response = await apiRequest(request, 'PUT', SETTINGS_PATH, {
    token, data: { vocabulary }, headers: updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt } : {},
  })
  if (response.status() === 409) {
    const preview = dealStatusReclassificationErrorSchema.safeParse(await readJsonSafe(response))
    if (preview.success) response = await apiRequest(request, 'PUT', SETTINGS_PATH, {
      token,
      data: { vocabulary, reclassificationConfirmation: { fingerprint: preview.data.impact.fingerprint } },
      headers: updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt } : {},
    })
  }
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<Settings>(response)
  expect(body).not.toBeNull()
  return body!
}

async function readDeal(request: APIRequestContext, token: string, dealId: string): Promise<Deal> {
  const response = await apiRequest(request, 'GET', `/api/customers/deals/${dealId}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ deal: Deal }>(response)
  expect(body?.deal).toBeTruthy()
  return body!.deal
}

async function readDealSnapshot(request: APIRequestContext, token: string, dealId: string) {
  const deal = await readDeal(request, token, dealId)
  return { status: deal.status, closureOutcome: deal.closureOutcome, lossNotes: deal.lossNotes, updatedAt: deal.updatedAt }
}

async function expectStatusFilter(request: APIRequestContext, token: string, companyId: string, status: string, expectedIds: string[]) {
  const query = new URLSearchParams({ companyId, status, pageSize: '100' })
  const response = await apiRequest(request, 'GET', `/api/customers/deals?${query}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items: Array<{ id: string }>; total: number }>(response)
  expect(body?.items.map((item) => item.id).sort()).toEqual([...expectedIds].sort())
  expect(body?.total).toBe(expectedIds.length)
}

async function expectCompanyClassification(request: APIRequestContext, token: string, companyId: string, activeDealsCount: number, completedDealsCount: number) {
  const response = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ kpis: { activeDealsCount: number; completedDealsCount: number } }>(response)
  expect(body?.kpis).toMatchObject({ activeDealsCount, completedDealsCount })
}

async function cleanupFixtures(request: APIRequestContext, token: string, fixtures: Fixture[]): Promise<void> {
  for (const fixture of fixtures.reverse()) {
    if (fixture.bodyDelete) await deleteEntityByBody(request, token, fixture.path, fixture.id)
    else await deleteEntityIfExists(request, token, fixture.path, fixture.id)
  }
}

test.describe('TC-CRM-DEAL-STATUS-VOCABULARY-001: tenant vocabulary', () => {
  let superToken = ''
  let otherTenantToken = ''
  let managerToken = ''
  let viewerToken = ''
  let tenantId: string | null = null
  let organizationId: string | null = null
  let roleId: string | null = null
  let managerId: string | null = null
  let viewerId: string | null = null
  let managerEmail = ''
  let fixturePassword = ''

  async function setViewerFeatures(request: APIRequestContext, features: string[]): Promise<void> {
    const response = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
      token: superToken,
      data: { userId: viewerId, tenantId, organizations: [organizationId], features },
    })
    expect(response.status()).toBe(200)
    expect((await readJsonSafe<{ ok: boolean }>(response))?.ok).toBe(true)
    const storedResponse = await apiRequest(request, 'GET', `/api/auth/users/acl?userId=${viewerId}&tenantId=${tenantId}`, { token: superToken })
    expect(storedResponse.status()).toBe(200)
    const stored = await readJsonSafe<{ hasCustomAcl: boolean; features: string[]; organizations: string[] }>(storedResponse)
    expect(stored?.hasCustomAcl).toBe(true)
    expect(stored?.features).toEqual(features)
    expect(stored?.organizations).toEqual([organizationId])
  }

  test.beforeAll(async ({ request }) => {
    const stamp = randomUUID()
    fixturePassword = `Vocabulary-${randomUUID()}-9!`
    superToken = await getAuthToken(request, 'superadmin')
    otherTenantToken = await getAuthToken(request, 'admin')
    const response = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token: superToken,
      data: { name: `Deal vocabulary ${stamp}` },
    })
    expect(response.status()).toBe(201)
    tenantId = expectId((await readJsonSafe<{ id: string }>(response))?.id, 'Tenant fixture has an id')
    organizationId = await createOrganizationFixture(request, superToken, { name: `Vocabulary ${stamp}`, tenantId })
    roleId = await createRoleFixture(request, superToken, { name: `Vocabulary manager ${stamp}`, tenantId })
    await setRoleAclFeatures(request, superToken, { roleId, features: ['customers.*', 'audit_logs.undo_self', 'audit_logs.view_self'], organizations: null })
    managerEmail = `vocabulary-manager-${stamp}@example.com`
    managerId = await createUserFixture(request, superToken, {
      email: managerEmail, password: fixturePassword, organizationId, roles: [roleId],
    })
    const viewerEmail = `vocabulary-viewer-${stamp}@example.com`
    viewerId = await createUserFixture(request, superToken, {
      email: viewerEmail, password: fixturePassword, organizationId, roles: [],
    })
    await setViewerFeatures(request, ['customers.deals.view'])
    managerToken = await getAuthToken(request, managerEmail, fixturePassword)
    viewerToken = await getAuthToken(request, viewerEmail, fixturePassword)
    expect(getTokenContext(managerToken).tenantId).toBe(tenantId)
    expect(getTokenContext(viewerToken)).toEqual(getTokenContext(managerToken))
    expect(getTokenContext(otherTenantToken).tenantId).not.toBe(tenantId)
  })

  test.beforeEach(async ({ request }) => {
    await saveSettings(request, managerToken, null)
  })

  test.afterEach(async ({ request }) => {
    if (managerToken) await saveSettings(request, managerToken, null)
  })

  test.afterAll(async ({ request }) => {
    await deleteUserIfExists(request, superToken, viewerId)
    await deleteUserIfExists(request, superToken, managerId)
    await deleteRoleIfExists(request, superToken, roleId)
    await deleteOrganizationIfExists(request, superToken, organizationId)
    await deleteEntityByBody(request, superToken, '/api/directory/tenants', tenantId)
  })

  test('saves, rejects stale writes, and resets while retaining a record version', async ({ request }) => {
    const baseline = await readSettings(request, managerToken)
    expect(['env', 'default']).toContain(baseline.source)
    if (baseline.source === 'default') expect(baseline.vocabulary).toEqual(DEFAULT_VOCABULARY)
    const saved = await saveSettings(request, managerToken, VOCABULARY, baseline.updatedAt)
    expect(saved.source).toBe('tenant')
    expect(saved.updatedAt).toEqual(expect.any(String))
    expect((await readSettings(request, managerToken)).vocabulary).toEqual(VOCABULARY)

    const replacement = { ...VOCABULARY, won: ['delivered', 'acquired'] }
    const newer = await saveSettings(request, managerToken, replacement, saved.updatedAt)
    const stale = await apiRequest(request, 'PUT', SETTINGS_PATH, {
      token: managerToken,
      data: { vocabulary: VOCABULARY },
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: saved.updatedAt! },
    })
    expect(stale.status()).toBe(409)
    expect((await readSettings(request, managerToken)).vocabulary).toEqual(replacement)

    const reset = await saveSettings(request, managerToken, null, newer.updatedAt)
    expect(reset.source).toBe(baseline.source)
    expect(reset.vocabulary).toEqual(baseline.vocabulary)
    expect(reset.updatedAt).toEqual(expect.any(String))
    const staleAfterReset = await apiRequest(request, 'PUT', SETTINGS_PATH, {
      token: managerToken,
      data: { vocabulary: VOCABULARY },
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: newer.updatedAt! },
    })
    expect(staleAfterReset.status()).toBe(409)
    expect((await saveSettings(request, managerToken, VOCABULARY, reset.updatedAt)).source).toBe('tenant')
  })

  test('rejects empty, overlapping, reserved and reassigned historical aliases', async ({ request }) => {
    const invalidVocabularies = [
      { ...VOCABULARY, won: [] },
      { ...VOCABULARY, lost: ['ACQUIRED'] },
      { ...VOCABULARY, won: ['open'] },
      { ...VOCABULARY, won: ['lost'] },
      { ...VOCABULARY, won: ['acquired', 'ACQUIRED'] },
    ]
    const baseline = await readSettings(request, managerToken)
    for (const vocabulary of invalidVocabularies) {
      const response = await apiRequest(request, 'PUT', SETTINGS_PATH, { token: managerToken, data: { vocabulary } })
      expect(response.status()).toBe(400)
    }
    expect(await readSettings(request, managerToken)).toEqual(baseline)
  })

  test('allows exactly one of two simultaneous writes with the same version', async ({ request }) => {
    const current = await saveSettings(request, managerToken, VOCABULARY)
    const alternatives = [
      { ...VOCABULARY, won: ['delivered', 'acquired'] },
      { ...VOCABULARY, closed: ['archived', 'finished'] },
    ]
    const responses = await Promise.all(alternatives.map((vocabulary) => apiRequest(request, 'PUT', SETTINGS_PATH, {
      token: managerToken,
      data: { vocabulary },
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: current.updatedAt! },
    })))
    expect(responses.map((response) => response.status()).sort()).toEqual([200, 409])
    const winner = responses.find((response) => response.status() === 200)!
    const saved = await readJsonSafe<Settings>(winner)
    expect((await readSettings(request, managerToken)).vocabulary).toEqual(saved?.vocabulary)
  })

  test('enforces view/manage permissions and isolates authenticated tenant scope', async ({ request }) => {
    await withCredentialIsolatedRequest(async (anonymous) => {
      expect((await anonymous.get(SETTINGS_PATH)).status()).toBe(401)
      expect((await anonymous.put(SETTINGS_PATH, { data: { vocabulary: VOCABULARY } })).status()).toBe(401)
    })
    const otherBefore = await readSettings(request, otherTenantToken)
    await saveSettings(request, managerToken, VOCABULARY)
    expect((await readSettings(request, viewerToken)).vocabulary).toEqual(VOCABULARY)
    expect((await apiRequest(request, 'GET', '/api/customers/people?pageSize=1', { token: viewerToken })).status()).toBe(403)
    const denied = await apiRequest(request, 'PUT', SETTINGS_PATH, {
      token: viewerToken, data: { vocabulary: null },
    })
    expect(denied.status()).toBe(403)
    const foreignTenantId = getTokenContext(otherTenantToken).tenantId
    for (const [token, targetTenantId] of [[managerToken, foreignTenantId], [otherTenantToken, tenantId]]) {
      const response = await apiRequest(request, 'GET', `${SETTINGS_PATH}?tenantId=${targetTenantId}`, { token: token! })
      expect(response.status()).toBe(403)
    }
    expect((await readSettings(request, managerToken)).vocabulary).toEqual(VOCABULARY)
    expect(await readSettings(request, otherTenantToken)).toEqual(otherBefore)
    try {
      await setViewerFeatures(request, ['customers.people.view'])
      expect((await apiRequest(request, 'GET', SETTINGS_PATH, { token: viewerToken })).status()).toBe(403)
      await setViewerFeatures(request, ['customers.deals.view', 'customers.deals.manage'])
      const partialManager = await apiRequest(request, 'PUT', SETTINGS_PATH, { token: viewerToken, data: { vocabulary: null } })
      expect(partialManager.status()).toBe(403)
      expect(await readJsonSafe(partialManager)).not.toHaveProperty('impact')
    } finally {
      await setViewerFeatures(request, ['customers.deals.view'])
    }
  })

  test('agrees across plain/advanced lists, aggregates and maps for custom and historical statuses', async ({ request }) => {
    const fixtures: Fixture[] = []
    try {
      await saveSettings(request, managerToken, DEFAULT_VOCABULARY)
      const companyId = await createCompanyFixture(request, managerToken, `Vocabulary ${randomUUID()}`)
      fixtures.push({ path: '/api/customers/companies', id: companyId })
      const personId = await createPersonFixture(request, managerToken, {
        firstName: 'Vocabulary', lastName: randomUUID(), displayName: `Vocabulary ${randomUUID()}`, companyEntityId: companyId,
      })
      fixtures.push({ path: '/api/customers/people', id: personId })
      const addressResponse = await apiRequest(request, 'POST', '/api/customers/addresses', {
        token: managerToken,
        data: { entityId: companyId, addressLine1: '1 Vocabulary Street', city: 'Warszawa', country: 'PL', latitude: 52.1875, longitude: 21, isPrimary: true },
      })
      expect(addressResponse.status()).toBe(201)
      fixtures.push({ path: '/api/customers/addresses', id: expectId((await readJsonSafe<{ id: string }>(addressResponse))?.id, 'Address fixture has an id') })
      const wonIds: string[] = []
      const closedIds: string[] = []
      let deliveredId = ''
      for (const status of ['acquired', 'delivered', 'win', 'lost', 'open', 'finished']) {
        const id = await createDealFixture(request, managerToken, { title: `Vocabulary ${status}`, companyIds: [companyId], status, valueAmount: 100, valueCurrency: 'USD' })
        fixtures.push({ path: '/api/customers/deals', id })
        if (['acquired', 'delivered', 'win'].includes(status)) wonIds.push(id)
        if (status !== 'open') closedIds.push(id)
        if (status === 'delivered') deliveredId = id
      }
      const baseQuery = new URLSearchParams({ companyId, pageSize: '100' })
      const expectIds = async (path: string, query: URLSearchParams, expected: string[]) => {
        const response = await apiRequest(request, 'GET', `${path}?${query}`, { token: managerToken })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ items: Array<{ id: string }>; total: number }>(response)
        expect(body?.items.map((item) => item.id).sort()).toEqual([...expected].sort())
        expect(body?.total).toBe(expected.length)
      }
      const expectAggregateCount = async (expected: number) => {
        const response = await apiRequest(request, 'GET', `/api/customers/deals/aggregate?companyId=${companyId}&status=delivered`, { token: managerToken })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ perStage: Array<{ count: number }> }>(response)
        expect(body?.perStage.reduce((total, stage) => total + stage.count, 0)).toBe(expected)
      }
      const expectCompanyMetrics = async (activeDealsCount: number, completedDealsCount: number) => {
        const response = await apiRequest(request, 'GET', `/api/customers/companies/${companyId}`, { token: managerToken })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ kpis: { activeDealsCount: number; completedDealsCount: number } }>(response)
        expect(body?.kpis).toMatchObject({ activeDealsCount, completedDealsCount })
      }
      const expectSummaryMetrics = async (dealsClosed: number, winRate: number) => {
        const response = await apiRequest(request, 'GET', '/api/customers/deals/summary', { token: managerToken })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ activeDeals: { value: number }; wonThisQuarter: { dealsClosed: number }; winRate: { value: number } }>(response)
        expect(body).toMatchObject({ activeDeals: { value: 1 }, wonThisQuarter: { dealsClosed }, winRate: { value: winRate } })
      }
      const expectEnrichedCompanyMetrics = async (clvAmount: number, activeStatus: string) => {
        const response = await apiRequest(request, 'GET', `/api/customers/people/${personId}/companies/enriched`, { token: managerToken })
        expect(response.status()).toBe(200)
        const body = await readJsonSafe<{ total: number; items: Array<{ companyId: string; activeDeal: { title: string } | null; clv: { amount: number; currency: string } | null }> }>(response)
        expect(body?.total).toBe(1)
        expect(body?.items).toHaveLength(1)
        expect(body?.items[0]).toMatchObject({ companyId, activeDeal: { title: `Vocabulary ${activeStatus}` }, clv: { amount: clvAmount, currency: 'USD' } })
      }
      const wonQuery = new URLSearchParams(baseQuery)
      wonQuery.set('status', 'delivered')
      await expectIds('/api/customers/deals', wonQuery, [deliveredId])
      await expectIds('/api/customers/deals/map', wonQuery, [deliveredId])
      await expectAggregateCount(1)
      await expectCompanyMetrics(4, 1)
      await expectSummaryMetrics(1, 50)
      await expectEnrichedCompanyMetrics(100, 'finished')
      await saveSettings(request, managerToken, VOCABULARY)
      await expectIds('/api/customers/deals', wonQuery, wonIds)
      await expectIds('/api/customers/deals/map', wonQuery, wonIds)
      await expectAggregateCount(wonIds.length)
      await expectCompanyMetrics(1, 3)
      await expectSummaryMetrics(3, 75)
      await expectEnrichedCompanyMetrics(300, 'open')
      const advancedQuery = new URLSearchParams(baseQuery)
      advancedQuery.set('filter[v]', '2')
      advancedQuery.set('filter[root][combinator]', 'and')
      advancedQuery.set('filter[root][children][0][type]', 'rule')
      advancedQuery.set('filter[root][children][0][field]', 'status')
      advancedQuery.set('filter[root][children][0][op]', 'equals')
      advancedQuery.set('filter[root][children][0][value]', 'delivered')
      await expectIds('/api/customers/deals', advancedQuery, wonIds)
      const closedQuery = new URLSearchParams(baseQuery)
      closedQuery.set('status', 'finished')
      await expectIds('/api/customers/deals', closedQuery, closedIds)
    } finally {
      await cleanupFixtures(request, managerToken, fixtures)
    }
  })

  test('canonicalizes closure writes, selects configured terminal stages and clears closure on reopen', async ({ request }) => {
    const fixtures: Fixture[] = []
    try {
      await saveSettings(request, managerToken, VOCABULARY)
      const companyId = await createCompanyFixture(request, managerToken, `Closure ${randomUUID()}`)
      fixtures.push({ path: '/api/customers/companies', id: companyId })
      const pipelineId = await createPipelineFixture(request, managerToken, { name: `Vocabulary ${randomUUID()}` })
      fixtures.push({ path: '/api/customers/pipelines', id: pipelineId, bodyDelete: true })
      const stageIds: string[] = []
      for (const [order, label] of ['Open', 'acquired', 'declined'].entries()) {
        const id = await createPipelineStageFixture(request, managerToken, { pipelineId, label, order })
        stageIds.push(id)
        fixtures.push({ path: '/api/customers/pipeline-stages', id, bodyDelete: true })
      }
      const dealId = await createDealFixture(request, managerToken, {
        title: 'Vocabulary closure', companyIds: [companyId], pipelineId, pipelineStageId: stageIds[0], status: 'open',
      })
      fixtures.push({ path: '/api/customers/deals', id: dealId })
      const update = async (data: Record<string, unknown>) => {
        const current = await readDeal(request, managerToken, dealId)
        const response = await apiRequest(request, 'PUT', '/api/customers/deals', {
          token: managerToken, data: { id: dealId, ...data }, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: current.updatedAt },
        })
        expect(response.status()).toBe(200)
        return readDeal(request, managerToken, dealId)
      }
      expect(await update({ status: 'won' })).toMatchObject({ status: 'acquired', closureOutcome: 'won', pipelineStageId: stageIds[1] })
      expect(await update({ status: 'loose', lossNotes: 'Budget declined' })).toMatchObject({ status: 'declined', closureOutcome: 'lost', pipelineStageId: stageIds[2], lossNotes: 'Budget declined' })
      expect(await update({ status: 'open', pipelineStageId: stageIds[0] })).toMatchObject({ status: 'open', closureOutcome: null, lossNotes: null })
    } finally {
      await cleanupFixtures(request, managerToken, fixtures)
    }
  })

  test('requires fresh impact confirmation across tenant organizations without exposing restricted counts', async ({ request }) => {
    const fixtures: Fixture[] = []
    let secondOrganizationId: string | null = null
    let secondManagerId: string | null = null
    let secondToken = ''
    let secondCompanyId: string | null = null
    let secondDealId: string | null = null
    let foreignCompanyId: string | null = null
    let foreignDealId: string | null = null
    try {
      const current = await saveSettings(request, managerToken, VOCABULARY)
      const companyId = await createCompanyFixture(request, managerToken, `Reclassification ${randomUUID()}`)
      fixtures.push({ path: '/api/customers/companies', id: companyId })
      const dealId = await createDealFixture(request, managerToken, { title: `Signed ${randomUUID()}`, companyIds: [companyId], status: 'acquired' })
      fixtures.push({ path: '/api/customers/deals', id: dealId })
      const originalDeal = await readDealSnapshot(request, managerToken, dealId)
      expect(originalDeal).toMatchObject({ status: 'acquired', closureOutcome: null })
      await expectStatusFilter(request, managerToken, companyId, 'win', [dealId])
      await expectCompanyClassification(request, managerToken, companyId, 0, 1)
      const deletedId = await createDealFixture(request, managerToken, { title: `Deleted ${randomUUID()}`, companyIds: [companyId], status: 'acquired' })
      fixtures.push({ path: '/api/customers/deals', id: deletedId })
      await deleteEntityIfExists(request, managerToken, '/api/customers/deals', deletedId)
      const candidate = { ...VOCABULARY, won: ['replacement'] }
      const send = (fingerprint?: string, version = current.updatedAt) => apiRequest(request, 'PUT', SETTINGS_PATH, {
        token: managerToken,
        data: { vocabulary: candidate, ...(fingerprint ? { reclassificationConfirmation: { fingerprint } } : {}) },
        headers: version ? { [OPTIMISTIC_LOCK_HEADER_NAME]: version } : {},
      })
      const initial = await send()
      expect(initial.status()).toBe(409)
      const initialBody = await readJsonSafe(initial)
      const preview = dealStatusReclassificationErrorSchema.parse(initialBody)
      expect(preview.code).toBe(DEAL_STATUS_RECLASSIFICATION_CODE)
      expect(preview.impact.affectedDeals).toBe(1)
      expect(Object.keys(initialBody as object).sort()).toEqual(['code', 'error', 'impact'])
      expect(Object.keys(preview.impact).sort()).toEqual(['affectedDeals', 'fingerprint'])
      expect(await readSettings(request, managerToken)).toEqual(current)

      secondOrganizationId = await createOrganizationFixture(request, superToken, { name: `Hidden ${randomUUID()}`, tenantId: tenantId! })
      const email = `second-vocabulary-${randomUUID()}@example.com`
      secondManagerId = await createUserFixture(request, superToken, { email, password: fixturePassword, organizationId: secondOrganizationId, roles: [roleId!] })
      secondToken = await getAuthToken(request, email, fixturePassword)
      secondCompanyId = await createCompanyFixture(request, secondToken, `Second ${randomUUID()}`)
      secondDealId = await createDealFixture(request, secondToken, { title: `Second signed ${randomUUID()}`, companyIds: [secondCompanyId], status: 'acquired' })
      const originalSecondDeal = await readDealSnapshot(request, secondToken, secondDealId)
      foreignCompanyId = await createCompanyFixture(request, otherTenantToken, `Foreign ${randomUUID()}`)
      foreignDealId = await createDealFixture(request, otherTenantToken, { title: `Foreign ${randomUUID()}`, companyIds: [foreignCompanyId], status: 'acquired' })
      try {
        await setViewerFeatures(request, ['customers.deals.view', 'customers.deals.manage'])
        const denied = await apiRequest(request, 'PUT', SETTINGS_PATH, { token: viewerToken, data: { vocabulary: candidate } })
        expect(denied.status()).toBe(403)
        expect(await readJsonSafe(denied)).not.toHaveProperty('impact')
        const refreshed = await send(preview.impact.fingerprint)
        expect(refreshed.status()).toBe(409)
        const next = dealStatusReclassificationErrorSchema.parse(await readJsonSafe(refreshed))
        expect(next.impact.affectedDeals).toBe(2)
        expect(next.impact.fingerprint).not.toBe(preview.impact.fingerprint)
        expect(await readSettings(request, managerToken)).toEqual(current)
        const confirmed = await send(next.impact.fingerprint)
        expect(confirmed.status()).toBe(200)
        expect((await readSettings(request, managerToken)).vocabulary).toEqual(candidate)
        expect(await readDealSnapshot(request, managerToken, dealId)).toEqual(originalDeal)
        expect(await readDealSnapshot(request, secondToken, secondDealId)).toEqual(originalSecondDeal)
        await expectStatusFilter(request, managerToken, companyId, 'win', [])
        await expectCompanyClassification(request, managerToken, companyId, 1, 0)
        await expectCompanyClassification(request, secondToken, secondCompanyId, 1, 0)
      } finally {
        await setViewerFeatures(request, ['customers.deals.view'])
      }
    } finally {
      await deleteEntityIfExists(request, secondToken, '/api/customers/deals', secondDealId)
      await deleteEntityIfExists(request, secondToken, '/api/customers/companies', secondCompanyId)
      await deleteEntityIfExists(request, otherTenantToken, '/api/customers/deals', foreignDealId)
      await deleteEntityIfExists(request, otherTenantToken, '/api/customers/companies', foreignCompanyId)
      await cleanupFixtures(request, managerToken, fixtures)
      await deleteUserIfExists(request, superToken, secondManagerId)
      await deleteOrganizationIfExists(request, superToken, secondOrganizationId)
    }
  })

  test('guards reassignment and newly-terminal statuses, refreshes changed candidates and resets explicitly', async ({ request }) => {
    const fixtures: Fixture[] = []
    try {
      const current = await saveSettings(request, managerToken, VOCABULARY)
      const companyId = await createCompanyFixture(request, managerToken, `Classification ${randomUUID()}`)
      fixtures.push({ path: '/api/customers/companies', id: companyId })
      const statuses = ['awaiting_contract', 'acquired', 'finished']
      const dealIds: string[] = []
      for (const status of statuses) {
        const id = await createDealFixture(request, managerToken, {
          title: `Classification ${status} ${randomUUID()}`, companyIds: [companyId], status,
          closureOutcome: status === 'acquired' ? 'won' : undefined,
        })
        dealIds.push(id)
        fixtures.push({ path: '/api/customers/deals', id })
      }
      const originalDeals = await Promise.all(dealIds.map((id) => readDealSnapshot(request, managerToken, id)))
      expect(originalDeals.map((deal) => deal.closureOutcome)).toEqual([null, 'won', null])
      await expectStatusFilter(request, managerToken, companyId, 'win', [dealIds[1]])
      await expectCompanyClassification(request, managerToken, companyId, 1, 1)
      const candidate = { won: ['awaiting_contract'], lost: ['acquired', 'declined'], closed: ['finished'] }
      const first = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token: managerToken, data: { vocabulary: candidate }, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: current.updatedAt! },
      })
      expect(first.status()).toBe(409)
      const preview = dealStatusReclassificationErrorSchema.parse(await readJsonSafe(first))
      expect(preview.impact.affectedDeals).toBe(2)
      const changedCandidate = { ...candidate, won: ['awaiting_contract', 'additional_alias'] }
      const staleCandidate = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token: managerToken,
        data: { vocabulary: changedCandidate, reclassificationConfirmation: { fingerprint: preview.impact.fingerprint } },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: current.updatedAt! },
      })
      expect(staleCandidate.status()).toBe(409)
      const refreshed = dealStatusReclassificationErrorSchema.parse(await readJsonSafe(staleCandidate))
      expect(refreshed.impact.affectedDeals).toBe(2)
      expect(refreshed.impact.fingerprint).not.toBe(preview.impact.fingerprint)
      const confirmed = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token: managerToken,
        data: { vocabulary: changedCandidate, reclassificationConfirmation: { fingerprint: refreshed.impact.fingerprint } },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: current.updatedAt! },
      })
      expect(confirmed.status()).toBe(200)
      const updated = await readJsonSafe<Settings>(confirmed)
      expect(await Promise.all(dealIds.map((id) => readDealSnapshot(request, managerToken, id)))).toEqual(originalDeals)
      await expectStatusFilter(request, managerToken, companyId, 'win', [dealIds[0]])
      await expectStatusFilter(request, managerToken, companyId, 'lost', [dealIds[1]])
      await expectCompanyClassification(request, managerToken, companyId, 0, 1)
      const summary = await apiRequest(request, 'GET', '/api/customers/deals/summary', { token: managerToken })
      expect(summary.status()).toBe(200)
      expect(await readJsonSafe(summary)).toMatchObject({ wonThisQuarter: { dealsClosed: 2 }, winRate: { value: 100 } })
      const staleVersion = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token: managerToken, data: { vocabulary: null }, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: current.updatedAt! },
      })
      expect(staleVersion.status()).toBe(409)
      expect(await readJsonSafe(staleVersion)).toMatchObject({ code: 'optimistic_lock_conflict' })
      const reset = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token: managerToken, data: { vocabulary: null }, headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: updated!.updatedAt! },
      })
      expect(reset.status()).toBe(409)
      const resetPreview = dealStatusReclassificationErrorSchema.parse(await readJsonSafe(reset))
      expect(resetPreview.impact.affectedDeals).toBe(3)
      const appliedReset = await apiRequest(request, 'PUT', SETTINGS_PATH, {
        token: managerToken,
        data: { vocabulary: null, reclassificationConfirmation: { fingerprint: resetPreview.impact.fingerprint } },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: updated!.updatedAt! },
      })
      expect(appliedReset.status()).toBe(200)
      expect(await Promise.all(dealIds.map((id) => readDealSnapshot(request, managerToken, id)))).toEqual(originalDeals)
      await expectStatusFilter(request, managerToken, companyId, 'win', [])
      await expectCompanyClassification(request, managerToken, companyId, 3, 0)
      const resetSummary = await apiRequest(request, 'GET', '/api/customers/deals/summary', { token: managerToken })
      expect(resetSummary.status()).toBe(200)
      expect(await readJsonSafe(resetSummary)).toMatchObject({ wonThisQuarter: { dealsClosed: 1 }, winRate: { value: 100 } })
    } finally {
      await cleanupFixtures(request, managerToken, fixtures)
    }
  })

  test('refuses unsafe undo and accepts its freshly confirmed status-only impact', async ({ request }) => {
    const fixtures: Fixture[] = []
    try {
      await saveSettings(request, managerToken, VOCABULARY)
      const companyId = await createCompanyFixture(request, managerToken, `Undo impact ${randomUUID()}`)
      fixtures.push({ path: '/api/customers/companies', id: companyId })
      const dealId = await createDealFixture(request, managerToken, { title: `Undo signed ${randomUUID()}`, companyIds: [companyId], status: 'acquired' })
      fixtures.push({ path: '/api/customers/deals', id: dealId })
      const originalDeal = await readDealSnapshot(request, managerToken, dealId)
      expect(originalDeal).toMatchObject({ status: 'acquired', closureOutcome: null })
      await expectStatusFilter(request, managerToken, companyId, 'win', [dealId])
      await expectCompanyClassification(request, managerToken, companyId, 0, 1)
      const logs = await apiRequest(request, 'GET', `/api/audit_logs/audit-logs/actions?resourceKind=customers.deal_status_vocabulary&resourceId=${tenantId}&undoableOnly=true`, { token: managerToken, headers: { Cookie: 'om_selected_org=__all__' } })
      expect(logs.status()).toBe(200)
      const entries = await readJsonSafe<{ items: Array<{ commandId: string; undoToken: string | null }> }>(logs)
      const undoToken = entries?.items.find((entry) => entry.commandId === 'customers.settings.save_deal_status_vocabulary')?.undoToken
      expect(undoToken).toBeTruthy()
      const unsafe = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', { token: managerToken, data: { undoToken } })
      expect(unsafe.status()).toBe(409)
      const required = dealStatusReclassificationErrorSchema.parse(await readJsonSafe(unsafe))
      expect(required.impact.affectedDeals).toBe(1)
      expect((await readSettings(request, managerToken)).source).toBe('tenant')
      const confirmed = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', {
        token: managerToken, data: { undoToken }, headers: { [DEAL_STATUS_RECLASSIFICATION_HEADER]: required.impact.fingerprint },
      })
      expect(confirmed.status()).toBe(200)
      expect((await readSettings(request, managerToken)).source).not.toBe('tenant')
      expect(await readDealSnapshot(request, managerToken, dealId)).toEqual(originalDeal)
      await expectStatusFilter(request, managerToken, companyId, 'win', [])
      await expectCompanyClassification(request, managerToken, companyId, 1, 0)
    } finally {
      await cleanupFixtures(request, managerToken, fixtures)
    }
  })

  test('saves and resets through the settings editor and applies canonical Kanban filters', async ({ page, request }) => {
    const fixtures: Fixture[] = []
    const stamp = randomUUID()
    const wonTitle = `Vocabulary delivered ${stamp}`
    const openTitle = `Vocabulary active ${stamp}`
    const screenshotDirectory = path.resolve('.ai/qa/screenshots/issue-5546')
    try {
      const baseline = await readSettings(request, managerToken)
      await saveSettings(request, managerToken, DEFAULT_VOCABULARY)
      const companyId = await createCompanyFixture(request, managerToken, `Vocabulary UI ${stamp}`)
      fixtures.push({ path: '/api/customers/companies', id: companyId })
      const pipelineId = await createPipelineFixture(request, managerToken, { name: `Vocabulary UI ${stamp}`, isDefault: true })
      fixtures.push({ path: '/api/customers/pipelines', id: pipelineId, bodyDelete: true })
      const stageId = await createPipelineStageFixture(request, managerToken, { pipelineId, label: 'Opportunity', order: 0 })
      fixtures.push({ path: '/api/customers/pipeline-stages', id: stageId, bodyDelete: true })
      for (const [title, status] of [[wonTitle, 'delivered'], [openTitle, 'open']]) {
        const id = await createDealFixture(request, managerToken, { title, status, companyIds: [companyId], pipelineId, pipelineStageId: stageId })
        fixtures.push({ path: '/api/customers/deals', id })
      }
      const login = await page.request.post('/api/auth/login', { form: { email: managerEmail, password: fixturePassword } })
      expect(login.status()).toBe(200)
      await page.goto('/backend/config/customers/deals')
      await expect(page.getByRole('button', { name: /^Organization: Vocabulary / })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Deal status vocabulary', exact: true })).toBeVisible()
      await page.getByRole('textbox', { name: 'Won statuses', exact: true }).fill(VOCABULARY.won.join(', '))
      await page.getByRole('textbox', { name: 'Lost statuses', exact: true }).fill(VOCABULARY.lost.join(', '))
      await page.getByRole('textbox', { name: 'Closed statuses', exact: true }).fill(VOCABULARY.closed.join(', '))
      const saveResponse = page.waitForResponse((response) => new URL(response.url()).pathname === SETTINGS_PATH && response.request().method() === 'PUT')
      await page.getByRole('button', { name: 'Save vocabulary', exact: true }).click()
      expect((await saveResponse).status()).toBe(409)
      const confirmation = page.getByRole('alertdialog', { name: 'Confirm deal reclassification' })
      await expect(confirmation).toContainText('Existing deals affected: 1')
      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect((await readSettings(request, managerToken)).vocabulary).toEqual(DEFAULT_VOCABULARY)
      await page.getByRole('button', { name: 'Save vocabulary', exact: true }).click()
      await expect(confirmation).toBeVisible()
      const confirmedSave = page.waitForResponse((response) => new URL(response.url()).pathname === SETTINGS_PATH && response.request().method() === 'PUT' && response.status() === 200)
      await confirmation.getByRole('button', { name: 'Apply vocabulary change', exact: true }).press('Control+Enter')
      await confirmedSave
      expect((await readSettings(request, managerToken)).vocabulary).toEqual(VOCABULARY)
      await page.reload()
      await expect(page.getByRole('button', { name: /^Organization: Vocabulary / })).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Won statuses', exact: true })).toHaveValue('acquired, delivered')
      await expect(page.getByRole('button', { name: 'Reset to default', exact: true })).toBeEnabled()
      await mkdir(screenshotDirectory, { recursive: true })
      await page.screenshot({ path: path.join(screenshotDirectory, 'settings-editor.png'), fullPage: true })

      await page.goto('/backend/customers/deals/pipeline')
      await expect(page.getByRole('button', { name: /^Organization: Vocabulary / })).toBeVisible()
      await expect(page.getByRole('tab', { name: 'Kanban', exact: true })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByText(wonTitle, { exact: true })).toBeVisible()
      await expect(page.getByText(openTitle, { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Status: All', exact: true }).click()
      await page.getByRole('button', { name: /^(Win|Won)$/ }).click()
      const filteredRequest = page.waitForRequest((request) => {
        const url = new URL(request.url())
        return url.pathname === '/api/customers/deals' && url.searchParams.get('pipelineId') === pipelineId && url.searchParams.getAll('status').includes('acquired')
      })
      await page.getByRole('button', { name: 'Apply', exact: true }).click()
      await filteredRequest
      await expect(page.getByText(wonTitle, { exact: true })).toBeVisible()
      await expect(page.getByText(openTitle, { exact: true })).toBeHidden()
      await page.screenshot({ path: path.join(screenshotDirectory, 'kanban-configured-status.png'), fullPage: true })

      await page.goto('/backend/config/customers/deals')
      await expect(page.getByRole('button', { name: /^Organization: Vocabulary / })).toBeVisible()
      const resetResponse = page.waitForResponse((response) => new URL(response.url()).pathname === SETTINGS_PATH && response.request().method() === 'PUT')
      await page.getByRole('button', { name: 'Reset to default', exact: true }).click()
      expect((await resetResponse).status()).toBe(409)
      await expect(page.getByRole('alertdialog', { name: 'Confirm deal reclassification' })).toContainText('Existing deals affected: 1')
      const confirmedReset = page.waitForResponse((response) => new URL(response.url()).pathname === SETTINGS_PATH && response.request().method() === 'PUT' && response.status() === 200)
      await page.getByRole('button', { name: 'Apply vocabulary change', exact: true }).click()
      await confirmedReset
      expect(await readSettings(request, managerToken)).toMatchObject({ vocabulary: baseline.vocabulary, source: baseline.source })
      await expect(page.getByRole('textbox', { name: 'Won statuses', exact: true })).toHaveValue(baseline.vocabulary.won.join(', '))
      await expect(page.getByRole('button', { name: 'Reset to default', exact: true })).toBeDisabled()
    } finally {
      await cleanupFixtures(request, managerToken, fixtures)
    }
  })
})
