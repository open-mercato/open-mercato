import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createFormFixture,
  forkDraftFixture,
  uniqueFormKey,
} from '@open-mercato/core/helpers/integration/formsFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

type StudioFixture = {
  token: string
  versionPath: string
}

type VersionDetail = {
  updatedAt: string
  schema: {
    properties: Record<string, { type: string; 'x-om-visibility-if'?: unknown }>
  }
}

let ownedFormId: string | null = null

async function withStudioFixture(
  page: Page,
  request: APIRequestContext,
  run: (fixture: StudioFixture) => Promise<void>,
): Promise<void> {
  const token = await getAuthToken(request, 'admin')
  const form = await createFormFixture(request, token, {
    key: uniqueFormKey('qa_visibility_8564'),
    name: 'QA 8564 visibility roundtrips',
  })
  ownedFormId = form.id
  const formId = form.id
  const versionId = await forkDraftFixture(request, token, formId)
  const fields = [
    { key: 'text_source', type: 'string', fieldType: 'text', label: 'Text source' },
    { key: 'boolean_source', type: 'boolean', fieldType: 'boolean', label: 'Boolean source' },
    { key: 'number_source', type: 'number', fieldType: 'number', label: 'Number source' },
    { key: 'integer_source', type: 'integer', fieldType: 'integer', label: 'Integer source' },
    { key: 'fruit_source', type: 'array', fieldType: 'select_many', label: 'Fruit source' },
    { key: 'details', type: 'string', fieldType: 'text', label: 'Conditional details' },
  ]
  const properties: Record<string, unknown> = Object.fromEntries(fields.map((field) => [
    field.key,
    {
      type: field.type,
      'x-om-type': field.fieldType,
      'x-om-label': { en: field.label },
      'x-om-visible-to': ['admin', 'participant'],
      'x-om-editable-by': ['admin', 'participant'],
      ...(field.fieldType === 'select_many' ? {
        items: { type: 'string' },
        'x-om-options': [
          { value: 'apple', label: { en: 'Apple' } },
          { value: 'pear', label: { en: 'Pear' } },
        ],
      } : {}),
    },
  ]))
  const versionPath = `/api/forms/${formId}/versions/${versionId}`
  const initialResponse = await apiRequest(request, 'GET', versionPath, { token })
  expect(initialResponse.status()).toBe(200)
  const initial = await readJsonSafe<VersionDetail>(initialResponse)
  expect(typeof initial?.updatedAt).toBe('string')
  const updateResponse = await apiRequest(request, 'PATCH', versionPath, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: initial!.updatedAt },
    data: {
      schema: {
        type: 'object',
        'x-om-roles': ['admin', 'participant'],
        'x-om-default-actor-role': 'admin',
        'x-om-sections': [{
          key: 'visibility',
          title: { en: 'Visibility roundtrips' },
          fieldKeys: fields.map((field) => field.key),
        }],
        properties,
      },
      roles: ['admin', 'participant'],
    },
  })
  expect(updateResponse.status(), await updateResponse.text()).toBe(200)

  await login(page, 'admin')
  await page.goto(`/backend/forms/${formId}`, { waitUntil: 'domcontentloaded' })
  await openDetailsLogic(page)
  await run({ token, versionPath })
}

async function cleanupOwnedForm(request: APIRequestContext, testInfo: TestInfo): Promise<void> {
  const formId = ownedFormId
  ownedFormId = null
  if (!formId) return
  const token = await getAuthToken(request, 'admin')
  const currentResponse = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token })
  expect(currentResponse.status()).toBe(200)
  const current = await readJsonSafe<{ updatedAt: string }>(currentResponse)
  expect(typeof current?.updatedAt).toBe('string')
  const response = await apiRequest(request, 'DELETE', `/api/forms/${formId}`, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: current!.updatedAt },
  })
  expect(response.status(), 'the owned form and its draft are cleaned up').toBe(200)
  const archivedResponse = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token })
  expect(archivedResponse.status()).toBe(200)
  const archived = await readJsonSafe<{ status: string }>(archivedResponse)
  expect(archived?.status).toBe('archived')
  await testInfo.attach('owned-fixture-cleanup', {
    body: JSON.stringify({ formId, deleteStatus: response.status(), archived: true }),
    contentType: 'application/json',
  })
}

async function openDetailsLogic(page: Page): Promise<void> {
  await page.locator('[data-testid="backend-chrome-ready"][data-ready="true"]').waitFor({ state: 'attached' })
  await page.locator('[data-field-key="details"]').getByRole('button', { name: /^Conditional details/ }).click()
  const logicTab = page.getByRole('tab', { name: 'Logic', exact: true })
  await logicTab.click()
  await expect(logicTab).toHaveAttribute('aria-selected', 'true')
}

async function chooseSource(page: Page, source: string): Promise<void> {
  await page.getByTestId('condition-row').getByRole('combobox').nth(0).click()
  await page.getByRole('option', { name: new RegExp(`^${source} —`) }).click()
}

async function chooseOperator(page: Page, operator: string): Promise<void> {
  await page.getByTestId('condition-row').getByRole('combobox').nth(1).click()
  await page.getByRole('option', { name: operator, exact: true }).click()
}

