import { expect, test, type Locator, type Page } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCompanyFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'

// The company Activity log reaches the dialog two ways: the "Add new" menu of the activities
// card, or the Schedule action of the inline composer that replaces it (#7494). Both open a
// new meeting, so the helper takes whichever the page offers.
async function openNewMeetingDialog(page: Page, companyId: string): Promise<Locator> {
  await page.goto(`/backend/customers/companies-v2/${companyId}?tab=activity-log`, { waitUntil: 'domcontentloaded' })
  const addNewTrigger = page.getByRole('button', { name: /^Add new$/ })
  const scheduleAction = page.getByRole('button', { name: 'Schedule', exact: true }).first()
  await expect(addNewTrigger.or(scheduleAction).first()).toBeVisible({ timeout: 30_000 })
  if (await addNewTrigger.isVisible()) {
    await addNewTrigger.click()
    await page.getByRole('button', { name: 'New meeting' }).click()
  } else {
    await scheduleAction.click()
  }
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: /^Save activity$/ }) })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  return dialog
}

/**
 * TC-CRM-5629 (schedule dialog): the two interactions of the schedule activity
 * dialog that unit tests cannot protect (#5629, #9237).
 *
 *   1. The start time list opens from inside the modal dialog. It must scroll
 *      with the wheel, apply a picked time, and close on Escape without closing
 *      the dialog. The picker is a shared primitive; this is the consuming side.
 *   2. The "After occurrences" field can be cleared while the number is being
 *      replaced. An empty field blocks the save instead of turning into 1, and
 *      the saved series keeps the typed count after the dialog is reopened.
 *   3. An invalid series draft left on a meeting must not block a task: the task
 *      form has no recurrence controls, so nothing there could be corrected.
 *      Switching back to Meeting brings the check back.
 */
