import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  createCompanyFixture,
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const addressesPath = '/api/customers/addresses'
const definitionsPath = '/api/entities/definitions'
const addressHost = 'customers:customer_address'

async function createDefinition(request: APIRequestContext, token: string, key: string, label: string) {
  const response = await apiRequest(request, 'POST', definitionsPath, {
    token,
    data: { entityId: addressHost, key, kind: 'text', configJson: { label, formEditable: true, listVisible: true } },
  })
  expect(response.ok()).toBe(true)
}

async function removeDefinition(request: APIRequestContext, token: string, key: string) {
  await apiRequest(request, 'DELETE', `${definitionsPath}?${new URLSearchParams({ entityId: addressHost, key })}`, { token })
}

async function enterAddress(page: Page, label: string, line1: string, note: string) {
  await page.getByRole('button', { name: /add address/i }).first().click()
  await page.getByPlaceholder(/^(address line 1|street)$/i).fill(line1)
  await page.getByRole('textbox', { name: label }).fill(note)
  await page.getByRole('button', { name: /^save address/i }).click()
}

test.describe('CRM address custom fields', () => {
  for (const kind of ['people', 'companies'] as const) {
    test(`edits, reloads, and clears a ${kind} address value`, async ({ page, request }) => {
      const token = await getAuthToken(request, 'admin')
      const suffix = randomUUID().slice(0, 8)
      const key = `address_note_${suffix}`
      const label = `Gate note ${suffix}`
      let parentId: string | null = null
      try {
        await createDefinition(request, token, key, label)
        parentId = kind === 'people'
          ? await createPersonFixture(request, token, { firstName: 'Address', lastName: suffix, displayName: `Address ${suffix}` })
          : await createCompanyFixture(request, token, `Address Company ${suffix}`)
        await login(page, 'admin')
        await page.goto(`/backend/customers/${kind}/${parentId}?tab=addresses`)
        await expect(page.getByRole('tab', { name: 'Addresses' })).toHaveAttribute('aria-selected', 'true')
        await enterAddress(page, label, `148 Gate Street ${suffix}`, 'Use the north gate')
        await expect(page.getByText('Use the north gate', { exact: true })).toBeVisible()

        await page.reload()
        await expect(page.getByText('Use the north gate', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Edit address' }).click()
        const note = page.getByRole('textbox', { name: label })
        await expect(note).toHaveValue('Use the north gate')
        await note.fill('Use the west gate')
        await note.press('Control+Enter')
        await expect(page.getByText('Use the west gate', { exact: true })).toBeVisible()

        await page.getByRole('button', { name: 'Edit address' }).click()
        await note.fill('')
        await page.getByRole('button', { name: /^update address/i }).click()
        await expect(note).toHaveCount(0)
        await page.reload()
        await page.getByRole('button', { name: 'Edit address' }).click()
        await expect(note).toHaveValue('')
      } finally {
        await deleteEntityIfExists(request, token, `/api/customers/${kind}`, parentId)
        await removeDefinition(request, token, key)
      }
    })
  }

  test('retries only unfinished addresses after creating a company', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const suffix = randomUUID().slice(0, 8)
    const key = `address_retry_note_${suffix}`
    const label = `Access note ${suffix}`
    const blockedAddress = `20 Retry Avenue ${suffix}`
    const confirmedAddress = `19 Retry Avenue ${suffix}`
    const attempts: string[] = []
    let companyId: string | null = null
    let parentRequests = 0

    try {
      await createDefinition(request, token, key, label)
      await login(page, 'admin')
      await page.route(`**${addressesPath}`, async (route) => {
        const outgoing = route.request()
        if (outgoing.method() !== 'POST') return route.continue()
        const line1 = outgoing.postDataJSON().addressLine1 as string
        attempts.push(line1)
        if (line1 === blockedAddress) {
          const addressAttempts = attempts.filter((entry) => entry === blockedAddress).length
          if (addressAttempts === 1) {
            return route.fulfill({ status: 422, json: { error: 'Address data failed validation.' } })
          }
          if (addressAttempts === 2) {
            const saved = await route.fetch()
            if (!saved.ok()) return route.fulfill({ response: saved })
            return route.abort('connectionreset')
          }
        }
        return route.continue()
      })
      page.on('request', (outgoing) => {
        if (outgoing.method() === 'POST' && new URL(outgoing.url()).pathname === '/api/customers/companies') {
          parentRequests += 1
        }
      })
      await page.goto('/backend/customers/companies/create')
      await page.locator('[data-crud-field-id="displayName"]').getByRole('textbox').fill(`Retry Company ${suffix}`)

      await page.getByRole('button', { name: /add address/i }).first().click()
      await page.getByPlaceholder(/^(address line 1|street)$/i).fill(blockedAddress)
      await page.getByRole('textbox', { name: label }).fill('Keep this address draft')
      await page.getByRole('button', { name: 'Create Company', exact: true }).first().click()
      const finishDraft = page.getByText('Finish editing the address before saving the customer.', { exact: true })
      await expect(finishDraft.first()).toBeVisible()
      expect(parentRequests).toBe(0)
      await page.getByRole('button', { name: /^save address/i }).click()
      await enterAddress(page, label, confirmedAddress, 'This address succeeds first')

      const parentCreated = page.waitForResponse((response) => (
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/customers/companies'
      ))
      await page.getByRole('button', { name: 'Create Company', exact: true }).first().click()
      const response = await parentCreated
      const body = await response.json() as { id?: string; entityId?: string }
      companyId = expectId(body.id ?? body.entityId, 'company creation')

      const retryButton = page.getByRole('button', { name: 'Save remaining addresses' }).first()
      await expect(retryButton).toBeVisible()
      await expect(page.getByText('Keep this address draft', { exact: true })).toBeVisible()
      await expect(page.getByText('This address succeeds first', { exact: true })).toHaveCount(0)
      await retryButton.click()
      await expect(page.getByText('Save unconfirmed', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Check address book (new tab)' })).toHaveAttribute(
        'href', `/backend/customers/companies/${companyId}?tab=addresses`,
      )
      await retryButton.click()
      await expect(page.getByText('Save unconfirmed', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'The address is there' }).click()
      await retryButton.click()
      await expect(page).toHaveURL(new RegExp(`/backend/customers/companies-v2/${companyId}$`))
      expect(parentRequests).toBe(1)
      expect(attempts).toEqual([confirmedAddress, blockedAddress, blockedAddress])

      const addressResponse = await apiRequest(request, 'GET', `${addressesPath}?entityId=${companyId}`, { token })
      const result = await readJsonSafe<{ items: Array<{ customValues?: Record<string, unknown> }> }>(addressResponse)
      expect(result?.items.map((item) => item.customValues?.[key]).sort()).toEqual([
        'Keep this address draft',
        'This address succeeds first',
      ])
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/companies', companyId)
      await removeDefinition(request, token, key)
    }
  })
})
