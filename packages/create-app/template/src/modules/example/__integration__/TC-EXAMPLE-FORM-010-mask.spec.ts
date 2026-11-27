import { expect } from '@playwright/test'
import { getCustomFieldValue } from '@open-mercato/core/helpers/integration/crudFormPersistence'
import { captureShowcase, field, readReadyShowcasePolicy, saveShowcase, test } from './todoShowcaseFixtures'

export const integrationMeta = { dependsOnModules: ['example', 'form_policy_fixture'] }

test('TC-EXAMPLE-FORM-010 masks only the observer in the disposable app configuration', async ({ page, showcaseTodo }) => {
  test.skip(process.env.OM_TEST_CRUD_FORM_POLICY_FIXTURES !== '1', 'Uses the isolated section policy fixture scaffold')
  const policy = await readReadyShowcasePolicy(page, showcaseTodo.open)
  expect(policy.acceptedContributionIds).not.toContain('example.todo-extensions.showcase.update.observer')
  expect(policy.acceptedContributionIds).toContain('example.todo-extensions.showcase.update.season')
  await expect(field(page, 'observerNote')).toHaveCount(0)
  const season = field(page, 'cf_season').getByRole('combobox')
  await season.click()
  await page.getByRole('option', { name: 'Autumn' }).click()
  expect((await saveShowcase(page)).status()).toBe(200)
  await expect(season).toHaveText('Autumn')
  expect(getCustomFieldValue(await showcaseTodo.read(), 'season')).toBe('autumn')
  await season.scrollIntoViewIfNeeded()
  await captureShowcase(page, 'c10-scoped-mask')
})
