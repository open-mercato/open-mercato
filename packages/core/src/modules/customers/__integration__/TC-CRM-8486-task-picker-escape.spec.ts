import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createPersonFixture,
  deleteEntityIfExists,
  readJsonSafe,
} from '@open-mercato/core/helpers/integration/crmFixtures'

const interactionsPath = '/api/customers/interactions'

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`TC-CRM-8486: Escape dismisses the task date picker first at ${viewport.width}px`, async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const title = `Task picker ${crypto.randomUUID()}`
    const draftTitle = `${title} draft`
    const personId = await createPersonFixture(request, token, {
      firstName: 'Task',
      lastName: 'Picker',
      displayName: title,
    })
    let taskId: string | undefined

    try {
      const created = await apiRequest(request, 'POST', interactionsPath, {
        token,
        data: {
          entityId: personId,
          interactionType: 'task',
          title,
          status: 'planned',
          occurredAt: new Date().toISOString(),
        },
      })
      expect(created.status()).toBe(201)
      taskId = (await readJsonSafe<{ id?: string }>(created))?.id
      expect(taskId).toBeTruthy()

      await page.setViewportSize(viewport)
      await login(page, 'admin')
      await page.goto(`/backend/customers/people-v2/${personId}?tab=tasks`)
      if (viewport.width === 390) {
        await page.getByRole('tab', { name: 'Activity', exact: true }).click()
      }
      const task = page.getByRole('article').filter({ has: page.getByText(title, { exact: true }) })
      await task.getByRole('button', { name: 'Edit', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: /edit task/i })
      const titleField = dialog.getByRole('textbox', { name: /^Title(?:\s*\*)?$/ })
      await titleField.fill(draftTitle)

      const trigger = dialog.getByRole('button', { name: 'Scheduled for', exact: true })
      await trigger.click()
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      const picker = page.getByRole('dialog').filter({ has: page.getByRole('grid') })
      await expect(picker).toBeVisible()
      const day = picker.getByRole('grid').getByRole('button').first()
      await day.focus()
      await expect(day).toBeFocused()
      await page.keyboard.press('Escape')

      await expect(picker).toBeHidden()
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      await expect(dialog).toBeVisible()
      await expect(titleField).toHaveValue(draftTitle)

      await titleField.press('Escape')
      await expect(dialog).toBeHidden()
      const listed = await apiRequest(request, 'GET', `${interactionsPath}?entityId=${personId}&interactionType=task`, { token })
      expect(listed.status()).toBe(200)
      const result = await readJsonSafe<{ items?: Array<{ id: string; title: string }> }>(listed)
      expect(result?.items?.find((item) => item.id === taskId)?.title).toBe(title)
    } finally {
      try {
        if (taskId) await deleteEntityIfExists(request, token, interactionsPath, taskId)
      } finally {
        await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      }
    }
  })
}
