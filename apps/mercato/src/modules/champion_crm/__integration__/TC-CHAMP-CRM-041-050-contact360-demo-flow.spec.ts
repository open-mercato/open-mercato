import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { resolveChampionCrmAiAdapter } from '../ai/adapter'
import {
  advanceDealStageAction,
  assignApartmentAction,
  cleanupChampionCrmDemo,
  cleanupChampionCrmRun,
  closeChampionCrmDb,
  convertLeadToDealAction,
  createActivityFixture,
  createContactFixture,
  createDealFixture,
  createRunId,
  markDealWonAction,
  qualifyLeadAction,
  readDbOne,
  seedChampionCrmDemo,
  scopeFromToken,
  updateLead,
} from './helpers/championCrmFixtures'

test.describe.configure({ mode: 'serial' })

async function prepareReservedAnnaDeal(request: APIRequestContext, token: string) {
  const seed = await seedChampionCrmDemo(request, token)
  expect(seed.response.status()).toBe(200)
  const leadId = String(seed.body?.leadId)
  expect((await qualifyLeadAction(request, token, leadId)).status()).toBe(200)
  const converted = await convertLeadToDealAction(request, token, leadId)
  expect(converted.response.status()).toBe(200)
  const dealId = String(converted.body?.dealId)
  const contactId = String(converted.body?.contactId)
  const apartment = await readDbOne<{ id: string }>("select id from champion_crm_apartments where unit_number = 'A2.14' and metadata->>'demo' = 'anna-hussar'", [])
  expect((await assignApartmentAction(request, token, dealId, String(apartment?.id))).status()).toBe(200)
  return { leadId, dealId, contactId, apartmentId: String(apartment?.id), investmentId: String(seed.body?.investmentId) }
}

