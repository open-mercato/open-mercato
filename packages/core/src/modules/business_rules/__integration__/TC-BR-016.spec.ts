import { expect, test, type Browser, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  deleteRoleIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteBusinessRuleIfExists } from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import {
  buildBusinessRulePayload,
  cleanupBusinessRulesUser,
  createBusinessRulesUser,
} from './helpers/businessRulesApi'

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const API_KEYS_PATH = '/api/api_keys/keys'
const RULES_PATH = '/api/business_rules/rules'
const PROFILE_FEATURE = 'customers.people.view'
const CONFIGURATOR_FEATURES = [
  'business_rules.view',
  'business_rules.manage',
  'api_keys.view',
  'api_keys.create',
]
const GRANT_REFUSAL = 'roles you cannot grant'

type SessionUser = { token: string; roleId: string; userId: string }

async function openSession(browser: Browser, user: SessionUser): Promise<Page> {
  const scope = getTokenContext(user.token)
  const context = await browser.newContext({ baseURL: BASE_URL })
  await context.addCookies([
    { name: 'auth_token', value: user.token, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_tenant', value: scope.tenantId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_selected_org', value: scope.organizationId, url: BASE_URL, sameSite: 'Lax' },
    { name: 'om_demo_notice_ack', value: 'ack', url: BASE_URL },
    { name: 'om_cookie_notice_ack', value: 'ack', url: BASE_URL },
    { name: 'om_feedback_suppress', value: '1', url: BASE_URL },
  ])
  return context.newPage()
}

