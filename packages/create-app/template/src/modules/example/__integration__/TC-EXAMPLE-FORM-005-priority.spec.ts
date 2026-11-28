import { expect } from '@playwright/test'
import { getCustomFieldValue } from '@open-mercato/core/helpers/integration/crudFormPersistence'
import { captureShowcase, field, saveShowcase, test } from './todoShowcaseFixtures'

export const integrationMeta = { dependsOnModules: ['example'] }

test('TC-EXAMPLE-FORM-005 preserves removed notes and applies the new priority rule', async ({ page, showcaseTodo }) => {
  await showcaseTodo.open()
  await expect(field(page, 'notes')).toHaveCount(0)
  const priority = field(page, 'cf_priority').getByRole('textbox', { name: 'Priority level' })
  await expect(priority).toBeVisible()
  await priority.fill('5')
  const original = await showcaseTodo.read()
  const refused = await saveShowcase(page)
  expect(refused.status()).toBe(422)
  expect(await refused.json()).toMatchObject({
    details: { fieldErrors: { 'customFields.priority': 'example.todoShowcase.errors.priority' } },
  })
  await expect(field(page, 'cf_priority').getByText('This priority level is unavailable in the selected organization.')).toBeVisible()
  await field(page, 'cf_priority').scrollIntoViewIfNeeded()
  await captureShowcase(page, 'c5-priority')
  expect(await showcaseTodo.read()).toMatchObject({ notes: showcaseTodo.notes, updatedAt: original.updatedAt })

  await priority.fill('4')
  expect((await saveShowcase(page)).status()).toBe(200)
  const saved = await showcaseTodo.read()
  expect(saved.notes).toBe(showcaseTodo.notes)
  expect(Number(getCustomFieldValue(saved, 'priority'))).toBe(4)
})
