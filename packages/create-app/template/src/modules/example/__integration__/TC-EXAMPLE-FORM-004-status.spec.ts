import { expect } from '@playwright/test'
import { captureShowcase, field, saveShowcase, test } from './todoShowcaseFixtures'

export const integrationMeta = { dependsOnModules: ['example'] }

test('TC-EXAMPLE-FORM-004 replaces status and persists its required leaf', async ({ page, showcaseTodo }) => {
  await showcaseTodo.open()
  const completion = field(page, 'is_done').getByRole('checkbox', { name: 'Completed' })
  await expect(completion).toBeVisible()
  await expect(completion).not.toBeChecked()
  await completion.scrollIntoViewIfNeeded()
  await captureShowcase(page, 'c4-status')
  await completion.check()
  expect((await saveShowcase(page)).status()).toBe(200)
  expect(await showcaseTodo.read()).toMatchObject({ title: showcaseTodo.title, is_done: true })
})
