import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteBusinessRuleIfExists } from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import { fillControlledInput } from '@open-mercato/core/helpers/integration/ui'

test.describe('TC-BR-8700: manual rule identifier guidance', () => {
  for (const { locale, requiredMessage } of [
    { locale: 'en', requiredMessage: 'This field is required' },
    { locale: 'pl', requiredMessage: 'To pole jest wymagane' },
  ]) {
    test(`requires an explicit identifier and preserves it after ${locale} create and reload`, async ({ page }, testInfo) => {
      const token = await getAuthToken(page.request, 'admin')
      const ruleKey = `QA8700_${randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`
      let ruleId: string | null = null
      let createRequests = 0
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/business_rules/rules') createRequests += 1
      })
      try {
        await login(page, 'admin')
        expect((await page.request.post('/api/auth/locale', { data: { locale } })).status()).toBe(200)
        if (locale === 'pl') await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/backend/rules/create')
        const identifier = page.getByPlaceholder('ORDER_APPROVAL_CHECK', { exact: true })
        await expect(identifier).toHaveValue('')
        await fillControlledInput(page.getByRole('main').getByRole('textbox').nth(1), ruleKey)
        await page.locator('main select').selectOption('VALIDATION')
        const entityType = page.locator('[data-crud-field-id="entityType"]').getByRole('combobox')
        await fillControlledInput(entityType, 'Qa8700Entity')
        await entityType.press('Tab')
        await identifier.press('Control+Enter')
        await expect(page.locator('[data-crud-field-id="ruleId"]').getByText(requiredMessage, { exact: true }).first()).toBeVisible()
        await expect(page).toHaveURL((url) => url.pathname === '/backend/rules/create')
        expect(createRequests).toBe(0)
        await testInfo.attach(`manual-rule-id-${locale}`, { body: await page.screenshot(), contentType: 'image/png' })

        await fillControlledInput(identifier, ruleKey)
        const pending = page.waitForResponse((response) =>
          new URL(response.url()).pathname === '/api/business_rules/rules' && response.request().method() === 'POST')
        await identifier.press('Control+Enter')
        const response = await pending
        expect(response.status()).toBe(201)
        expect(response.request().postDataJSON()).toMatchObject({ ruleId: ruleKey })
        ruleId = expectId(((await response.json()) as { id?: string }).id, 'Owned business rule id')
        await expect(page).toHaveURL((url) => url.pathname === `/backend/rules/${ruleId}`)
        await page.reload()
        await expect(page.getByPlaceholder('ORDER_APPROVAL_CHECK', { exact: true })).toHaveValue(ruleKey)
        const persisted = await apiRequest(page.request, 'GET', `/api/business_rules/rules/${ruleId}`, { token })
        expect(persisted.status()).toBe(200)
        expect(await readJsonSafe(persisted)).toMatchObject({ id: ruleId, ruleId: ruleKey })
        expect(createRequests).toBe(1)
      } finally {
        await page.request.post('/api/auth/locale', { data: { locale: 'en' } })
        await deleteBusinessRuleIfExists(page.request, token, ruleId)
      }
    })
  }
})
