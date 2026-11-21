import { expect, test, type Request } from '@playwright/test'
import { acknowledgeGlobalNotices } from '@open-mercato/core/helpers/integration/auth'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedSystemEmailChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { createEmailBudgetFixture, deleteEmailBudgetSystemChannel, readEmailBudgetLedger } from './emailBudgetFixture'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'

const copyByLocale = {
  en: {
    public: 'Public',
    email: 'External email',
    subject: 'Subject',
    body: 'Write your message...',
    priority: 'Urgent',
    send: 'Send',
    quotaError: 'Daily external recipient limit reached. Try again tomorrow.',
  },
  pl: {
    public: 'Publiczna',
    email: 'Zewnętrzny e-mail',
    subject: 'Temat',
    body: 'Napisz wiadomość...',
    priority: 'Pilny',
    send: 'Wyślij',
    quotaError: 'Osiągnięto dzienny limit zewnętrznych odbiorców. Spróbuj ponownie jutro.',
  },
} as const

function isComposePost(request: Request) {
  return request.method() === 'POST' && new URL(request.url()).pathname === '/api/messages'
}

async function listMessageIds(tenantId: string) {
  return withClient(async (client) => {
    const result = await client.query<{ id: string }>('select id from messages where tenant_id = $1', [tenantId])
    return result.rows.map(({ id }) => id)
  })
}

test.describe('TC-MSG-EMAIL-003: Localized quota refusal in the real composer', () => {
  for (const locale of ['en', 'pl'] as const) {
    test(`keeps the ${locale} compose form intact on quota refusal and cancels without writing`, async ({ page, request }, testInfo) => {
      const fixture = await createEmailBudgetFixture(request, page.request)
      const { token, tenantId } = fixture
      const acceptedAddress = `allowed-${tenantId}@example.test`
      const refusedAddress = `refused-${tenantId}@example.test`
      const subjectText = `QA quota ${locale} ${tenantId}`
      const bodyText = 'Keep this entire message.\nKeep this second line too.'
      const copy = copyByLocale[locale]
      let channelId: string | null = null

      try {
        test.skip(!await isChannelSeedingAvailable(request, token), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
        await fixture.setDailyLimit(1)
        channelId = await seedSystemEmailChannel(request, token)
        const acceptedId = await composeMessageWithToken(request, token, {
          visibility: 'public',
          externalEmail: acceptedAddress,
          recipients: [],
          subject: `QA quota baseline ${tenantId}`,
          body: 'Reserve the one daily recipient slot.',
          sendViaEmail: true,
        })
        const ledgerBefore = await readEmailBudgetLedger(tenantId)
        expect(ledgerBefore.recipients).toHaveLength(1)

        await acknowledgeGlobalNotices(page)
        const localeResponse = await page.request.post('/api/auth/locale', { data: { locale } })
        test.skip(localeResponse.status() === 409, 'Locale switching is disabled by OM_FORCE_LOCALE.')
        expect(localeResponse.ok()).toBe(true)
        await Promise.all([
          page.waitForResponse((response) =>
            response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/attachments' && response.ok(),
          ),
          page.goto('/backend/messages/compose', { waitUntil: 'domcontentloaded' }),
        ])

        const visibility = page.getByRole('radio', { name: copy.public, exact: true })
        const email = page.getByLabel(copy.email, { exact: true })
        const subject = page.getByRole('textbox', { name: copy.subject, exact: true })
        const body = page.getByPlaceholder(copy.body, { exact: true })
        const priority = page.getByRole('radio', { name: copy.priority, exact: true })
        const send = page.getByRole('button', { name: copy.send, exact: true })
        await visibility.click()
        await email.fill(refusedAddress)
        await subject.fill(subjectText)
        await body.fill(bodyText)
        await priority.click()

        const sentRequests: Request[] = []
        page.on('request', (browserRequest) => {
          if (isComposePost(browserRequest)) sentRequests.push(browserRequest)
        })
        const pending = Promise.withResolvers<void>()
        await page.route('**/api/messages', async (route) => {
          if (isComposePost(route.request())) await pending.promise
          await route.continue()
        })

        const expectRefusal = async () => {
          const response = await page.waitForResponse((candidate) => isComposePost(candidate.request()))
          expect(response.status()).toBe(429)
          expect(Number(response.headers()['retry-after'])).toBeGreaterThan(0)
          await expect(page.getByText(copy.quotaError, { exact: true }).first()).toBeVisible()
          await expect(send).toBeEnabled()
          await expect(visibility).toHaveAttribute('aria-checked', 'true')
          await expect(priority).toHaveAttribute('aria-checked', 'true')
          await expect(email).toHaveValue(refusedAddress)
          await expect(subject).toHaveValue(subjectText)
          await expect(body).toHaveValue(bodyText)
        }

        await Promise.all([
          expectRefusal(),
          send.dblclick().finally(() => pending.resolve()),
        ])
        expect(sentRequests).toHaveLength(1)

        await Promise.all([expectRefusal(), subject.press('Control+Enter')])
        expect(sentRequests.map((browserRequest) => browserRequest.postDataJSON())).toEqual([
          expect.objectContaining({ externalEmail: refusedAddress, subject: subjectText, body: bodyText, priority: 'urgent', visibility: 'public' }),
          expect.objectContaining({ externalEmail: refusedAddress, subject: subjectText, body: bodyText, priority: 'urgent', visibility: 'public' }),
        ])
        if (process.env.PW_CAPTURE_SCREENSHOTS === '1') {
          await page.screenshot({ path: testInfo.outputPath(`quota-refused-${locale}.png`) })
        }

        await subject.press('Escape')
        await expect(page).toHaveURL(/\/backend\/messages\/?$/)
        expect(sentRequests).toHaveLength(2)
        expect(await listMessageIds(tenantId)).toEqual([acceptedId])
        expect(await readEmailBudgetLedger(tenantId)).toEqual(ledgerBefore)
        await drainIntegrationQueue('events')
        await drainIntegrationQueue('messages-email')
        const delivered = await listCapturedSystemEmails(request, token)
        expect(delivered.filter((message) => message.metadata?.to === acceptedAddress)).toHaveLength(1)
        expect(delivered.some((message) =>
          message.metadata?.to === refusedAddress || message.metadata?.subject === subjectText,
        )).toBe(false)
      } finally {
        try {
          for (const messageId of await listMessageIds(tenantId)) {
            await deleteMessageIfExists(request, token, messageId)
          }
          if (channelId) await clearCapturedSystemEmails(request, token)
        } finally {
          try {
            await deleteEmailBudgetSystemChannel(request, token, channelId)
          } finally {
            await fixture.cleanup()
          }
        }
      }
    })
  }
})
