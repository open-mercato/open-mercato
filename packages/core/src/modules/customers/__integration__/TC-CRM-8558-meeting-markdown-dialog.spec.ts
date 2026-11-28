import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

test('TC-CRM-8558: meeting Markdown dropdown stays clickable and dismisses before the dialog', async ({ page, request }, testInfo) => {
  const token = await getAuthToken(request, 'admin')
  const lastName = randomUUID()
  const personId = await createPersonFixture(request, token, {
    firstName: 'Meeting',
    lastName,
    displayName: `Meeting ${lastName}`,
  })

  try {
    await login(page, 'admin')
    await page.goto(`/backend/customers/people-v2/${personId}?tab=activities`)

    const schedule = page.getByRole('button', { name: 'Schedule', exact: true }).first()
    await schedule.click()

    const meeting = page.getByRole('dialog', { name: 'New meeting' })
    const editor = meeting.getByTestId('mdx-editor-container')
    const description = editor.getByLabel('editable markdown')
    const blockType = editor.getByRole('combobox', { name: 'Block type' })
    const listbox = page.getByRole('listbox')
    const headingText = 'Meeting agenda'

    await description.fill(headingText)
    await blockType.click()
    await expect(listbox).toBeVisible()
    await testInfo.attach('meeting-markdown-block-type-open', {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    })
    await expect.poll(() => listbox.evaluate((element) => {
      const { left, width, top, height } = element.getBoundingClientRect()
      return element.contains(document.elementFromPoint(left + width / 2, top + height / 2))
    })).toBe(true)

    await listbox.getByRole('option', { name: 'Heading 2', exact: true }).click()
    await expect(listbox).toBeHidden()
    await expect(meeting).toBeVisible()
    await expect(description.getByRole('heading', { level: 2, name: headingText, exact: true })).toBeVisible()

    await blockType.click()
    await expect(listbox).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(listbox).toBeHidden()
    await expect(meeting).toBeVisible()
    const discard = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })
    await expect(discard).toBeHidden()

    await page.keyboard.press('Escape')
    await discard.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(discard).toBeHidden()
    await expect(meeting).toBeHidden()
    await expect(page.locator('body')).toHaveCSS('pointer-events', 'auto')

    await schedule.click()
    await expect(meeting).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(meeting).toBeHidden()
  } finally {
    await deleteEntityIfExists(request, token, '/api/customers/people', personId)
  }
})
