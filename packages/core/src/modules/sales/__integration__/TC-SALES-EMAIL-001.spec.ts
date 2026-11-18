import { expect, test } from '@playwright/test'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createPersonFixture,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import { createSalesQuoteFixture, deleteSalesEntityIfExists } from '@open-mercato/core/helpers/integration/salesFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  seedSystemEmailChannel,
  waitForCapturedSystemEmail,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'

function extractQuoteToken(body: unknown): string {
  const text = String(body ?? '')
  const match = /\/quote\/([0-9a-f-]{36})/i.exec(text)
  expect(match?.[1], 'quote acceptance token should be present in the email body').toBeTruthy()
  return match![1]
}

function appBaseUrl(): string {
  const baseUrl = new URL(process.env.BASE_URL || 'http://localhost:3000')
  if (baseUrl.hostname === '127.0.0.1') baseUrl.hostname = 'localhost'
  return baseUrl.origin
}

test.describe('TC-SALES-EMAIL-001: Sales emails use system channel', () => {
  test('quote send and quote accept admin notification dispatch through Communications Hub', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    const adminEmail = process.env.ADMIN_EMAIL || 'ops@your-domain.com'
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')

    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)

    const stamp = Date.now()
    const customerEmail = `qa-sales-email-${stamp}@example.test`
    let personId: string | null = null
    let quoteId: string | null = null
    let orderId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'Quote',
        lastName: 'Recipient',
        displayName: `Quote Recipient ${stamp}`,
        primaryEmail: customerEmail,
      })

      const create = await apiRequest(request, 'POST', '/api/sales/quotes', {
        token,
        data: {
          currencyCode: 'USD',
          customerEntityId: personId,
        },
      })
      expect(create.status()).toBe(201)
      quoteId = (await readJsonSafe<{ id?: string }>(create))?.id ?? null
      expect(typeof quoteId).toBe('string')

      const update = await apiRequest(request, 'PUT', '/api/sales/quotes', {
        token,
        data: {
          id: quoteId,
          metadata: { customerEmail },
        },
      })
      const updateBody = await readJsonSafe<{ contactEmail?: string | null }>(update)
      expect(update.status(), `quote update response: ${JSON.stringify(updateBody)}`).toBe(200)
      expect(updateBody?.contactEmail).toBe(customerEmail)

      const detailUrl = `/api/sales/quotes?id=${quoteId}`
      const beforeSend = await apiRequest(request, 'GET', detailUrl, { token })
      expect(beforeSend.status()).toBe(200)
      const beforeBody = await readJsonSafe<{ items: Array<{ updatedAt: string }> }>(beforeSend)
      expect(beforeBody?.items[0]?.updatedAt).toBeTruthy()

      const send = await apiRequest(request, 'POST', '/api/sales/quotes/send', {
        token,
        data: { quoteId, validForDays: 14 },
      })
      expect(send.status(), `quote send response: ${JSON.stringify(await readJsonSafe(send))}`).toBe(200)

      const afterSend = await apiRequest(request, 'GET', detailUrl, { token })
      expect(afterSend.status()).toBe(200)
      expect(afterSend.headers()['x-om-cache']).not.toBe('hit')
      const afterBody = await readJsonSafe<{ items: Array<{ status: string; updatedAt: string; validUntil: string }> }>(afterSend)
      const sentQuote = afterBody?.items[0]
      expect(sentQuote?.status).toBe('sent')
      expect(sentQuote?.updatedAt).not.toBe(beforeBody?.items[0]?.updatedAt)
      expect(new Date(sentQuote!.validUntil).getTime()).toBeGreaterThan(Date.now() + 13 * 86400000)
      const quoteEmail = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === customerEmail && String(email.metadata?.subject ?? '').startsWith('Quote '),
        { description: 'sales quote email' },
      )
      expect(String(quoteEmail.metadata?.from ?? '')).toContain('@')
      expect(quoteEmail.scope.tenantId).toBe(scope.tenantId)
      expect(quoteEmail.scope.organizationId).toBe(scope.organizationId)
      expect(quoteEmail.content.bodyFormat).toBe('html')

      const acceptanceToken = extractQuoteToken(quoteEmail.content.text ?? quoteEmail.content.html)
      await clearCapturedSystemEmails(request, token)

      const origin = appBaseUrl()
      const accept = await request.post(`${origin}/api/sales/quotes/accept`, {
        data: { token: acceptanceToken },
        headers: { 'Content-Type': 'application/json', Origin: origin },
      })
      expect(accept.status()).toBe(200)
      const acceptBody = await readJsonSafe<{ orderId?: string }>(accept)
      orderId = acceptBody?.orderId ?? null

      const acceptedEmail = await waitForCapturedSystemEmail(
        request,
        token,
        (email) => email.metadata?.to === adminEmail && String(email.metadata?.subject ?? '').includes('accepted'),
        { description: 'sales quote accepted admin email' },
      )
      expect(acceptedEmail.scope.tenantId).toBe(scope.tenantId)
      expect(acceptedEmail.scope.organizationId).toBe(scope.organizationId)
      expect(acceptedEmail.content.bodyFormat).toBe('html')
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/orders', orderId)
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})


