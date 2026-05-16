import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  advanceDealStageAction,
  assignApartmentAction,
  cleanupChampionCrmDemo,
  cleanupChampionCrmRun,
  closeChampionCrmDb,
  convertLeadToDealAction,
  createContactFixture,
  createDealFixture,
  createRunId,
  getLeadById,
  qualifyLeadAction,
  readDbOne,
  seedChampionCrmDemo,
  scopeFromToken,
} from './helpers/championCrmFixtures'

test.describe.configure({ mode: 'serial' })

test.describe('TC-CHAMP-CRM-029-040: Champion CRM deal action UI paths', () => {
  test.afterAll(async () => {
    if (process.env.DATABASE_URL) await cleanupChampionCrmDemo()
    await closeChampionCrmDb()
  })

  test('TC-CHAMP-CRM-029: lead detail qualification action updates status and timeline', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    await cleanupChampionCrmDemo()
    const seed = await seedChampionCrmDemo(request, token)
    const leadId = String(seed.body?.leadId)

    await login(page, 'admin')
    await page.goto(`/backend/champion-crm/leads/${leadId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: /Qualify/i })).toBeVisible()

    const qualify = await qualifyLeadAction(request, token, leadId)
    expect(qualify.status()).toBe(200)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText('zakwalifikowany')).toBeVisible()
    await expect(page.getByText('Lead qualified')).toBeVisible()
  })

  test('TC-CHAMP-CRM-030: qualification action is safe on repeat', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    const leadId = String(seed.body?.leadId)
    expect((await qualifyLeadAction(request, token, leadId)).status()).toBe(200)
    expect((await qualifyLeadAction(request, token, leadId)).status()).toBe(200)
    const lead = await getLeadById(request, token, leadId)
    expect(lead?.qualificationStatus).toBe('zakwalifikowany')
  })

  test('TC-CHAMP-CRM-031: create/open deal from lead links contact, lead, and investment', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    const leadId = String(seed.body?.leadId)
    expect((await qualifyLeadAction(request, token, leadId)).status()).toBe(200)
    const converted = await convertLeadToDealAction(request, token, leadId)
    expect(converted.response.status()).toBe(200)
    const dealId = String(converted.body?.dealId)

    const row = await readDbOne<{ stage: string; investment_id: string; source_lead_id: string }>(
      'select stage, investment_id, source_lead_id from champion_crm_deals where id = $1',
      [dealId],
    )
    expect(row).toMatchObject({ stage: 'qualified', investment_id: String(seed.body?.investmentId), source_lead_id: leadId })

    await login(page, 'admin')
    await page.goto(`/backend/champion-crm/deals/${dealId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('qualified')).toBeVisible()
    await expect(page.getByText('Hussar Loft')).toBeVisible()
  })

  test('TC-CHAMP-CRM-032: create/open deal is idempotent for the same source lead', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    const leadId = String(seed.body?.leadId)
    const first = await convertLeadToDealAction(request, token, leadId)
    const second = await convertLeadToDealAction(request, token, leadId)
    expect(first.response.status()).toBe(200)
    expect(second.response.status()).toBe(200)
    expect(second.body?.dealId).toBe(first.body?.dealId)
  })

  test('TC-CHAMP-CRM-033: deal detail renders deal, contact, lead, investment and pipeline context', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    const converted = await convertLeadToDealAction(request, token, String(seed.body?.leadId))
    const dealId = String(converted.body?.dealId)

    await login(page, 'admin')
    await page.goto(`/backend/champion-crm/deals/${dealId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /Deal: Anna Kowalska/i })).toBeVisible()
    await expect(page.getByText('Anna Kowalska')).toBeVisible()
    await expect(page.getByText('Hussar Loft')).toBeVisible()
    await expect(page.getByRole('button', { name: /offer_open/i })).toBeVisible()
  })

  test('TC-CHAMP-CRM-034: deal stage advances to offer_open', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    const converted = await convertLeadToDealAction(request, token, String(seed.body?.leadId))
    const dealId = String(converted.body?.dealId)
    const offer = await advanceDealStageAction(request, token, dealId, 'offer_open')
    expect(offer.status()).toBe(200)

    await login(page, 'admin')
    await page.goto(`/backend/champion-crm/deals/${dealId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('offer_open')).toBeVisible()
    await expect(page.getByText('Deal stage changed to offer_open')).toBeVisible()
  })

  test('TC-CHAMP-CRM-035: invalid deal stage is rejected', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    const converted = await convertLeadToDealAction(request, token, String(seed.body?.leadId))
    const dealId = String(converted.body?.dealId)
    const response = await apiRequest(request, 'POST', `/api/champion-crm/deals/${dealId}/stage`, { token, data: { stage: 'unsupported_stage' } })
    expect(response.status()).toBe(400)
    const row = await readDbOne<{ stage: string }>('select stage from champion_crm_deals where id = $1', [dealId])
    expect(row?.stage).toBe('qualified')
  })

  test('TC-CHAMP-CRM-036: assign available apartment reserves it for the deal', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    const converted = await convertLeadToDealAction(request, token, String(seed.body?.leadId))
    const dealId = String(converted.body?.dealId)
    const apartment = await readDbOne<{ id: string }>("select id from champion_crm_apartments where unit_number = 'A2.14' and metadata->>'demo' = 'anna-hussar'", [])
    const assign = await assignApartmentAction(request, token, dealId, String(apartment?.id))
    expect(assign.status()).toBe(200)

    await login(page, 'admin')
    await page.goto(`/backend/champion-crm/deals/${dealId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('A2.14')).toBeVisible()
    await expect(page.getByText('reserved')).toBeVisible()
    await expect(page.getByText('Apartment A2.14 reserved')).toBeVisible()
  })

  test('TC-CHAMP-CRM-037: reservation writes deal value/currency from apartment price', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    const converted = await convertLeadToDealAction(request, token, String(seed.body?.leadId))
    const dealId = String(converted.body?.dealId)
    const apartment = await readDbOne<{ id: string }>("select id from champion_crm_apartments where unit_number = 'A2.14' and metadata->>'demo' = 'anna-hussar'", [])
    expect((await assignApartmentAction(request, token, dealId, String(apartment?.id))).status()).toBe(200)
    const row = await readDbOne<{ value_gross: string | null; currency: string | null }>('select value_gross, currency from champion_crm_deals where id = $1', [dealId])
    expect(row?.value_gross).toBeTruthy()
    expect(row?.currency).toBe('PLN')
  })

  test('TC-CHAMP-CRM-038: reserved unit is not assignable by another deal while alternatives remain available', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(token)
    const runId = createRunId('champ-crm-038')
    try {
      const seed = await seedChampionCrmDemo(request, token)
      const converted = await convertLeadToDealAction(request, token, String(seed.body?.leadId))
      const dealId = String(converted.body?.dealId)
      const apartment = await readDbOne<{ id: string }>("select id from champion_crm_apartments where unit_number = 'A2.14' and metadata->>'demo' = 'anna-hussar'", [])
      expect((await assignApartmentAction(request, token, dealId, String(apartment?.id))).status()).toBe(200)

      const contactId = await createContactFixture(scope, runId, { displayName: 'Second Reservation Contact', email: `second.${runId}@example.test` })
      const otherDealId = await createDealFixture(scope, runId, { contactId, investmentId: String(seed.body?.investmentId), title: 'Second reservation deal' })
      const conflict = await assignApartmentAction(request, token, otherDealId, String(apartment?.id))
      expect(conflict.status()).toBeGreaterThanOrEqual(400)

      const available = await readDbOne<{ units: string[] }>(
        "select array_agg(unit_number order by unit_number) as units from champion_crm_apartments where metadata->>'demo' = 'anna-hussar' and status = 'available'",
        [],
      )
      expect(available?.units).toEqual(['A3.07', 'B1.03'])
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-039: reservation conflict keeps original reservedByDealId', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = scopeFromToken(token)
    const runId = createRunId('champ-crm-039')
    try {
      const seed = await seedChampionCrmDemo(request, token)
      const converted = await convertLeadToDealAction(request, token, String(seed.body?.leadId))
      const dealId = String(converted.body?.dealId)
      const apartment = await readDbOne<{ id: string }>("select id from champion_crm_apartments where unit_number = 'A2.14' and metadata->>'demo' = 'anna-hussar'", [])
      expect((await assignApartmentAction(request, token, dealId, String(apartment?.id))).status()).toBe(200)
      const contactId = await createContactFixture(scope, runId, { displayName: 'Conflict Contact' })
      const otherDealId = await createDealFixture(scope, runId, { contactId, investmentId: String(seed.body?.investmentId), title: 'Conflict deal' })
      expect((await assignApartmentAction(request, token, otherDealId, String(apartment?.id))).status()).toBeGreaterThanOrEqual(400)
      const row = await readDbOne<{ reserved_by_deal_id: string | null }>('select reserved_by_deal_id from champion_crm_apartments where id = $1', [String(apartment?.id)])
      expect(row?.reserved_by_deal_id).toBe(dealId)
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-040: reservation moves deal to reservation_agreement and reserved status', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    const converted = await convertLeadToDealAction(request, token, String(seed.body?.leadId))
    const dealId = String(converted.body?.dealId)
    const apartment = await readDbOne<{ id: string }>("select id from champion_crm_apartments where unit_number = 'A2.14' and metadata->>'demo' = 'anna-hussar'", [])
    expect((await assignApartmentAction(request, token, dealId, String(apartment?.id))).status()).toBe(200)
    const row = await readDbOne<{ stage: string; status: string; probability: number }>('select stage, status, probability from champion_crm_deals where id = $1', [dealId])
    expect(row).toMatchObject({ stage: 'reservation_agreement', status: 'reserved' })
    expect(Number(row?.probability ?? 0)).toBeGreaterThanOrEqual(75)
  })
})