async function readApiKeyPickerOptions(page: Page): Promise<string[]> {
  await page.goto('/backend/rules/create', { waitUntil: 'domcontentloaded' })
  const actionTypePicker = page.getByRole('combobox').filter({ hasText: 'Select action type...' }).first()
  await expect(async () => {
    if (!(await actionTypePicker.isVisible())) {
      await page.getByRole('button', { name: 'Add Action' }).first().click()
    }
    await expect(actionTypePicker).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  await actionTypePicker.click()
  await page.getByRole('option', { name: 'Call OpenMercato', exact: true }).click()
  const apiKeyPicker = page.getByRole('combobox').filter({ hasText: 'Select API key' }).first()
  await expect(apiKeyPicker).toBeEnabled()
  await apiKeyPicker.click()
  const options = page.getByRole('option')
  await expect(options.first()).toBeVisible()
  const labels = await options.allTextContents()
  await page.keyboard.press('Escape')
  return labels
}

async function readRuleEnabled(request: Parameters<typeof apiRequest>[0], token: string, ruleId: string): Promise<boolean | undefined> {
  const response = await apiRequest(request, 'GET', `${RULES_PATH}/${encodeURIComponent(ruleId)}`, { token })
  expect(response.status(), 'read rule detail').toBe(200)
  return (await readJsonSafe<{ enabled?: boolean }>(response))?.enabled
}

test.describe('TC-BR-016: CALL_OPEN_MERCATO rule editor enforces the API key grant ceiling in the browser', () => {
  test('picker, edit form and list toggle follow what the signed-in author can grant', async ({ browser, request }) => {
    test.setTimeout(180_000)
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId, tenantId } = getTokenContext(adminToken)
    expect(organizationId, 'admin token should carry an organization').toBeTruthy()
    const stamp = Date.now()
    const ruleKey = `TC_BR_016_${stamp}`
    const ruleName = `QA TC-BR-016 people lookup ${stamp}`
    const peopleKeyName = `QA TC-BR-016 people profile ${stamp}`
    const harmlessKeyName = `QA TC-BR-016 rules viewer profile ${stamp}`

    const roleIds: string[] = []
    const apiKeyIds: string[] = []
    const pages: Page[] = []
    let ruleId: string | null = null
    let restricted: SessionUser | null = null
    let grantor: SessionUser | null = null

    const createProfile = async (name: string, feature: string): Promise<string> => {
      const roleId = await createRoleFixture(request, adminToken, { name: `${name} role`, tenantId: tenantId || undefined })
      roleIds.push(roleId)
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: [feature],
        organizations: organizationId ? [organizationId] : null,
      })
      const response = await apiRequest(request, 'POST', API_KEYS_PATH, {
        token: adminToken,
        data: { name, roles: [roleId], organizationId },
      })
      expect(response.status(), `create api key profile ${name}`).toBe(201)
      const apiKeyId = expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'api key id')
      apiKeyIds.push(apiKeyId)
      return apiKeyId
    }

    try {
      const peopleKeyId = await createProfile(peopleKeyName, PROFILE_FEATURE)
      await createProfile(harmlessKeyName, 'business_rules.view')

      restricted = await createBusinessRulesUser(request, adminToken, {
        email: `qa-tc-br-016-restricted-${stamp}@example.com`,
        organizationId: organizationId as string,
        features: CONFIGURATOR_FEATURES,
        roleName: `QA TC-BR-016 restricted ${stamp}`,
      })
      grantor = await createBusinessRulesUser(request, adminToken, {
        email: `qa-tc-br-016-grantor-${stamp}@example.com`,
        organizationId: organizationId as string,
        features: [...CONFIGURATOR_FEATURES, PROFILE_FEATURE],
        roleName: `QA TC-BR-016 grantor ${stamp}`,
      })

      const createResponse = await apiRequest(request, 'POST', RULES_PATH, {
        token: grantor.token,
        data: buildBusinessRulePayload(stamp, {
          ruleId: ruleKey,
          ruleName,
          ruleType: 'ACTION',
          entityType: `QaCallOpenMercatoUi${stamp}`,
          conditionExpression: { operator: 'AND', rules: [{ field: 'status', operator: '=', value: 'ACTIVE' }] },
          successActions: [{
            type: 'CALL_OPEN_MERCATO',
            config: { endpoint: '/api/customers/people', method: 'GET', apiKeyId: peopleKeyId },
          }],
        }),
      })
      expect(createResponse.status(), 'grantor saves the rule').toBe(201)
      ruleId = expectId((await readJsonSafe<{ id?: string }>(createResponse))?.id, 'rule id')

      const restrictedPage = await openSession(browser, restricted)
      const grantorPage = await openSession(browser, grantor)
      pages.push(restrictedPage, grantorPage)

      const restrictedOptions = await readApiKeyPickerOptions(restrictedPage)
      expect(restrictedOptions.some((label) => label.includes(harmlessKeyName)), 'restricted author sees the grantable profile').toBe(true)
      expect(restrictedOptions.some((label) => label.includes(peopleKeyName)), 'restricted author must not see the people profile').toBe(false)

      const grantorOptions = await readApiKeyPickerOptions(grantorPage)
      expect(grantorOptions.some((label) => label.includes(harmlessKeyName))).toBe(true)
      expect(grantorOptions.some((label) => label.includes(peopleKeyName)), 'grantor sees the people profile').toBe(true)

      await restrictedPage.goto(`/backend/rules/${ruleId}`, { waitUntil: 'domcontentloaded' })
      const ruleNameInput = restrictedPage.getByPlaceholder('Enter a descriptive rule name')
      await expect(ruleNameInput).toHaveValue(ruleName)
      await ruleNameInput.fill(`${ruleName} renamed`)
      await restrictedPage.getByRole('button', { name: 'Update Rule' }).first().click()
      await expect(restrictedPage.getByText(GRANT_REFUSAL).first()).toBeVisible()
      expect(await readRuleEnabled(request, adminToken, ruleId)).toBe(true)

      await restrictedPage.goto(`/backend/rules/${ruleId}`, { waitUntil: 'domcontentloaded' })
      await expect(restrictedPage.getByPlaceholder('Enter a descriptive rule name')).toHaveValue(ruleName)
      await restrictedPage.getByRole('checkbox', { name: 'Enabled' }).uncheck()
      await restrictedPage.getByRole('button', { name: 'Update Rule' }).first().click()
      await expect(restrictedPage).toHaveURL(/\/backend\/rules(?:\?.*)?$/)
      expect(await readRuleEnabled(request, adminToken, ruleId), 'the edit form can switch the rule off').toBe(false)

      await restrictedPage.goto('/backend/rules', { waitUntil: 'domcontentloaded' })
      const restrictedRow = restrictedPage.getByRole('row').filter({ hasText: ruleName })
      await restrictedRow.getByRole('button', { name: 'No', exact: true }).click()
      await expect(restrictedPage.getByText(GRANT_REFUSAL).first(), 'list toggle shows why re-enabling is refused').toBeVisible()
      expect(await readRuleEnabled(request, adminToken, ruleId)).toBe(false)

      await grantorPage.goto('/backend/rules', { waitUntil: 'domcontentloaded' })
      const grantorRow = grantorPage.getByRole('row').filter({ hasText: ruleName })
      await grantorRow.getByRole('button', { name: 'No', exact: true }).click()
      await expect(grantorRow.getByRole('button', { name: 'Yes', exact: true })).toBeVisible()
      expect(await readRuleEnabled(request, adminToken, ruleId), 'grantor re-enables the rule').toBe(true)
    } finally {
      for (const page of pages) await page.context().close().catch(() => undefined)
      await deleteBusinessRuleIfExists(request, adminToken, ruleId)
      for (const apiKeyId of apiKeyIds) {
        await apiRequest(request, 'DELETE', `${API_KEYS_PATH}?id=${encodeURIComponent(apiKeyId)}`, { token: adminToken }).catch(() => undefined)
      }
      await cleanupBusinessRulesUser(request, adminToken, restricted?.userId ?? null, restricted?.roleId ?? null)
      await cleanupBusinessRulesUser(request, adminToken, grantor?.userId ?? null, grantor?.roleId ?? null)
      for (const roleId of roleIds) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
