import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createOrganizationInDb, deleteOrganizationInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['customers', 'translations'] }

const entityType = 'customers:customer_dictionary_entry'
const filterLabels = {
  pl: { source: 'Źródło', addCondition: 'Dodaj warunek', search: 'Wyszukaj pole…', value: 'Wybierz wartość' },
  en: { source: 'Source', addCondition: 'Add condition', search: 'Search field…', value: 'Select value' },
}

test.describe('TC-CRM-6197: Customer dictionary translation browser flow', () => {
  let token: string
  let tenantId: string | null
  let organizationId: string | null
  let scope: { token: string; headers: Record<string, string> }
  let entryId: string | null
  let personIds: string[]
  let value: string
  let baseLabel: string
  let polishLabel: string
  let personName: string
  let otherPersonName: string

  test.beforeEach(async ({ request }) => {
    tenantId = null
    organizationId = null
    entryId = null
    personIds = []
    const unique = randomUUID()
    value = `qa_source_${unique}`
    baseLabel = `QA source ${unique}`
    polishLabel = `Własne źródło ${unique} — długi opis źródła klienta `.padEnd(147, 'ą')
    personName = `QA ${unique} translated source`
    otherPersonName = `QA ${unique} other source`
    token = await getAuthToken(request, 'superadmin')
    const tenant = await apiRequest(request, 'POST', '/api/directory/tenants', {
      token, data: { name: `Dictionary browser ${unique}` },
    })
    tenantId = expectId((await readJsonSafe<{ id: string }>(tenant))?.id, 'Tenant fixture must have an id')
    expect(tenant.ok()).toBeTruthy()
    organizationId = await createOrganizationInDb({ name: `Dictionary browser ${unique}`, tenantId })
    scope = {
      token,
      headers: { Cookie: `om_selected_tenant=${tenantId}; om_selected_org=${organizationId}` },
    }
    const configured = await apiRequest(request, 'PUT', '/api/translations/locales', {
      ...scope, data: { locales: ['en', 'pl'] },
    })
    expect(configured.ok()).toBeTruthy()

    const created = await apiRequest(request, 'POST', '/api/customers/dictionaries/sources', {
      ...scope, data: { value, label: baseLabel },
    })
    entryId = expectId((await readJsonSafe<{ id: string }>(created))?.id, 'Source fixture must have an id')
    expect(created.ok()).toBeTruthy()
    for (const [displayName, source] of [[personName, value], [otherPersonName, undefined]]) {
      const person = await apiRequest(request, 'POST', '/api/customers/people', {
        ...scope, data: { firstName: 'QA', lastName: displayName, displayName, source },
      })
      personIds.push(expectId((await readJsonSafe<{ id: string }>(person))?.id, 'Person fixture must have an id'))
      expect(person.ok()).toBeTruthy()
    }
    const warm = await apiRequest(request, 'GET', '/api/customers/dictionaries/sources?locale=pl', scope)
    expect(warm.ok()).toBeTruthy()
  })

  test.afterEach(async ({ request }) => {
    const cleanup: Array<Promise<Awaited<ReturnType<typeof apiRequest>>>> = []
    if (organizationId) {
      if (entryId) {
        cleanup.push(apiRequest(request, 'DELETE', `/api/translations/${encodeURIComponent(entityType)}/${entryId}`, scope))
        cleanup.push(apiRequest(request, 'DELETE', `/api/customers/dictionaries/sources/${entryId}`, scope))
      }
      for (const personId of personIds) {
        cleanup.push(apiRequest(request, 'DELETE', `/api/customers/people?id=${personId}`, scope))
      }
    }
    try {
      for (const result of await Promise.allSettled(cleanup)) {
        expect(result.status, 'Every fixture cleanup request must complete').toBe('fulfilled')
        if (result.status === 'fulfilled') {
          expect(result.value.ok() || result.value.status() === 404, `Cleanup ${result.value.url()}`).toBeTruthy()
        }
      }
    } finally {
      try {
        await deleteOrganizationInDb(organizationId)
      } finally {
        if (tenantId) {
          const deleted = await apiRequest(request, 'DELETE', `/api/directory/tenants?id=${tenantId}`, { token })
          expect(deleted.ok()).toBeTruthy()
        }
      }
    }
  })

  test('saves a Polish label through TranslationManager and uses localized Source filters at 390px', async ({ page, context, baseURL }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await login(page, 'superadmin')
    expect(baseURL).toBeTruthy()
    await context.addCookies([
      { name: 'locale', value: 'en', url: baseURL! },
      { name: 'om_selected_tenant', value: tenantId!, url: baseURL! },
      { name: 'om_selected_org', value: organizationId!, url: baseURL! },
    ])
    await page.goto('/backend/config/translations')
    await expect(page.getByRole('heading', { name: 'Translations', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save translations', exact: true })).toBeDisabled()
    await page.getByPlaceholder('Select an entity', { exact: true }).fill(entityType)
    await page.getByRole('option', { name: new RegExp(entityType) }).click()
    await page.getByPlaceholder('Search records...', { exact: true }).fill(baseLabel)
    await page.getByRole('option', { name: baseLabel, exact: true }).click()

    const translationRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Label', exact: true }) })
    await expect(translationRow.getByRole('cell', { name: baseLabel, exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'PL', exact: true }).click()
    const translationInput = translationRow.getByPlaceholder(baseLabel, { exact: true })
    const table = page.getByRole('table').filter({ has: translationRow })
    const scroll = await table.evaluate((element) => {
      const viewport = element.parentElement!
      viewport.scrollLeft = viewport.scrollWidth
      return { width: viewport.clientWidth, contentWidth: viewport.scrollWidth, left: viewport.scrollLeft }
    })
    expect(scroll.contentWidth).toBeGreaterThan(scroll.width)
    expect(scroll.left).toBeGreaterThan(0)
    await translationInput.fill(polishLabel)
    await expect(translationInput).toHaveValue(polishLabel)
    await expect(translationInput).toBeInViewport({ ratio: 1 })
    const savedResponse = page.waitForResponse((response) => response.request().method() === 'PUT'
      && decodeURIComponent(new URL(response.url()).pathname) === `/api/translations/${entityType}/${entryId}`)
    const saveButton = page.getByRole('button', { name: 'Save translations', exact: true })
    await saveButton.scrollIntoViewIfNeeded()
    await expect(saveButton).toBeInViewport({ ratio: 1 })
    await saveButton.click()
    const saved = await savedResponse
    expect(saved.ok()).toBeTruthy()
    expect(await saved.json()).toMatchObject({ entityId: entryId, translations: { pl: { label: polishLabel } } })
    await expect(page.getByText('Translations saved', { exact: true })).toBeVisible()
    await testInfo.attach('manager-polish-label-390px', { body: await page.screenshot(), contentType: 'image/png' })

    for (const locale of ['pl', 'en'] as const) {
      const labels = filterLabels[locale]
      const expectedLabel = locale === 'pl' ? polishLabel : baseLabel
      const unexpectedLabel = locale === 'pl' ? baseLabel : polishLabel
      await context.addCookies([{ name: 'locale', value: locale, url: baseURL! }])
      await page.goto(`/backend/customers/people?search=${encodeURIComponent(`QA ${value.slice('qa_source_'.length)}`)}`)
      await expect(page.getByRole('row').filter({ hasText: personName })).toBeVisible()
      await expect(page.getByRole('row').filter({ hasText: otherPersonName })).toBeVisible()
      await page.getByTestId('advanced-filter-trigger').click()
      await page.getByTestId('advanced-filter-panel').getByRole('button', { name: labels.addCondition, exact: true }).click()
      await page.getByRole('textbox', { name: labels.search, exact: true }).fill(labels.source)
      await page.getByRole('option', { name: labels.source, exact: true }).click()
      await page.getByRole('combobox', { name: labels.value, exact: true }).click()
      const sourceOption = page.getByRole('option', { name: expectedLabel, exact: true })
      await expect(sourceOption).toBeVisible()
      await expect(page.getByRole('option', { name: unexpectedLabel, exact: true })).toHaveCount(0)
      await testInfo.attach(`source-filter-${locale}-390px`, { body: await page.screenshot(), contentType: 'image/png' })
      const filteredResponse = page.waitForResponse((response) => response.request().method() === 'GET'
        && new URL(response.url()).pathname === '/api/customers/people' && response.url().includes(value))
      await sourceOption.click()
      const filtered = await filteredResponse
      expect(filtered.ok()).toBeTruthy()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('advanced-filter-panel')).toBeHidden()
      await expect(page.getByRole('row').filter({ hasText: personName })).toBeVisible()
      await expect(page.getByRole('row').filter({ hasText: otherPersonName })).toHaveCount(0)
      await expect(page.getByTestId('active-filter-chip')).toContainText(labels.source)
    }
  })
})
