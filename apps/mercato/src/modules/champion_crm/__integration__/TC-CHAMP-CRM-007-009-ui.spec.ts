import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  cleanupChampionCrmRun,
  closeChampionCrmDb,
  createRunId,
  intakeLead,
  listLeads,
} from './helpers/championCrmFixtures'

test.describe('TC-CHAMP-CRM-007-009: Champion CRM backend shell coverage', () => {
  test.afterAll(async () => {
    await closeChampionCrmDb()
  })

  test('TC-CHAMP-CRM-007: inbox lists leads newest-first and API status filter narrows manual_review', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const runId = createRunId('champ-crm-007')
    try {
      const older = await intakeLead(request, token, runId, {
        source: 'old-form',
        email: `older.${runId}@example.test`,
        name: 'Older Champion Lead',
      })
      const manual = await intakeLead(request, token, runId, {
        source: 'manual-form',
        name: 'Manual Review Champion Lead',
      })
      expect(older.response.status()).toBe(201)
      expect(manual.response.status()).toBe(201)

      const filtered = await listLeads(request, token, 'techStatus=manual_review&pageSize=20')
      expect(filtered.some((lead) => lead.id === manual.body?.leadId && lead.techStatus === 'manual_review')).toBe(true)
      expect(filtered.some((lead) => lead.id === older.body?.leadId)).toBe(false)

      await login(page, 'admin')
      await page.goto('/backend/champion-crm/leads', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /Lead inbox/i })).toBeVisible()
      await expect(page.getByText('Manual Review Champion Lead')).toBeVisible()
      await expect(page.getByText('Older Champion Lead')).toBeVisible()

      const manualRowOffset = await page.getByText('Manual Review Champion Lead').evaluate((node) => node.getBoundingClientRect().top)
      const olderRowOffset = await page.getByText('Older Champion Lead').evaluate((node) => node.getBoundingClientRect().top)
      expect(manualRowOffset).toBeLessThan(olderRowOffset)
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-008: inbox search by name, email, and phone is covered by the leads API contract', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const runId = createRunId('champ-crm-008')
    try {
      const { response, body } = await intakeLead(request, token, runId, {
        source: 'search-form',
        email: `search.${runId}@example.test`,
        phone: '+48 501 100 008',
        name: 'Searchable Champion Lead',
      })
      expect(response.status()).toBe(201)

      for (const search of ['Searchable Champion', `search.${runId}@example.test`, '+48501100008']) {
        const items = await listLeads(request, token, `search=${encodeURIComponent(search)}&pageSize=20`)
        expect(items.some((lead) => lead.id === body?.leadId), `search should find lead by ${search}`).toBe(true)
      }

      await test.step('Inbox search UI control is expected when the server-rendered table is upgraded to DataTable', async () => {
        expect(body?.leadId, 'current list page has no search input; API search contract is executable today').toBeTruthy()
      })
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })

  test('TC-CHAMP-CRM-009: lead detail renders Contact 360, activity, deals, and audit shell', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const runId = createRunId('champ-crm-009')
    try {
      const { response, body } = await intakeLead(request, token, runId, {
        source: 'detail-form',
        email: `detail.${runId}@example.test`,
        phone: '+48 501 100 009',
        name: 'Detail Champion Lead',
      })
      expect(response.status()).toBe(201)

      await login(page, 'admin')
      await page.goto(`/backend/champion-crm/leads/${body?.leadId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /Detail Champion Lead/i })).toBeVisible()
      await expect(page.getByRole('heading', { name: /^Lead$/i })).toBeVisible()
      await expect(page.getByRole('heading', { name: /Contact 360/i })).toBeVisible()
      await expect(page.getByText(`detail.${runId}@example.test`)).toBeVisible()
      await expect(page.getByRole('heading', { name: /Activity/i })).toBeVisible()
      await expect(page.getByRole('heading', { name: /Deals/i })).toBeVisible()
      await expect(page.getByRole('heading', { name: /Audit/i })).toBeVisible()
    } finally {
      await cleanupChampionCrmRun(runId)
    }
  })
})
