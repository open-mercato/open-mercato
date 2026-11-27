import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { captureShowcase } from './todoShowcaseFixtures'

export const integrationMeta = { dependsOnModules: ['form_policy_fixture'] }

test('TC-EXAMPLE-FORM-003 blocks an uncovered required leaf in the disposable fixture', async ({ page, request }) => {
  test.skip(process.env.OM_TEST_CRUD_FORM_POLICY_FIXTURES !== '1', 'Uses the isolated section policy fixture scaffold')
  const token = await getAuthToken(request, 'admin')
  const entityId = 'form_policy_fixture:record'
  const region = `fixture-${randomUUID()}`
  const endpoint = '/api/entities/records'
  const created = await apiRequest(request, 'POST', endpoint, { token, data: { entityId, values: { region } } })
  expect(created.status()).toBe(200)
  const id = (await created.json() as { item: { recordId: string } }).item.recordId
  try {
    await login(page, 'admin')
    const resolver = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/extensions/crud-form-sections/resolve' && response.request().method() === 'POST')
    const prefill = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === endpoint && url.searchParams.get('id') === id && response.request().method() === 'GET'
    })
    let writes = 0
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/api/form-policy-fixture/records/section-policy' && req.method() !== 'GET') writes++
    })
    await page.goto(`/backend/form-policy-fixture/c3?fixtureRecordId=${encodeURIComponent(id)}`)
    expect((await prefill).status()).toBe(200)
    const failed = await resolver
    expect(failed.status()).toBe(200)
    expect(await failed.json()).toEqual({ state: 'failed', code: 'crud_form_section_policy_invalid' })
    await expect(page.getByText('Unable to load data. Please try again.', { exact: true })).toBeVisible()
    await expect(page.locator('form button[type="submit"], form button[data-action="delete"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /save|delete/i })).toHaveCount(0)
    expect(writes).toBe(0)
    const query = new URLSearchParams({ entityId, id, pageSize: '1' })
    const read = await apiRequest(request, 'GET', `${endpoint}?${query}`, { token })
    expect(read.status()).toBe(200)
    expect((await read.json()).items).toEqual([expect.objectContaining({ id, region })])
    await captureShowcase(page, 'c3-blocked-form')
  } finally {
    const query = new URLSearchParams({ entityId, recordId: id })
    await apiRequest(request, 'DELETE', `${endpoint}?${query}`, { token })
  }
})
