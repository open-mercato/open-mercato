import { expect } from '@playwright/test'
import { captureShowcase, field, saveShowcase, test } from './todoShowcaseFixtures'

export const integrationMeta = { dependsOnModules: ['example'] }

test('TC-EXAMPLE-FORM-008 warns about a failed observer and keeps the committed Todo', async ({ page, showcaseTodo }) => {
  await showcaseTodo.open()
  await field(page, 'observerNote').getByRole('textbox').fill('unavailable')
  await field(page, 'is_done').getByRole('checkbox').check()
  const saved = await saveShowcase(page)
  expect(saved.status()).toBe(200)
  expect(await saved.json()).toMatchObject({
    ok: true, extensionWarnings: [{ sinkId: expect.any(String), code: 'extension_sink_failed' }],
  })
  await expect(page.getByText('Changes were saved. The after-save observer did not complete.')).toBeVisible()
  expect(await showcaseTodo.read()).toMatchObject({ title: showcaseTodo.title, is_done: true })
  await expect(field(page, 'is_done').getByRole('checkbox')).toBeChecked()
  await captureShowcase(page, 'c8-observer-warning')
})
