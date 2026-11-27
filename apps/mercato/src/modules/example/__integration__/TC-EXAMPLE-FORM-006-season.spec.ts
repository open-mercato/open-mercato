import { expect } from '@playwright/test'
import { getCustomFieldValue } from '@open-mercato/core/helpers/integration/crudFormPersistence'
import { captureShowcase, field, saveShowcase, test } from './todoShowcaseFixtures'

export const integrationMeta = { dependsOnModules: ['example'] }

test('TC-EXAMPLE-FORM-006 saves and reloads the scoped custom field', async ({ page, showcaseTodo }) => {
  await showcaseTodo.open()
  const season = field(page, 'cf_season').getByRole('combobox', { name: 'Season' })
  await season.click()
  await page.getByRole('option', { name: 'Autumn' }).click()
  expect((await saveShowcase(page)).status()).toBe(200)
  expect(getCustomFieldValue(await showcaseTodo.read(), 'season')).toBe('autumn')

  await page.reload({ waitUntil: 'commit' })
  await expect(season).toHaveText('Autumn')
  await expect(field(page, 'cf_season')).toHaveCount(1)
  await season.scrollIntoViewIfNeeded()
  await captureShowcase(page, 'c6-season')

  await season.click()
  await page.getByRole('option', { name: '— Clear —' }).click()
  expect((await saveShowcase(page)).status()).toBe(200)
  expect(getCustomFieldValue(await showcaseTodo.read(), 'season') ?? null).toBeNull()
  await expect(season).toHaveText('—')
})
