import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createCompanyFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

async function createInteraction(
  request: Parameters<typeof apiRequest>[0],
  token: string,
  data: Record<string, unknown>,
) {
  const response = await apiRequest(request, 'POST', '/api/customers/interactions', { token, data })
  expect(response.ok(), `interaction create should succeed: ${response.status()}`).toBeTruthy()
  const payload = await response.json().catch(() => null as { id?: string } | null)
  const id = payload?.id ?? null
  expect(id).toBeTruthy()
  return id as string
}

test.describe('TC-CRM-036: Company activity log tab history and planned state', () => {
  test('should create, filter, and search activities on the activity log tab', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    const interactionIds: string[] = []

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA Activity Log ${Date.now()}`)

      const callTitle = `QA Activity Call ${Date.now()}`
      const emailTitle = `QA Activity Email ${Date.now()}`
      const overdueTitle = `QA Overdue Meeting ${Date.now()}`
      const nowIso = new Date().toISOString()
      const overdueDate = new Date(Date.now() - 86400000).toISOString()

      interactionIds.push(await createInteraction(request, token, {
        entityId: companyId,
        interactionType: 'call',
        title: callTitle,
        body: 'Discussed rollout timeline.',
        status: 'done',
        occurredAt: nowIso,
      }))
      interactionIds.push(await createInteraction(request, token, {
        entityId: companyId,
        interactionType: 'email',
        title: emailTitle,
        body: 'Sent the proposal summary.',
        status: 'done',
        occurredAt: nowIso,
      }))
      interactionIds.push(await createInteraction(request, token, {
        entityId: companyId,
        interactionType: 'meeting',
        title: overdueTitle,
        body: 'Missed check-in with the customer.',
        status: 'planned',
        scheduledAt: overdueDate,
      }))

      await login(page, 'admin')
      await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible({ timeout: 10_000 })

      await page.getByRole('tab', { name: /activity log/i }).click()

      await expect(page.getByText(/log activity/i).first()).toBeVisible()
      await expect(page.getByText(/overdue|zaległe/i).first()).toBeVisible()
      await expect(page.getByRole('heading', { name: callTitle }).first()).toBeVisible()
      await expect(page.getByRole('heading', { name: emailTitle }).first()).toBeVisible()

      const composerRequestPromise = page.waitForResponse((response) =>
        response.url().includes('/api/customers/interactions') &&
        response.request().method() === 'POST',
      )
      const inlineText = `QA inline activity ${Date.now()}`
      await page.getByPlaceholder(/what happened\?/i).fill(inlineText)
      await page.getByRole('button', { name: /save activity/i }).click()
      const composerResponse = await composerRequestPromise
      expect(composerResponse.ok()).toBeTruthy()
      const composerPayload = await composerResponse.json().catch(() => null as { id?: string } | null)
      if (composerPayload?.id) interactionIds.push(composerPayload.id)

      await expect(page.getByRole('heading', { name: inlineText }).first()).toBeVisible()

      await page.getByRole('button', { name: /^Call 2$/ }).click()
      await expect(page.getByRole('heading', { name: callTitle })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: emailTitle }).first()).toBeVisible()

      await page.getByPlaceholder(/search by title, note, or author/i).fill(emailTitle)
      await expect(page.getByRole('heading', { name: emailTitle }).first()).toBeVisible()
      await expect(page.getByRole('heading', { name: inlineText })).toHaveCount(0)
    } finally {
      for (const interactionId of interactionIds) {
        if (token) {
          await apiRequest(
            request,
            'DELETE',
            `/api/customers/interactions?id=${encodeURIComponent(interactionId)}`,
            { token },
          ).catch(() => {})
        }
      }
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
