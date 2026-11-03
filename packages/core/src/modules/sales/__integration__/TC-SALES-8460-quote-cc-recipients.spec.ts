/**
 * TC-SALES-8460: CC recipients when sending a quote
 *
 * Verifies through the API and the quote e-mail capture (needs the test channel
 * seeding; the e-mail part is skipped otherwise):
 * - `POST /api/sales/quotes/send` accepts `cc`, drops the primary address and
 *   duplicates, and remembers the list on the quote (`metadata.recipients.cc`)
 * - the main recipient gets the acceptance link; each CC recipient gets their own copy
 *   of the quote details without it
 * - an invalid CC address is rejected with 400 and the quote stays unsent
 *
 * Verifies through the Send dialog:
 * - a confirmed tag and text still pending in the CC field are both sent, including
 *   when Ctrl+Enter is pressed from inside the field
 * - invalid pending text blocks the send and keeps the dialog open
 * - reopening the dialog pre-fills the list from `metadata.recipients.cc`
 *
 * Fixtures per test: one person with a primary e-mail and one quote, created through
 * the API and removed in `finally`.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  clearCapturedSystemEmails,
  type CapturedTestSeedEmail,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

export const integrationMeta = { dependsOnModules: ['sales', 'customers'] }

const QUOTE_LINK_PATTERN = /\/quote\//

function emailBody(email: CapturedTestSeedEmail): string {
  return `${email.content.text ?? ''}\n${email.content.html ?? ''}`
}

type QuoteItem = { metadata?: { recipients?: { cc?: string[] } } | null; status?: string | null }

async function readQuote(request: Parameters<typeof apiRequest>[0], token: string, quoteId: string): Promise<QuoteItem | undefined> {
  const response = await apiRequest(request, 'GET', `/api/sales/quotes?id=${encodeURIComponent(quoteId)}`, { token })
  expect(response.status()).toBe(200)
  return ((await readJsonSafe<{ items?: QuoteItem[] }>(response))?.items ?? [])[0]
}

async function openSendDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Actions', exact: true }).hover()
  await page.getByRole('menuitem', { name: 'Send to customer', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Send quote to customer' })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('TC-SALES-8460: CC recipients on quote send', () => {
  test('sends with CC, stores the list on the quote and rejects invalid addresses', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const primaryEmail = `qa-8460-primary-${stamp}@example.test`
    const ccPurchasing = `qa-8460-purchasing-${stamp}@example.test`
    const ccAccounting = `qa-8460-accounting-${stamp}@example.test`
    let personId: string | null = null
    let quoteId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Cc',
        lastName: `Recipients ${stamp}`,
        displayName: `Cc Recipients ${stamp}`,
        primaryEmail,
      })
      const create = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD', customerEntityId: personId },
      })
      expect(create.status()).toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(create))?.id ?? null
      expect(typeof quoteId).toBe('string')

      const rejected = await apiRequest(request, 'POST', '/api/sales/quotes/send', {
        token,
        data: { quoteId, validForDays: 14, cc: ['not-an-email'] },
      })
      expect(rejected.status(), 'invalid CC is rejected').toBe(400)
      expect((await readQuote(request, token, quoteId as string))?.status, 'quote stays unsent').not.toBe('sent')

      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      if (seedingAvailable) {
        await seedSystemEmailChannel(request, token)
        await clearCapturedSystemEmails(request, token)
      }

      const send = await apiRequest(request, 'POST', '/api/sales/quotes/send', {
        token,
        data: { quoteId, validForDays: 14, cc: [ccPurchasing, primaryEmail, ccPurchasing, ccAccounting] },
      })
      expect(send.status(), `quote send response: ${JSON.stringify(await readJsonSafe(send))}`).toBe(200)

      const sent = await readQuote(request, token, quoteId as string)
      expect(sent?.status).toBe('sent')
      expect(sent?.metadata?.recipients?.cc, 'CC list stored without the primary address or duplicates').toEqual([ccPurchasing, ccAccounting])

      if (seedingAvailable) {
        const isQuoteEmailTo = (email: CapturedTestSeedEmail, recipient: string) =>
          email.metadata?.to === recipient && String(email.metadata?.subject ?? '').startsWith('Quote ')
        const mainEmail = await waitForCapturedSystemEmail(
          request,
          token,
          (email) => isQuoteEmailTo(email, primaryEmail),
          { description: 'sales quote email to the main recipient' },
        )
        expect(emailBody(mainEmail), 'the main recipient gets the acceptance link').toMatch(QUOTE_LINK_PATTERN)
        for (const ccRecipient of [ccPurchasing, ccAccounting]) {
          const ccEmail = await waitForCapturedSystemEmail(
            request,
            token,
            (email) => isQuoteEmailTo(email, ccRecipient),
            { description: `sales quote copy to ${ccRecipient}` },
          )
          expect(emailBody(ccEmail), 'a CC copy never carries the acceptance link').not.toMatch(QUOTE_LINK_PATTERN)
        }
        const captured = await listCapturedSystemEmails(request, token)
        expect(
          captured.filter((email) => isQuoteEmailTo(email, primaryEmail)),
          'the main recipient is not mailed twice',
        ).toHaveLength(1)
      }
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })

  test('the Send dialog sends confirmed and pending CC, blocks invalid text and pre-fills on reopening', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const primaryEmail = `qa-8460-ui-primary-${stamp}@example.test`
    const ccConfirmed = `qa-8460-ui-confirmed-${stamp}@example.test`
    const ccPending = `qa-8460-ui-pending-${stamp}@example.test`
    let personId: string | null = null
    let quoteId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Cc',
        lastName: `Dialog ${stamp}`,
        displayName: `Cc Dialog ${stamp}`,
        primaryEmail,
      })
      const create = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: { currencyCode: 'USD', customerEntityId: personId },
      })
      expect(create.status()).toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(create))?.id ?? null
      expect(typeof quoteId).toBe('string')

      if (await isChannelSeedingAvailable(request, token)) {
        await seedSystemEmailChannel(request, token)
      }

      await login(page, 'admin')
      await page.goto(`/backend/sales/quotes/${encodeURIComponent(quoteId as string)}`, { waitUntil: 'domcontentloaded' })

      const dialog = await openSendDialog(page)
      const ccField = dialog.getByLabel('CC', { exact: true })

      await ccField.fill(ccConfirmed)
      await expect(ccField).toHaveValue(ccConfirmed)
      await ccField.press('Enter')
      await expect(dialog.getByRole('button', { name: `Remove ${ccConfirmed}`, exact: true })).toBeVisible()
      await expect(ccField).toHaveValue('')

      await ccField.fill('not-an-email')
      await expect(ccField).toHaveValue('not-an-email')
      await dialog.getByRole('button', { name: 'Send quote', exact: true }).click()
      await expect(dialog.getByRole('alert').filter({ hasText: 'Enter a valid e-mail address' })).toBeVisible()
      await expect(dialog, 'invalid pending text keeps the dialog open').toBeVisible()
      expect((await readQuote(request, token, quoteId as string))?.status, 'nothing was sent').not.toBe('sent')

      await ccField.fill(ccPending)
      await expect(ccField).toHaveValue(ccPending)
      const sendResponse = page.waitForResponse(
        (response) => response.url().includes('/api/sales/quotes/send') && response.request().method() === 'POST',
      )
      await ccField.press('Control+Enter')
      expect((await sendResponse).status()).toBe(200)
      await expect(dialog).toBeHidden()

      const sent = await readQuote(request, token, quoteId as string)
      expect(sent?.status).toBe('sent')
      expect(sent?.metadata?.recipients?.cc, 'the pending address is sent with the confirmed one').toEqual([ccConfirmed, ccPending])

      await page.reload({ waitUntil: 'domcontentloaded' })
      const reopened = await openSendDialog(page)
      await expect(reopened.getByRole('button', { name: `Remove ${ccConfirmed}`, exact: true }), 'pre-filled from the quote').toBeVisible()
      await expect(reopened.getByRole('button', { name: `Remove ${ccPending}`, exact: true }), 'pre-filled from the quote').toBeVisible()
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
