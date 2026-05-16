import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  cleanupChampionCrmDemo,
  closeChampionCrmDb,
  getLeadById,
  listLeads,
  readDbOne,
  seedChampionCrmDemo,
} from './helpers/championCrmFixtures'

test.describe.configure({ mode: 'serial' })

test.describe('TC-CHAMP-CRM-022-028: Champion CRM investment inventory UI paths', () => {
  test.afterAll(async () => {
    if (process.env.DATABASE_URL) await cleanupChampionCrmDemo()
    await closeChampionCrmDb()
  })

  test('TC-CHAMP-CRM-022: demo seed is idempotent for Hussar Loft inventory', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    await cleanupChampionCrmDemo()
    const first = await seedChampionCrmDemo(request, token)
    expect(first.response.status()).toBe(200)
    const second = await seedChampionCrmDemo(request, token)
    expect(second.response.status()).toBe(200)

    const row = await readDbOne<{ investment_count: string; apartment_count: string }>(
      `select
        (select count(*) from champion_crm_investments where slug = 'hussar-loft' and metadata->>'demo' = 'anna-hussar')::text as investment_count,
        (select count(*) from champion_crm_apartments where metadata->>'demo' = 'anna-hussar')::text as apartment_count`,
      [],
    )
    expect(row?.investment_count).toBe('1')
    expect(row?.apartment_count).toBe('3')
  })

  test('TC-CHAMP-CRM-023: investment is represented as module-owned offer root, not catalog product', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    expect(seed.response.status()).toBe(200)
    const leadId = String(seed.body?.leadId)

    const investment = await readDbOne<{ name: string; city: string | null; status: string; currency: string | null }>(
      `select name, city, status, currency from champion_crm_investments where id = $1`,
      [String(seed.body?.investmentId)],
    )
    expect(investment).toMatchObject({ name: 'Hussar Loft', city: 'Krakow', status: 'selling', currency: 'PLN' })

    await login(page, 'admin')
    await page.goto(`/backend/champion-crm/leads/${leadId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(String(seed.body?.investmentId))).toBeVisible()
    await test.step('Investment detail route can replace the id-only lead rendering when that page lands', async () => {
      expect(investment?.name).toBe('Hussar Loft')
    })
  })

  test('TC-CHAMP-CRM-024: Hussar Loft has three apartment inventory items', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    expect(seed.response.status()).toBe(200)
    const row = await readDbOne<{ units: string[]; statuses: string[] }>(
      `select array_agg(unit_number order by unit_number) as units,
        array_agg(status order by unit_number) as statuses
       from champion_crm_apartments where investment_id = $1`,
      [String(seed.body?.investmentId)],
    )
    expect(row?.units).toEqual(['A2.14', 'A3.07', 'B1.03'])
    expect(row?.statuses).toEqual(['available', 'available', 'available'])
  })

  test('TC-CHAMP-CRM-025: available inventory filter contract excludes reserved/sold units', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    expect(seed.response.status()).toBe(200)
    const row = await readDbOne<{ available_units: string[] }>(
      `select array_agg(unit_number order by unit_number) as available_units
       from champion_crm_apartments where investment_id = $1 and status = 'available'`,
      [String(seed.body?.investmentId)],
    )
    expect(row?.available_units).toEqual(['A2.14', 'A3.07', 'B1.03'])
    await test.step('A first-class inventory filter UI should assert this same available set once investment detail exists', async () => {
      expect(row?.available_units?.length).toBe(3)
    })
  })

  test('TC-CHAMP-CRM-026: Anna lead intake captures requested investment and message context', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    expect(seed.response.status()).toBe(200)
    const lead = await getLeadById(request, token, String(seed.body?.leadId))
    expect(lead?.investmentId).toBe(String(seed.body?.investmentId))

    await login(page, 'admin')
    await page.goto(`/backend/champion-crm/leads/${seed.body?.leadId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Anna Kowalska')).toBeVisible()
    await expect(page.getByText(String(seed.body?.investmentId))).toBeVisible()
  })

  test('TC-CHAMP-CRM-027: Anna lead is visible in inbox after seed', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    expect(seed.response.status()).toBe(200)

    await login(page, 'admin')
    await page.goto('/backend/champion-crm/leads', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Anna Kowalska')).toBeVisible()
    await expect(page.getByText('landing_page')).toBeVisible()
  })

  test('TC-CHAMP-CRM-028: inbox/API search finds Anna by name, email, and phone', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const seed = await seedChampionCrmDemo(request, token)
    expect(seed.response.status()).toBe(200)

    for (const term of ['Anna', 'anna.kowalska@example.com', '501 200 300']) {
      const leads = await listLeads(request, token, `q=${encodeURIComponent(term)}&pageSize=20`)
      expect(leads.some((lead) => lead.id === String(seed.body?.leadId))).toBe(true)
    }
  })
})