async function assertControls(page: Page, source: string, operator: string, value: string | null): Promise<void> {
  const row = page.getByTestId('condition-row')
  await expect(row).toHaveCount(1)
  await expect(row.getByRole('combobox').nth(0)).toContainText(`${source} —`)
  await expect(row.getByRole('combobox').nth(1)).toHaveText(operator)
  if (value === null) {
    await expect(row.getByRole('textbox')).toHaveCount(0)
  } else {
    await expect(row.getByRole('textbox')).toHaveValue(value)
  }
}

async function saveAndReload(
  page: Page,
  request: APIRequestContext,
  fixture: StudioFixture,
  predicate: Record<string, unknown>,
): Promise<void> {
  await expect.poll(async () => {
    const response = await apiRequest(request, 'GET', fixture.versionPath, { token: fixture.token })
    expect(response.status()).toBe(200)
    const version = await readJsonSafe<VersionDetail>(response)
    return version?.schema.properties.details['x-om-visibility-if']
  }, { message: 'Studio autosave persists the exact predicate and operand types' }).toEqual(predicate)
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await openDetailsLogic(page)
}

test.describe('TC-FORM-8564: visibility rule browser roundtrips', () => {
  test.describe.configure({ timeout: 60_000 })

  test.afterEach(async ({ request }, testInfo) => {
    await cleanupOwnedForm(request, testInfo)
  })

  test('resets incompatible comparisons when switching text to boolean and back', async ({ page, request }) => {
    await withStudioFixture(page, request, async (fixture) => {
      await expect(page.getByText('Always shown (no rules).', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Add rule', exact: true }).click()
      await page.getByTestId('condition-row').getByRole('textbox').fill('old comparison')
      await assertControls(page, 'Text source', 'equals', 'old comparison')
      await saveAndReload(page, request, fixture, { '==': [{ var: 'text_source' }, 'old comparison'] })
      await assertControls(page, 'Text source', 'equals', 'old comparison')

      await chooseSource(page, 'Boolean source')
      await assertControls(page, 'Boolean source', 'is true', null)
      await saveAndReload(page, request, fixture, { '==': [{ var: 'boolean_source' }, true] })
      await assertControls(page, 'Boolean source', 'is true', null)

      await chooseSource(page, 'Text source')
      await assertControls(page, 'Text source', 'equals', '')
      await saveAndReload(page, request, fixture, { '==': [{ var: 'text_source' }, ''] })
      await assertControls(page, 'Text source', 'equals', '')
    })
  })

  test('preserves the numeric operator and value when switching number to integer', async ({ page, request }) => {
    await withStudioFixture(page, request, async (fixture) => {
      await page.getByRole('button', { name: 'Add rule', exact: true }).click()
      await chooseSource(page, 'Number source')
      await chooseOperator(page, 'is at least')
      await page.getByTestId('condition-row').getByRole('textbox').fill('18')
      await saveAndReload(page, request, fixture, { '>=': [{ var: 'number_source' }, 18] })
      await assertControls(page, 'Number source', 'is at least', '18')

      await chooseSource(page, 'Integer source')
      await assertControls(page, 'Integer source', 'is at least', '18')
      await saveAndReload(page, request, fixture, { '>=': [{ var: 'integer_source' }, 18] })
      await assertControls(page, 'Integer source', 'is at least', '18')
      const response = await apiRequest(request, 'GET', fixture.versionPath, { token: fixture.token })
      expect(response.status()).toBe(200)
      const version = await readJsonSafe<VersionDetail>(response)
      expect(version?.schema.properties.number_source.type).toBe('number')
      expect(version?.schema.properties.integer_source.type).toBe('integer')
    })
  })

  test('creates and edits contains rules and evaluates matching, nonmatching and deselected Preview answers', async ({ page, request }, testInfo) => {
    await withStudioFixture(page, request, async (fixture) => {
      await page.getByRole('button', { name: 'Add rule', exact: true }).click()
      await chooseSource(page, 'Fruit source')
      await assertControls(page, 'Fruit source', 'contains', '')
      await page.getByTestId('condition-row').getByRole('textbox').fill('apple')
      await saveAndReload(page, request, fixture, { in: ['apple', { var: 'fruit_source' }] })
      await assertControls(page, 'Fruit source', 'contains', 'apple')

      await page.getByTestId('condition-row').getByRole('textbox').fill('pear')
      await saveAndReload(page, request, fixture, { in: ['pear', { var: 'fruit_source' }] })
      await assertControls(page, 'Fruit source', 'contains', 'pear')
      await page.getByRole('tab', { name: 'Preview', exact: true }).click()

      const apple = page.getByRole('checkbox', { name: 'Apple', exact: true })
      const pear = page.getByRole('checkbox', { name: 'Pear', exact: true })
      const details = page.getByRole('textbox', { name: 'Conditional details', exact: true })
      await expect(apple).toBeVisible()
      await expect(apple).not.toBeChecked()
      await expect(pear).not.toBeChecked()
      await expect(details, 'unanswered contains is hidden in a rendered Preview').toHaveCount(0)

      await apple.check()
      await expect(apple).toBeChecked()
      await expect(details, 'Apple does not match the saved Pear condition').toHaveCount(0)

      await pear.check()
      await expect(pear).toBeChecked()
      await expect(details, 'Pear matches the edited saved condition').toBeVisible()
      await page.screenshot({ path: testInfo.outputPath('preview-matching-pear.png'), fullPage: true })

      await pear.uncheck()
      await expect(pear).not.toBeChecked()
      await expect(apple).toBeChecked()
      await expect(details, 'removing Pear hides the field while Apple remains selected').toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath('preview-deselected-pear.png'), fullPage: true })
    })
  })
})
