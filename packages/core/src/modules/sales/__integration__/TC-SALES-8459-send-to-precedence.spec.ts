/**
 * TC-SALES-8459: the document's "Send to" e-mail wins over the customer record
 *
 * A quote whose metadata carries `customerEmail` (the form's "Send to" field) must
 * report and use that address even when the customer record has its own e-mail:
 * - the documents update response reports it as `contactEmail`
 * - the documents list reports it too, and the quotes table shows it
 * - the Send quote dialog announces it
 * - the quote e-mail goes to it (needs the test channel seeding; skipped otherwise)
 * - a copy equal to the customer e-mail follows an edit on the customer card
 * - clearing that copy, or moving to a customer without e-mail, removes the recipient at once
 *
 * Fixtures: people and one quote per case, created through the API and removed in `finally`.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

export const integrationMeta = { dependsOnModules: ['sales', 'customers'] }

async function openSendAction(page: Page): Promise<Locator> {
  const sendAction = page.getByRole('menuitem', { name: 'Send to customer', exact: true })
  await expect(async () => {
    await page.mouse.move(0, 0)
    await page.getByRole('button', { name: 'Actions', exact: true }).hover()
    await expect(sendAction).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  return sendAction
}

async function expectAnnouncedRecipient(page: Page, email: string): Promise<void> {
  await (await openSendAction(page)).click()
  const dialog = page.getByRole('dialog', { name: 'Send quote to customer' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(`Email will be sent to: ${email}`), 'the dialog names the recipient').toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}

async function expectNoRecipient(page: Page): Promise<void> {
  await expect(await openSendAction(page), 'sending needs a recipient').toBeDisabled()
}

async function saveCustomerCard(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/sales/quotes' && response.request().method() === 'PUT',
  )
  await page.getByRole('button', { name: /^Save .*Ctrl\+Enter/ }).first().click()
  expect((await saved).status()).toBe(200)
}

test.describe('TC-SALES-8459: Send to precedence', () => {
  test('the API reports the document address and the quote e-mail goes there', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const recordEmail = `qa-8459-record-${stamp}@example.test`
    const sendToEmail = `qa-8459-sendto-${stamp}@example.test`
    let personId: string | null = null
    let quoteId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'SendTo',
        lastName: `Precedence ${stamp}`,
        displayName: `SendTo Precedence ${stamp}`,
        primaryEmail: recordEmail,
      })

      const create = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD', customerEntityId: personId },
      })
      expect(create.status()).toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(create))?.id ?? null
      expect(typeof quoteId).toBe('string')

      const before = await apiRequest(request, 'PUT', '/api/sales/quotes', {
        token,
        data: { id: quoteId, customerReference: `PO-8459-${stamp}` },
      })
      expect(before.status()).toBe(200)
      expect((await readJsonSafe<{ contactEmail?: string | null }>(before))?.contactEmail, 'record e-mail is the fallback').toBe(recordEmail)

      const update = await apiRequest(request, 'PUT', '/api/sales/quotes', {
        token,
        data: { id: quoteId, metadata: { customerEmail: sendToEmail } },
      })
      expect(update.status()).toBe(200)
      expect((await readJsonSafe<{ contactEmail?: string | null }>(update))?.contactEmail, 'Send to wins over the record e-mail').toBe(sendToEmail)

      const list = await apiRequest(request, 'GET', `/api/sales/quotes?customerId=${encodeURIComponent(personId)}&pageSize=10`, { token })
      expect(list.status()).toBe(200)
      const listed = (await readJsonSafe<{ items?: Array<{ id?: string; quoteNumber?: string | null; contactEmail?: string | null; metadata?: unknown }> }>(list))?.items?.find((item) => item.id === quoteId)
      expect(listed?.contactEmail, 'the list reports Send to').toBe(sendToEmail)
      expect(listed?.metadata ?? null, 'the list still leaves metadata out').toBeNull()

      await login(page, 'admin')
      await page.goto('/backend/sales/quotes', { waitUntil: 'domcontentloaded' })
      await page.getByPlaceholder('Search quotes…').fill(String(listed?.quoteNumber))
      await expect(page.getByRole('row', { name: new RegExp(String(listed?.quoteNumber)) }), 'the table shows Send to').toContainText(sendToEmail, { timeout: 30_000 })

      await login(page, 'admin')
      await page.goto(`/backend/sales/quotes/${encodeURIComponent(quoteId as string)}`, { waitUntil: 'domcontentloaded' })
      await expectAnnouncedRecipient(page, sendToEmail)

      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      if (seedingAvailable) {
        await seedSystemEmailChannel(request, token)
        await clearCapturedSystemEmails(request, token)
        const send = await apiRequest(request, 'POST', '/api/sales/quotes/send', {
          token,
          data: { quoteId, validForDays: 14 },
        })
        expect(send.status()).toBe(200)
        const quoteEmail = await waitForCapturedSystemEmail(
          request,
          token,
          (email) => String(email.metadata?.subject ?? '').startsWith('Quote '),
          { description: 'sales quote email' },
        )
        expect(quoteEmail.metadata?.to, 'the quote e-mail goes to Send to').toBe(sendToEmail)
      }
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('editing the customer e-mail on the card updates a create-time copy', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const recordEmail = `qa-8459-copy-${stamp}@example.test`
    const editedEmail = `qa-8459-edited-${stamp}@example.test`
    let personId: string | null = null
    let quoteId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'SendTo',
        lastName: `Copy ${stamp}`,
        displayName: `SendTo Copy ${stamp}`,
        primaryEmail: recordEmail,
      })
      const create = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD', customerEntityId: personId, metadata: { customerEmail: recordEmail } },
      })
      expect(create.status()).toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(create))?.id ?? null
      expect(typeof quoteId).toBe('string')

      await login(page, 'admin')
      await page.goto(`/backend/sales/quotes/${encodeURIComponent(quoteId as string)}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Edit customer snapshot' }).and(page.locator('button')).click()
      const emailInput = page.getByPlaceholder('name@example.com')
      await expect(emailInput).toHaveValue(recordEmail)
      await emailInput.fill(editedEmail)
      await expect(emailInput).toHaveValue(editedEmail)
      const saved = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/sales/quotes' && response.request().method() === 'PUT',
      )
      await page.getByRole('button', { name: /^Save .*Ctrl\+Enter/ }).first().click()
      expect((await saved).status()).toBe(200)

      await expectAnnouncedRecipient(page, editedEmail)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('clearing the copied e-mail on the card removes the recipient without a reload', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const recordEmail = `qa-8459-clear-${stamp}@example.test`
    let personId: string | null = null
    let quoteId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'SendTo',
        lastName: `Clear ${stamp}`,
        displayName: `SendTo Clear ${stamp}`,
        primaryEmail: recordEmail,
      })
      const create = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD', customerEntityId: personId, metadata: { customerEmail: recordEmail } },
      })
      expect(create.status()).toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(create))?.id ?? null
      expect(typeof quoteId).toBe('string')

      await login(page, 'admin')
      await page.goto(`/backend/sales/quotes/${encodeURIComponent(quoteId as string)}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Edit customer snapshot' }).and(page.locator('button')).click()
      const emailInput = page.getByPlaceholder('name@example.com')
      await expect(emailInput).toHaveValue(recordEmail)
      await emailInput.fill('')
      await expect(emailInput).toHaveValue('')
      await saveCustomerCard(page)

      await expectNoRecipient(page)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expectNoRecipient(page)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('moving to a customer without an e-mail removes the recipient without a reload', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const recordEmail = `qa-8459-switch-${stamp}@example.test`
    const noEmailName = `SendTo NoEmail ${stamp}`
    let personId: string | null = null
    let noEmailPersonId: string | null = null
    let quoteId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'SendTo',
        lastName: `Switch ${stamp}`,
        displayName: `SendTo Switch ${stamp}`,
        primaryEmail: recordEmail,
      })
      noEmailPersonId = await createPersonFixture(request, token, {
        firstName: 'SendTo',
        lastName: `NoEmail ${stamp}`,
        displayName: noEmailName,
      })
      const create = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD', customerEntityId: personId, metadata: { customerEmail: recordEmail } },
      })
      expect(create.status()).toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(create))?.id ?? null
      expect(typeof quoteId).toBe('string')

      await login(page, 'admin')
      await page.goto(`/backend/sales/quotes/${encodeURIComponent(quoteId as string)}`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Select customer' }).and(page.locator('button')).click()
      const search = page.getByPlaceholder('Search customers…')
      const option = page.getByRole('option', { name: new RegExp(noEmailName) })
      await expect(async () => {
        await search.fill(noEmailName)
        await expect(option).toBeVisible({ timeout: 3_000 })
      }).toPass({ timeout: 30_000 })
      await option.click()
      await saveCustomerCard(page)

      await expectNoRecipient(page)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expectNoRecipient(page)
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteEntityIfExists(request, token, '/api/customers/people', noEmailPersonId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
