import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, createPersonFixture, deleteEntityIfExists, readJsonSafe } from '@open-mercato/core/helpers/integration/crmFixtures'

for (const kind of ['person', 'company'] as const) {
  test(`TC-CRM-8286: ${kind} Activities preserves unknown dates and entity scope`, async ({ page, request }) => {
    test.setTimeout(90_000)
    const token = await getAuthToken(request, 'admin')
    const stamp = `${Date.now()}-${kind}`
    const interactionIds: string[] = []
    let entityId: string | null = null
    let otherId: string | null = null
    const entityPath = kind === 'person' ? '/api/customers/people' : '/api/customers/companies'
    try {
      entityId = kind === 'person'
        ? await createPersonFixture(request, token, { firstName: 'Unknown', lastName: stamp, displayName: `Unknown ${stamp}` })
        : await createCompanyFixture(request, token, `Unknown ${stamp}`)
      otherId = await createCompanyFixture(request, token, `Other ${stamp}`)
      const fixtures = [
        { title: `Undated A ${stamp}`, occurredAt: null, entityId },
        { title: `Older ${stamp}`, occurredAt: '2020-01-02T12:00:00.000Z', entityId },
        { title: `Undated B ${stamp}`, occurredAt: null, entityId },
        { title: `Newer ${stamp}`, occurredAt: '2020-02-02T12:00:00.000Z', entityId },
        { title: `Other ${stamp}`, occurredAt: null, entityId: otherId },
      ]
      for (const fixture of fixtures) {
        const response = await apiRequest(request, 'POST', '/api/customers/interactions', {
          token, data: { ...fixture, interactionType: 'call', status: 'done', scheduledAt: null },
        })
        expect(response.ok()).toBeTruthy()
        const payload = await readJsonSafe<{ id: string }>(response)
        expect(payload?.id).toBeTruthy()
        interactionIds.push(payload!.id)
      }
      const response = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${entityId}&limit=100`, { token })
      expect(response.ok()).toBeTruthy()
      const payload = await readJsonSafe<{ items: Array<{ id: string; occurredAt: string | null; createdAt: string; entityId: string }> }>(response)
      expect(payload?.items.map((item) => item.id).sort()).toEqual(interactionIds.slice(0, 4).sort())
      for (const index of [0, 2]) {
        const row = payload?.items.find((item) => item.id === interactionIds[index])
        expect(row?.occurredAt).toBeNull()
        expect(row?.createdAt).toBeTruthy()
      }
      const unauthenticated = await page.request.get(`/api/customers/interactions?entityId=${entityId}`)
      expect(unauthenticated.status()).toBe(401)
      await login(page, 'admin')
      await page.goto(`/backend/customers/${kind === 'person' ? 'people' : 'companies'}/${entityId}?tab=activities`)
      const activitiesTab = page.getByRole('tab', { name: /^Activities$/i })
      if (await activitiesTab.count()) await activitiesTab.click()
      await expect(page.getByText(fixtures[0].title, { exact: true })).toBeVisible()
      const timeline = page.getByRole('heading', { name: 'Interaction history', exact: true }).locator('xpath=../..')
      await expect(timeline.getByText('Unknown date', { exact: true })).toHaveCount(2)
      const expectedUndatedIds = [interactionIds[0], interactionIds[2]].sort().reverse()
      const expectedTitles = [fixtures[3].title, fixtures[1].title, ...expectedUndatedIds.map((id) => fixtures[interactionIds.indexOf(id)].title)]
      const displayedTitles = timeline.getByText(new RegExp(`^(?:Undated A|Undated B|Older|Newer) ${stamp}$`))
      await expect(displayedTitles).toHaveText(expectedTitles)
      await expect(page.getByText(fixtures[4].title, { exact: true })).toHaveCount(0)
      await page.screenshot({ path: test.info().outputPath(`${kind}-unknown-activity-dates.png`), fullPage: true })
    } finally {
      for (const id of interactionIds.reverse()) await deleteEntityIfExists(request, token, '/api/customers/interactions', id)
      await deleteEntityIfExists(request, token, entityPath, entityId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', otherId)
    }
  })
}
