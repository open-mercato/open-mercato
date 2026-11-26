import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createCustomEntity,
  deleteCustomEntityIfExists,
  listFieldDefinitions,
  saveFieldDefinitions,
  uniqueEntityId,
  type FieldDefinitionInput,
} from './helpers/entitiesApi'

export const integrationMeta = { dependsOnModules: ['entities'] }

const RULE_MESSAGE = 'QA 9367 rule message'
const STEP_TIMEOUT = 10_000

type StoredDefinition = {
  key: string
  configJson?: { validation?: Array<{ rule: string; param?: unknown }> }
}

function ruleParamInput(page: Page): Locator {
  return page
    .locator('div.grid')
    .filter({ has: page.locator(`input[value="${RULE_MESSAGE}"]`) })
    .last()
    .locator('input')
    .first()
}

async function storedParam(request: APIRequestContext, token: string, entityId: string, key: string): Promise<unknown> {
  const response = await listFieldDefinitions(request, token, entityId)
  const body = (await response.json()) as { items?: StoredDefinition[] }
  return body.items?.find((definition) => definition.key === key)?.configJson?.validation?.[0]?.param
}

async function openEditorWithField(
  page: Page,
  request: APIRequestContext,
  token: string,
  baseURL: string | undefined,
  entityId: string,
  definition: FieldDefinitionInput,
): Promise<Locator> {
  expect((await createCustomEntity(request, token, { entityId, label: 'QA rule param numbers' })).status()).toBe(200)
  expect((await saveFieldDefinitions(request, token, entityId, [definition])).status()).toBe(200)

  await login(page, 'admin')
  expect(baseURL).toBeTruthy()
  await page.context().addCookies([{ name: 'locale', value: 'en', url: baseURL! }])
  await page.goto(`/backend/entities/user/${encodeURIComponent(entityId)}`)
  return ruleParamInput(page)
}

async function saveDefinitions(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  await expect(page.getByText('Definitions saved').first()).toBeVisible({ timeout: 30_000 })
}

async function cleanup(request: APIRequestContext, token: string, entityId: string, key: string): Promise<void> {
  await apiRequest(request, 'DELETE', '/api/entities/definitions', { token, data: { entityId, key } }).catch(() => undefined)
  await deleteCustomEntityIfExists(request, token, entityId)
}

test.describe('TC-ENTITIES-9367: the field editor stores numeric rule parameters as numbers', () => {
  test.describe.configure({ timeout: 90_000 })

  test('an eq parameter edited on an integer field is saved as a number', async ({ page, request, baseURL }) => {
    const token = await getAuthToken(request, 'admin')
    const entityId = uniqueEntityId('rule_param_eq')
    try {
      const param = await openEditorWithField(page, request, token, baseURL, entityId, {
        key: 'score',
        kind: 'integer',
        configJson: { label: 'Score', validation: [{ rule: 'eq', param: '7', message: RULE_MESSAGE }] },
      })
      await expect(param).toHaveValue('7', { timeout: 60_000 })
      await param.fill('5')
      await expect(param).toHaveValue('5', { timeout: STEP_TIMEOUT })
      await param.blur()

      await saveDefinitions(page)

      await expect
        .poll(() => storedParam(request, token, entityId, 'score'), { timeout: STEP_TIMEOUT })
        .toBe(5)
    } finally {
      await cleanup(request, token, entityId, 'score')
    }
  })

  test('a negative decimal can be typed into a comparison rule and is saved as a number', async ({ page, request, baseURL }) => {
    const token = await getAuthToken(request, 'admin')
    const entityId = uniqueEntityId('rule_param_gte')
    try {
      const param = await openEditorWithField(page, request, token, baseURL, entityId, {
        key: 'ratio',
        kind: 'float',
        configJson: { label: 'Ratio', validation: [{ rule: 'gte', param: 7, message: RULE_MESSAGE }] },
      })
      await expect(param).toHaveValue('7', { timeout: 60_000 })
      await param.fill('')
      await param.pressSequentially('-2.5')
      await expect(param).toHaveValue('-2.5', { timeout: STEP_TIMEOUT })
      await param.blur()

      await saveDefinitions(page)

      await expect
        .poll(() => storedParam(request, token, entityId, 'ratio'), { timeout: STEP_TIMEOUT })
        .toBe(-2.5)
    } finally {
      await cleanup(request, token, entityId, 'ratio')
    }
  })
})
