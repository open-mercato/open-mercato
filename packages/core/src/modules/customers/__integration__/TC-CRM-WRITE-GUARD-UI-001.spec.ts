import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createUserFixture, deleteUserIfExists, setUserAclVisibility } from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

type Interaction = {
  id: string
  title: string
  status: string
  organizationId: string
  scheduledAt: string | null
  occurredAt: string | null
  body: string | null
  customValues: Record<string, unknown> | null
  updatedAt: string
}

async function readCall(request: APIRequestContext, token: string, companyId: string) {
  const response = await apiRequest(request, 'GET', `/api/customers/interactions?entityId=${companyId}`, { token })
  expect(response.status()).toBe(200)
  const data = await readJsonSafe<{ items: Interaction[] }>(response)
  expect(data?.items).toHaveLength(1)
  return data!.items[0]
}

test('TC-CRM-WRITE-GUARD-UI-001: completed call edits preserve its data and reject stale changes', async ({ page, request }) => {
  test.slow()
  const fixtureId = randomUUID()
  const title = `Call ${fixtureId}`
  const editedTitle = `Completed call ${fixtureId}`
  const notes = 'Discuss the renewal schedule'
  const token = await getAuthToken(request, 'admin')
  let companyId: string | null = null
  let activityId: string | null = null
  let otherUserId: string | null = null
  const dialog = page.getByRole('dialog')
  const phone = dialog.locator('#schedule-call-phone')
  const schedulePickers = dialog.locator('button[aria-haspopup="dialog"]')
  const historyRow = (callTitle: string) => page.getByRole('button').filter({ hasText: callTitle }).filter({ hasText: notes })
  const waitForCallUpdate = () => page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/customers/interactions' && response.request().method() === 'PUT',
  )

  try {
    await login(page, 'admin')
    await page.goto('/backend/customers/companies/create')
    const form = page.locator('form')
    await form.getByRole('textbox').first().fill(`Write guard ${fixtureId}`)
    await form.getByRole('button', { name: /create company/i }).click()
    await expect(page).toHaveURL(/\/backend\/customers\/companies-v2\/[\da-f-]{36}$/i)
    companyId = new URL(page.url()).pathname.split('/').pop()!

    await page.getByRole('tab', { name: 'Activity log' }).click()
    await page.getByRole('button', { name: 'Schedule', exact: true }).first().click()
    await dialog.getByRole('button', { name: 'Call', exact: true }).click()
    await dialog.getByPlaceholder('Activity title...').fill(title)
    await phone.fill('+12125551234')
    await dialog.locator('textarea:visible, [contenteditable="true"]:visible').fill(notes)
    await dialog.getByPlaceholder('Activity title...').press('ControlOrMeta+Enter')
    await expect(dialog).toBeHidden()
    const planned = await readCall(request, token, companyId)
    activityId = planned.id
    expect(planned).toMatchObject({
      title, status: 'planned', scheduledAt: expect.any(String),
      body: expect.stringContaining(notes), customValues: { callPhoneNumber: '+12125551234' },
    })

    const markDone = page.getByRole('button', { name: 'Mark done', exact: true })
    await historyRow(title).locator(markDone).click()
    await expect.poll(async () => (await readCall(request, token, companyId!)).status).toBe('done')
    const completed = await readCall(request, token, companyId)
    expect(completed.occurredAt).toEqual(expect.any(String))
    await historyRow(title).filter({ hasNot: markDone }).press('Enter')
    const displayedPhone = await phone.inputValue()
    expect(displayedPhone.replace(/\D/g, '')).toMatch(/2125551234$/)
    const displayedSchedule = await schedulePickers.allTextContents()
    expect(displayedSchedule.length).toBeGreaterThanOrEqual(2)
    const editTitle = dialog.getByPlaceholder('Activity title...')
    await editTitle.fill(editedTitle)
    const titleUpdate = waitForCallUpdate()
    await editTitle.press('ControlOrMeta+Enter')
    expect((await titleUpdate).status()).toBe(200)
    await expect(dialog).toBeHidden()
    await page.reload()
    await page.getByRole('tab', { name: 'Activity log' }).click()
    await historyRow(editedTitle).press('Enter')
    await expect(phone).toHaveValue(displayedPhone)
    await expect(schedulePickers).toHaveText(displayedSchedule)
    const saved = await readCall(request, token, companyId)
    expect(saved.updatedAt).not.toBe(completed.updatedAt)
    expect(saved).toEqual({ ...completed, title: editedTitle, updatedAt: saved.updatedAt })
    await page.keyboard.press('Escape')

    await page.context().addCookies([{ name: 'locale', value: 'pl', url: new URL(page.url()).origin }])
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.getByRole('tab', { name: 'Dziennik aktywności' }).click()
    await historyRow(editedTitle).press('Enter')
    await phone.scrollIntoViewIfNeeded()
    await expect(phone).toBeInViewport()
    const polishTitle = dialog.getByPlaceholder('Tytuł aktywności...')
    await phone.fill('12')
    await polishTitle.press('ControlOrMeta+Enter')
    await expect(dialog.getByText(/wprowadź prawidłowy numer telefonu/i).first()).toBeVisible()
    await phone.fill(displayedPhone)
    await polishTitle.press('Escape')
    await expect(dialog).toBeHidden()
    expect(await readCall(request, token, companyId)).toEqual(saved)

    await historyRow(editedTitle).press('Enter')
    await polishTitle.fill(`Conflicting edit ${fixtureId}`)
    const email = `crm-write-guard-${fixtureId}@example.com`
    const password = `Aa1!${fixtureId}`
    otherUserId = await createUserFixture(request, token, {
      email, password, organizationId: saved.organizationId, roles: [],
    })
    await setUserAclVisibility(request, token, {
      userId: otherUserId, organizations: [saved.organizationId], features: ['customers.interactions.manage', 'customers.interactions.view'],
    })
    const newerTitle = `Concurrent call ${fixtureId}`
    await withCredentialIsolatedRequest(async (otherRequest) => {
      const otherToken = await getAuthToken(otherRequest, email, password)
      const update = await apiRequest(otherRequest, 'PUT', '/api/customers/interactions', {
        token: otherToken, data: { id: saved.id, title: newerTitle },
      })
      expect(update.status()).toBe(200)
    })
    const latest = await readCall(request, token, companyId)
    expect(latest.updatedAt).not.toBe(saved.updatedAt)
    expect(latest).toEqual({ ...saved, title: newerTitle, updatedAt: latest.updatedAt })
    const conflict = waitForCallUpdate()
    await polishTitle.press('ControlOrMeta+Enter')
    expect((await conflict).status()).toBe(409)
    await expect(page.getByTestId('record-conflict-banner')).toBeVisible()
    expect(await readCall(request, token, companyId)).toEqual(latest)
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/interactions', activityId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    await deleteUserIfExists(request, token, otherUserId)
  }
})
