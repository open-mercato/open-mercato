import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createCompanyFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

test.use({ timezoneId: 'UTC' })

test('wheel-scrolls the schedule dialog time list and restores the saved time on reopen', async ({ page, request }) => {
  const token = await getAuthToken(request, 'admin')
  const title = `QA TimePicker wheel ${Date.now()}`
  const activityDate = new Date()
  activityDate.setUTCDate(activityDate.getUTCDate() - 3)
  activityDate.setUTCHours(8, 0, 0, 0)
  const scheduledAt = activityDate.toISOString()
  let companyId: string | null = null
  let interactionId: string | null = null

  try {
    companyId = await createCompanyFixture(request, token, `Company for ${title}`)
    const created = await apiRequest(request, 'POST', '/api/customers/interactions', {
      token,
      data: {
        entityId: companyId,
        interactionType: 'meeting',
        title,
        status: 'done',
        scheduledAt,
        occurredAt: scheduledAt,
      },
    })
    expect(created.status(), await created.text()).toBe(201)
    interactionId = (await readJsonSafe<{ id: string }>(created))?.id ?? null
    expect(interactionId).toBeTruthy()

    await login(page, 'admin')
    await page.goto(`/backend/customers/companies-v2/${companyId}`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: /Activity log/i }).click()
    const activity = page.getByRole('button', { name: new RegExp(title) })
    await activity.click()

    const dialog = page.getByRole('dialog', { name: 'Edit activity', exact: true })
    await dialog.getByRole('button', { name: /^0?8:00\s+AM$/i }).click()

    const slotList = page.locator('[data-slot="time-picker-slots"]')
    const initialSlot = slotList.getByRole('button', { name: '08:00', exact: true })
    await expect(initialSlot).toHaveAttribute('aria-pressed', 'true')
    await expect(initialSlot).toBeInViewport()

    await slotList.hover()
    const initialScrollTop = await slotList.evaluate((list) => list.scrollTop)
    await page.mouse.wheel(0, 540)
    await expect.poll(() => slotList.evaluate((list) => list.scrollTop)).toBeGreaterThan(initialScrollTop)

    const laterSlot = slotList.getByRole('button', { name: '15:00', exact: true })
    await expect(laterSlot).toBeInViewport()
    await laterSlot.click()
    await expect(laterSlot).toHaveAttribute('aria-pressed', 'true')
    await page.locator('[data-slot="time-picker"]').getByRole('button', { name: 'Apply', exact: true }).click()
    const updated = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/customers/interactions' && response.request().method() === 'PUT',
    )
    await dialog.getByRole('button', { name: 'Update activity', exact: true }).click()
    const updateResponse = await updated
    expect(updateResponse.status(), await updateResponse.text()).toBe(200)
    const { scheduledAt: savedTime } = updateResponse.request().postDataJSON() as { scheduledAt: string }
    activityDate.setUTCHours(15)
    expect(new Date(savedTime).toISOString()).toBe(activityDate.toISOString())
    await expect(dialog).toBeHidden()

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: /Activity log/i }).click()
    await activity.click()
    await dialog.getByRole('button', { name: /^0?3:00\s+PM$/i }).click()
    await expect(laterSlot).toHaveAttribute('aria-pressed', 'true')
    await expect(laterSlot).toBeInViewport()
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
    await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
  }
})