test.describe('TC-CRM-5629: schedule activity dialog time list and occurrences count (#5629)', () => {
  test('start time list scrolls inside the dialog, applies a time, and Escape closes only the list', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    const stamp = Date.now()

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-5629 Time Co ${stamp}`)

      await login(page, 'admin')
      const dialog = await openNewMeetingDialog(page, companyId)

      const timeTrigger = dialog.locator('button[aria-haspopup="dialog"]').filter({ hasText: /\d{1,2}:\d{2}|Pick a time/ }).first()
      await timeTrigger.click()
      const picker = page.locator('[data-slot="time-picker"]')
      await expect(picker).toBeVisible({ timeout: 10_000 })
      const slots = picker.locator('[data-slot="time-picker-slots"]')

      // The picker scrolls the selected slot into view on open; wait for that to
      // settle, then wheel away from whichever end the list is closer to.
      await expect
        .poll(async () => slots.evaluate((element) => element.scrollHeight > element.clientHeight), { timeout: 10_000 })
        .toBe(true)
      await page.waitForTimeout(400)
      const before = await slots.evaluate((element) => ({
        top: element.scrollTop,
        max: element.scrollHeight - element.clientHeight,
      }))
      const box = await slots.boundingBox()
      expect(box, 'slot list has a layout box').not.toBeNull()
      await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2)
      const delta = before.top > before.max / 2 ? -240 : 240
      await page.mouse.wheel(0, delta)
      await expect
        .poll(async () => slots.evaluate((element) => element.scrollTop), {
          timeout: 5_000,
          message: 'the wheel must scroll the slot list inside the modal dialog',
        })
        .not.toBe(before.top)

      const pickedSlot = picker.locator('[data-slot="time-picker-slot"][aria-label="09:30"]')
      await pickedSlot.scrollIntoViewIfNeeded()
      await pickedSlot.click()
      await picker.locator('[data-slot="time-picker-apply"]').click()
      await expect(picker).toBeHidden({ timeout: 5_000 })
      await expect(timeTrigger).toContainText(/9:30/)
      await expect(dialog).toBeVisible()

      await timeTrigger.click()
      await expect(picker).toBeVisible({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      await expect(picker).toBeHidden({ timeout: 5_000 })
      await expect(dialog, 'Escape closes the time list, not the schedule dialog').toBeVisible()
      await expect(timeTrigger).toContainText(/9:30/)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('occurrences count can be cleared and replaced, and the saved series keeps the typed count', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()
    const title = `QA TC-CRM-5629 weekly ${stamp}`

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-5629 Count Co ${stamp}`)

      await login(page, 'admin')
      const dialog = await openNewMeetingDialog(page, companyId)

      const titleInput = dialog.locator('input[aria-required="true"]').first()
      await titleInput.fill(title)
      await expect(titleInput).toHaveValue(title)

      await dialog.getByRole('button', { name: 'Does not repeat' }).click()
      await dialog.getByRole('button', { name: 'After occurrences' }).click()
      const countInput = dialog.getByRole('spinbutton', { name: 'After occurrences' })
      const saveButton = dialog.getByRole('button', { name: /^Save activity$/ })
      await expect(countInput).toHaveValue('8')
      await expect(saveButton).toBeEnabled()

      await countInput.fill('')
      await expect(countInput, 'a cleared field stays empty instead of turning into 1').toHaveValue('')
      await expect(countInput).toHaveAttribute('aria-invalid', 'true')
      await expect(dialog.getByText('Enter a whole number of 1 or more.')).toBeVisible()
      await expect(saveButton).toBeDisabled()

      await countInput.fill('4')
      await expect(countInput).toHaveValue('4')
      await expect(dialog.getByText('Enter a whole number of 1 or more.')).toHaveCount(0)
      await expect(saveButton).toBeEnabled()

      const created = page.waitForResponse(
        (response) =>
          response.url().includes('/api/customers/interactions') && response.request().method() === 'POST',
        { timeout: 30_000 },
      )
      await saveButton.click()
      const createResponse = await created
      expect(createResponse.ok(), `POST /api/customers/interactions returned ${createResponse.status()}`).toBeTruthy()
      const sentBody = createResponse.request().postDataJSON() as { recurrenceRule?: string | null }
      expect(sentBody.recurrenceRule).toMatch(/^FREQ=WEEKLY;BYDAY=[A-Z,]+;COUNT=4$/)
      const createdBody = (await createResponse.json().catch(() => null)) as { id?: string } | null
      interactionId = createdBody?.id ?? null
      await expect(dialog).toBeHidden({ timeout: 15_000 })

      const listResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/interactions?entityId=${companyId}&limit=20`,
        { token },
      )
      expect(listResponse.ok()).toBeTruthy()
      const list = (await listResponse.json()) as { items?: Array<{ id: string; title?: string; recurrenceRule?: string | null }> }
      const saved = list.items?.find((item) => item.title === title)
      expect(saved, 'the saved meeting is returned by the list API').toBeTruthy()
      interactionId = interactionId ?? saved?.id ?? null
      expect(saved?.recurrenceRule).toMatch(/COUNT=4$/)

      await page.getByText(title).first().click()
      const editDialog = page.getByRole('dialog').filter({ has: page.getByRole('spinbutton', { name: 'After occurrences' }) })
      await expect(editDialog).toBeVisible({ timeout: 15_000 })
      await expect(editDialog.getByRole('spinbutton', { name: 'After occurrences' })).toHaveValue('4')
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })

  test('an invalid series draft does not block saving a task, and blocks the meeting again', async ({ page, request }) => {
    test.slow()

    let token: string | null = null
    let companyId: string | null = null
    let interactionId: string | null = null
    const stamp = Date.now()
    const title = `QA TC-CRM-5629 task ${stamp}`

    try {
      token = await getAuthToken(request, 'admin')
      companyId = await createCompanyFixture(request, token, `QA TC-CRM-5629 Task Co ${stamp}`)

      await login(page, 'admin')
      await openNewMeetingDialog(page, companyId)
      const dialog = page.getByRole('dialog').filter({ has: page.locator('input[aria-required="true"]') })

      const titleInput = dialog.locator('input[aria-required="true"]').first()
      await titleInput.fill(title)
      await expect(titleInput).toHaveValue(title)

      await dialog.getByRole('button', { name: 'Does not repeat' }).click()
      await dialog.getByRole('button', { name: 'After occurrences' }).click()
      const countInput = dialog.getByRole('spinbutton', { name: 'After occurrences' })
      await countInput.fill('')
      await expect(countInput).toHaveValue('')
      await expect(dialog.getByRole('button', { name: /^Save activity$/ })).toBeDisabled()

      await dialog.getByRole('button', { name: 'Task', exact: true }).click()
      await expect(countInput, 'the task form has no recurrence controls').toHaveCount(0)
      const saveTask = dialog.getByRole('button', { name: /^Save task$/ })
      await expect(saveTask, 'a hidden series draft must not block the task').toBeEnabled()

      await dialog.getByRole('button', { name: 'Meeting', exact: true }).click()
      await expect(countInput).toHaveValue('')
      await expect(dialog.getByRole('button', { name: /^Save activity$/ })).toBeDisabled()

      await dialog.getByRole('button', { name: 'Task', exact: true }).click()
      await expect(saveTask).toBeEnabled()
      const created = page.waitForResponse(
        (response) =>
          response.url().includes('/api/customers/interactions') && response.request().method() === 'POST',
        { timeout: 30_000 },
      )
      await saveTask.click()
      const createResponse = await created
      expect(createResponse.ok(), `POST /api/customers/interactions returned ${createResponse.status()}`).toBeTruthy()
      const sentBody = createResponse.request().postDataJSON() as { recurrenceRule?: string | null }
      expect(sentBody.recurrenceRule ?? null, 'a task is saved without a series').toBeNull()
      const createdBody = (await createResponse.json().catch(() => null)) as { id?: string } | null
      interactionId = createdBody?.id ?? null
      await expect(dialog).toBeHidden({ timeout: 15_000 })
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/interactions', interactionId)
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
    }
  })
})
