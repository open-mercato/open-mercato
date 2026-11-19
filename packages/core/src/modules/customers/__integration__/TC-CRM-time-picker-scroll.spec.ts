import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

test('the meeting start-time picker scrolls without handing wheel or touch movement to the modal', async ({ page, request }) => {
  test.slow()
  const token = await getAuthToken(request, 'admin')
  const personId = await createPersonFixture(request, token, {
    firstName: 'Time Picker',
    lastName: 'QA',
    displayName: `Time Picker QA ${Date.now()}`,
  })

  try {
    await login(page, 'admin')
    await page.goto(`/backend/customers/people-v2/${personId}`)
    await page.getByRole('tab', { name: 'Activities', exact: true }).click()
    await page.getByRole('button', { name: 'Add new', exact: true }).click()
    await page.getByRole('button', { name: 'New meeting', exact: true }).click()

    const meeting = page.getByRole('dialog', { name: 'New meeting' })
    const startTime = meeting.locator('button[aria-haspopup="dialog"]').nth(1)
    await startTime.click()
    const slots = page.locator('[data-slot="time-picker-slots"]')
    await expect(slots).toBeVisible()

    await slots.hover()
    const before = await slots.evaluate((element) => {
      element.scrollTop = 0
      return {
        pageTop: window.scrollY,
        modalTop: document.querySelector('[data-slot="dialog-content"]')?.scrollTop,
      }
    })
    await page.mouse.wheel(0, 300)
    await expect.poll(() => slots.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    expect(await page.evaluate(() => ({
      pageTop: window.scrollY,
      modalTop: document.querySelector('[data-slot="dialog-content"]')?.scrollTop,
    }))).toEqual(before)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(slots).toBeVisible()
    const touch = await slots.evaluate((element) => {
      let reachedDocument = false
      const observe = () => { reachedDocument = true }
      document.addEventListener('touchmove', observe)
      try {
        const event = new TouchEvent('touchmove', { bubbles: true, cancelable: true })
        element.dispatchEvent(event)
        return { reachedDocument, defaultPrevented: event.defaultPrevented }
      } finally {
        document.removeEventListener('touchmove', observe)
      }
    })
    expect(touch).toEqual({ reachedDocument: false, defaultPrevented: false })
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
  }
})