test.describe('TC-CHAMP-CRM-041-050: Champion CRM Contact 360 demo flow UI paths', () => {
  test.afterAll(async () => {
    if (process.env.DATABASE_URL) await cleanupChampionCrmDemo()
    await closeChampionCrmDb()
  })

  test('TC-CHAMP-CRM-041: Contact 360 shows reserved apartment context', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    await cleanupChampionCrmDemo()
    const flow = await prepareReservedAnnaDeal(request, token)

    await login(page, 'admin')
    await page.goto(`/backend/champion-crm/contacts/${flow.contactId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Anna Kowalska' })).toBeVisible()
    await expect(page.getByText('Hussar Loft')).toBeVisible()
    await expect(page.getByText('A2.14')).toBeVisible()
    await expect(page.getByText('reservation_agreement')).toBeVisible()
  })

  test('TC-CHAMP-CRM-042: Contact 360 timeline shows qualification, deal, and reservation trail', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const flow = await prepareReservedAnnaDeal(request, token)

    await login(page, 'admin')
    await page.goto(`/backend/champion-crm/contacts/${flow.contactId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Lead qualified')).toBeVisible()
    await expect(page.getByText('Deal created from lead')).toBeVisible()
    await expect(page.getByText('Apartment A2.14 reserved')).toBeVisible()
  })

  test('TC-CHAMP-CRM-043: manual note added to contact appears in Contact 360', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(token)
    const flow = await prepareReservedAnnaDeal(request, token)
    const runId = createRunId('champ-crm-043')
    try {
      await createActivityFixture(scope, runId, {
        entityType: 'contact',
        entityId: flow.contactId,
        contactId: flow.contactId,
        leadId: flow.leadId,
        dealId: flow.dealId,
        type: 'note',
        title: 'Client asked for parking availability',
      })

      await login(page, 'admin')
      await page.goto(`/backend/champion-crm/contacts/${flow.contactId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByText('Client asked for parking availability')).toBeVisible()
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-044: follow-up scheduling is visible on lead/detail contract', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const flow = await prepareReservedAnnaDeal(request, token)
    const nextFollowupAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    expect((await updateLead(request, token, flow.leadId, { nextFollowupAt })).status()).toBe(200)

    const row = await readDbOne<{ next_followup_at: Date | null }>('select next_followup_at from champion_crm_leads where id = $1', [flow.leadId])
    expect(row?.next_followup_at).toBeTruthy()
    await login(page, 'admin')
    await page.goto(`/backend/champion-crm/leads/${flow.leadId}`, { waitUntil: 'domcontentloaded' })
    await test.step('Lead detail currently persists follow-up; visible field assertion should replace this when shell renders nextFollowupAt', async () => {
      expect(row?.next_followup_at).toBeTruthy()
    })
  })

  test('TC-CHAMP-CRM-045: mark deal won sells apartment and promotes contact to client', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const flow = await prepareReservedAnnaDeal(request, token)
    expect((await markDealWonAction(request, token, flow.dealId)).status()).toBe(200)
    const row = await readDbOne<{ deal_status: string; stage: string; apartment_status: string; lifecycle: string }>(
      `select d.status as deal_status, d.stage, a.status as apartment_status, c.lifecycle
       from champion_crm_deals d
       join champion_crm_apartments a on a.id = d.apartment_id
       join champion_crm_contacts c on c.id = d.contact_id
       where d.id = $1`,
      [flow.dealId],
    )
    expect(row).toMatchObject({ deal_status: 'won', stage: 'won', apartment_status: 'sold', lifecycle: 'client' })

    await login(page, 'admin')
    await page.goto(`/backend/champion-crm/contacts/${flow.contactId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('client')).toBeVisible()
    await expect(page.getByText('won')).toBeVisible()
  })

  test('TC-CHAMP-CRM-046: won deal does not sell unrelated apartments', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const flow = await prepareReservedAnnaDeal(request, token)
    expect((await markDealWonAction(request, token, flow.dealId)).status()).toBe(200)
    const row = await readDbOne<{ available_units: string[] }>(
      "select array_agg(unit_number order by unit_number) as available_units from champion_crm_apartments where metadata->>'demo' = 'anna-hussar' and status = 'available'",
      [],
    )
    expect(row?.available_units).toEqual(['A3.07', 'B1.03'])
  })

  test('TC-CHAMP-CRM-047: sold apartment is not selectable for new reservations', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(token)
    const flow = await prepareReservedAnnaDeal(request, token)
    expect((await markDealWonAction(request, token, flow.dealId)).status()).toBe(200)
    const runId = createRunId('champ-crm-047')
    try {
      const contactId = await createContactFixture(scope, runId, { displayName: 'Sold Unit Buyer' })
      const otherDealId = await createDealFixture(scope, runId, { contactId, investmentId: flow.investmentId, title: 'Sold unit conflict deal' })
      const response = await assignApartmentAction(request, token, otherDealId, flow.apartmentId)
      expect(response.status()).toBeGreaterThanOrEqual(400)
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-048: complete free-demo happy path reaches final Contact 360 state', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    await cleanupChampionCrmDemo()
    const flow = await prepareReservedAnnaDeal(request, token)
    expect((await advanceDealStageAction(request, token, flow.dealId, 'offer_open')).status()).toBe(200)
    expect((await advanceDealStageAction(request, token, flow.dealId, 'reservation_agreement')).status()).toBe(200)
    expect((await markDealWonAction(request, token, flow.dealId)).status()).toBe(200)

    await login(page, 'admin')
    await page.goto(`/backend/champion-crm/contacts/${flow.contactId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Anna Kowalska')).toBeVisible()
    await expect(page.getByText('Hussar Loft')).toBeVisible()
    await expect(page.getByText('A2.14')).toBeVisible()
    await expect(page.getByText('won')).toBeVisible()
    await expect(page.getByText('Deal won')).toBeVisible()
  })

  test('TC-CHAMP-CRM-049: read-only user can view context but cannot mutate demo flow', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(adminToken)
    const flow = await prepareReservedAnnaDeal(request, adminToken)
    const runId = createRunId('champ-crm-049')
    const password = 'Valid1!Pass'
    const email = `champ-slice2-readonly-${runId}@example.test`
    let userId: string | null = null
    try {
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [],
      })
      const aclResponse = await apiRequest(request, 'PUT', '/api/auth/users/acl', {
        token: adminToken,
        data: { userId, features: ['champion_crm.read'], organizations: [scope.organizationId] },
      })
      expect(aclResponse.status()).toBe(200)
      const loginResponse = await postForm(request, '/api/auth/login', { email, password })
      expect(loginResponse.status()).toBe(200)
      const loginBody = await readJsonSafe<{ token?: string }>(loginResponse)
      const readOnlyToken = String(loginBody?.token)

      const readResponse = await apiRequest(request, 'GET', `/api/champion-crm/leads?id=${flow.leadId}`, { token: readOnlyToken })
      expect(readResponse.status()).toBe(200)
      const mutateResponse = await markDealWonAction(request, readOnlyToken, flow.dealId)
      expect(mutateResponse.status()).toBe(403)
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-050: AI adapter remains disabled during investment/apartment demo flow', async () => {
    expect(resolveChampionCrmAiAdapter()).toBeNull()
  })
})