test('a warmed quote detail can be edited with the version returned after sending', async ({ request }) => {
  const token = await getAuthToken(request, 'admin')
  test.skip(!await isChannelSeedingAvailable(request, token), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
  await seedSystemEmailChannel(request, token)
  const quoteId = await createSalesQuoteFixture(request, token)
  try {
    const prepare = await apiRequest(request, 'PUT', '/api/sales/quotes', {
      token, data: { id: quoteId, metadata: { customerEmail: `quote-refresh-${quoteId}@example.test` } },
    })
    expect(prepare.status()).toBe(200)
    const detailUrl = `/api/sales/quotes?id=${quoteId}`
    const before = await apiRequest(request, 'GET', detailUrl, { token })
    expect(before.status()).toBe(200)
    const send = await apiRequest(request, 'POST', '/api/sales/quotes/send', {
      token, data: { quoteId, validForDays: 30 },
    })
    expect(send.status()).toBe(200)
    const refreshed = await apiRequest(request, 'GET', detailUrl, { token })
    expect(refreshed.status()).toBe(200)
    expect(refreshed.headers()['x-om-cache']).not.toBe('hit')
    const body = await readJsonSafe<{ items: Array<{ status: string; updatedAt: string }> }>(refreshed)
    expect(body?.items[0]?.status).toBe('sent')
    expect(body?.items[0]?.updatedAt).toBeTruthy()
    const edit = await apiRequest(request, 'PUT', '/api/sales/quotes', {
      token,
      headers: { 'x-om-ext-optimistic-lock-expected-updated-at': body!.items[0].updatedAt },
      data: { id: quoteId, externalReference: `sent-${quoteId}` },
    })
    expect(edit.status()).toBe(200)
  } finally {
    await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
  }
})

for (const emailFailed of [false, true]) {
  test(`quote detail refreshes the committed version before resending (simulated delivery failure: ${emailFailed})`, async ({ page, request }, testInfo) => {
    const token = await getAuthToken(request, 'admin')
    test.skip(!await isChannelSeedingAvailable(request, token), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
    await seedSystemEmailChannel(request, token)
    const quoteId = await createSalesQuoteFixture(request, token)
    try {
      const prepare = await apiRequest(request, 'PUT', '/api/sales/quotes', {
        token, data: { id: quoteId, metadata: { customerEmail: `quote-ui-${quoteId}@example.test` } },
      })
      expect(prepare.status()).toBe(200)
      if (emailFailed) await page.setViewportSize({ width: 390, height: 844 })
      await login(page, 'admin')
      await page.goto(`/backend/sales/quotes/${quoteId}`)
      let sends = 0
      await page.route('**/api/sales/quotes/send', async (route) => {
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        sends += 1
        if (emailFailed && sends === 1) {
          await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ quoteSent: true, error: 'Simulated postcommit delivery failure' }) })
        } else {
          await route.fulfill({ response })
        }
      })
      const openSend = async () => {
        const actions = page.getByRole('button', { name: 'Actions', exact: true })
        await actions.focus()
        await actions.press('Enter')
        await page.getByRole('menuitem', { name: 'Send to customer' }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
      }
      await openSend()
      await page.getByRole('button', { name: 'Send quote', exact: true }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
      await expect(page.getByText(emailFailed ? 'Quote marked as sent, but the email could not be delivered.' : 'Quote sent.', { exact: true })).toBeVisible()
      const refreshed = await apiRequest(request, 'GET', `/api/sales/quotes?id=${quoteId}`, { token })
      const body = await readJsonSafe<{ items: Array<{ updatedAt: string; status: string }> }>(refreshed)
      expect(body?.items[0].status).toBe('sent')
      await openSend()
      const nextSend = page.waitForRequest((sent) => sent.url().endsWith('/api/sales/quotes/send') && sent.method() === 'POST')
      await page.getByRole('button', { name: 'Send quote', exact: true }).click()
      expect((await nextSend).headers()['x-om-ext-optimistic-lock-expected-updated-at']).toBe(body?.items[0].updatedAt)
      await expect(page.getByRole('dialog')).toBeHidden()
      expect(sends).toBe(2)
      await page.screenshot({ path: testInfo.outputPath(`quote-send-${emailFailed ? 'delivery-failed' : 'success'}.png`), fullPage: true })
    } finally {
      await deleteSalesEntityIfExists(request, token, '/api/sales/quotes', quoteId)
    }
  })
}
