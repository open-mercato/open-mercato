import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'auth'] }

test('report periods show distinct complete end dates on desktop and narrow screens', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request, 'admin')
  const name = `QA report period ${Date.now()}`
  const cleanup: { path: string; id: string }[] = []
  async function createRecord(context: APIRequestContext, path: string, data: Record<string, unknown>) {
    const response = await apiRequest(context, 'POST', path, { token, data })
    expect(response.status(), `create ${path}`).toBe(201)
    const id = expectId((await readJsonSafe<{ id?: unknown }>(response))?.id, path)
    cleanup.unshift({ path, id })
    return id
  }
  try {
    const customerId = await createCompanyFixture(request, token, name)
    cleanup.unshift({ path: '/api/customers/companies', id: customerId })
    const staffMemberId = await createRecord(request, '/api/staff/team-members', { displayName: name })
    const projectId = await createRecord(request, '/api/staff/timesheets/time-projects', {
      name, code: `QA-RP-${Date.now()}`, customerId, status: 'active', currencyCode: 'EUR', billableByDefault: true,
    })
    const assignment = await apiRequest(request, 'POST', `/api/staff/timesheets/time-projects/${projectId}/employees`, {
      token, data: { staffMemberId, status: 'active', assignedStartDate: '2026-09-01' },
    })
    expect(assignment.ok()).toBe(true)
    await createRecord(request, '/api/staff/timesheets/time-entries', {
      staffMemberId, timeProjectId: projectId, date: '2026-09-10', durationMinutes: 60,
      source: 'manual', isBillable: true, description: name,
    })
    for (const endDate of ['2026-09-23', '2026-09-30']) {
      await createRecord(request, '/api/staff/timesheets/reports', {
        customerId, title: `${name} ${endDate}`, periodKind: 'custom', periodFrom: '2026-09-01',
        periodTo: endDate, timeProjectIds: [projectId], showRates: false,
      })
    }
    await login(page, 'admin')
    await page.goto('/backend/staff/time-tracking/reports')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const endDate of ['2026-09-23', '2026-09-30']) {
        const row = page.getByRole('row').filter({ hasText: `${name} ${endDate}` })
        const period = row.getByText(`2026-09-01 – ${endDate}`, { exact: true })
        await expect(period).toBeVisible()
        expect(await period.evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const cell = element.closest('td')?.getBoundingClientRect()
          return cell !== undefined && Array.from(range.getClientRects()).every((rect) => rect.left >= cell.left && rect.right <= cell.right)
        })).toBe(true)
      }
      await testInfo.attach(`report-period-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    }
  } finally {
    for (const record of cleanup) await deleteEntityIfExists(request, token, record.path, record.id)
  }
})
