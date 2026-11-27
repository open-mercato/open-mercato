import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  deleteChannelIfExists,
  inspectMessageChannelLinks,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { QA_COPY_RECIPIENT, QA_RECIPIENTS, useRaisedExternalEmailBudget } from '@open-mercato/core/modules/messages/__integration__/scheduledSendFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-012 — mailbox CC and CRM interactions per link.
 *
 * A joint mailbox send with CC must deliver the CC (it used to be dropped
 * because CC never became a participant), record it as a `cc` participant and
 * surface it as `ccAddresses` on the CRM email interaction. A separate send to
 * two people creates one CRM interaction per link, while the Person's email
 * thread view still shows the message once.
 */

const APP_ROOT = process.env.OM_TEST_APP_ROOT?.trim()
  ? path.resolve(process.env.OM_TEST_APP_ROOT as string)
  : path.resolve(process.cwd(), 'apps/mercato')

if (!process.env.OM_TEST_APP_ROOT?.trim()) {
  loadEnv({ path: path.resolve(APP_ROOT, '.env') })
  if (!process.env.QUEUE_BASE_DIR?.trim()) {
    process.env.QUEUE_BASE_DIR = path.resolve(APP_ROOT, '.mercato/queue')
  }
}

async function drainUntil(check: () => Promise<boolean>, label: string): Promise<void> {
  const shouldDrainQueues = parseBooleanToken(process.env.AUTO_SPAWN_WORKERS) !== true
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (shouldDrainQueues) {
      await drainIntegrationQueue('communication-channels-outbound', { appRoot: APP_ROOT })
      await drainIntegrationQueue('events', { appRoot: APP_ROOT })
    }
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function sendAsUser(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<{ messageId: string; threadId: string }> {
  const response = await apiRequest(request, 'POST', '/api/communication_channels/send-as-user', { token, data })
  expect(response.status(), 'send-as-user accepts the send').toBe(202)
  const body = await readJsonSafe<{ messageId?: string; threadId?: string }>(response)
  expect(body?.messageId).toBeTruthy()
  return { messageId: body!.messageId as string, threadId: body!.threadId as string }
}

async function countInteractionsForLinks(linkIds: string[]): Promise<number> {
  if (linkIds.length === 0) return 0
  return withClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count from customer_interactions
        where external_message_id = any($1::uuid[]) and interaction_type = 'email' and deleted_at is null`,
      [linkIds],
    )
    return Number(result.rows[0]?.count ?? 0)
  })
}

test.describe('TC-CHANNEL-EMAIL-HUB-012: mailbox CC and CRM interactions', () => {
  useRaisedExternalEmailBudget()
  test('a joint send delivers CC, records it as a participant and on the CRM interaction', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const recipient = QA_RECIPIENTS[0]
    const copy = QA_COPY_RECIPIENT
    const subject = `HUB-012 joint ${stamp}`
    let token: string | null = null
    let channelId: string | null = null
    let personId: string | null = null

    try {
      token = await getAuthToken(request)
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled; cannot provision a connected channel.')

      channelId = await seedConnectedChannel(request, token, {
        displayName: `HUB-012 joint ${stamp}`,
        externalIdentifier: `hub-012-joint-${stamp}@example.com`,
      })
      personId = await createPersonFixture(request, token, {
        firstName: 'Joint',
        lastName: `Recipient ${stamp}`,
        displayName: `Joint Recipient ${stamp}`,
        primaryEmail: recipient,
      })

      const { messageId } = await sendAsUser(request, token, {
        userChannelId: channelId,
        to: [recipient],
        cc: [copy],
        subject,
        body: { plain: 'Joint send with a copy.' },
        channelMetadata: { crmPersonId: personId },
      })

      const inspected = await inspectMessageChannelLinks(request, token, messageId)
      expect(inspected.links, 'a joint send keeps one link').toHaveLength(1)
      const linkId = inspected.links[0].id

      await drainUntil(async () => (await countInteractionsForLinks([linkId])) === 1, 'the CRM interaction of the joint send')

      const captured = (await listCapturedSystemEmails(request, token)).filter((item) => item.metadata?.subject === subject)
      expect(captured).toHaveLength(1)
      expect(captured[0].metadata?.to).toEqual([recipient])
      expect(captured[0].metadata?.cc, 'the CC is delivered').toEqual([copy])

      const detailResponse = await apiRequest(request, 'GET', `/api/messages/${encodeURIComponent(messageId)}`, { token })
      const detail = await readJsonSafe<{ externalParticipants?: Array<{ role: string; email: string; deliveryStatus: string | null }> }>(detailResponse)
      expect(detail?.externalParticipants ?? []).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'to', email: recipient, deliveryStatus: 'sent' }),
        expect.objectContaining({ role: 'cc', email: copy, deliveryStatus: 'sent' }),
      ]))

      // The CRM email card reads its to/cc from this link snapshot. It is asserted on the
      // row because the interactions API response currently loses `_integrations.email`:
      // the `integrations.external-id-mapping` enricher ('*', lower priority) overwrites
      // `_integrations` with `{}` when a record has no external-id mappings.
      const linkMetadata = await withClient(async (client) => {
        const result = await client.query<{ channel_metadata: { to?: unknown; cc?: unknown; bcc?: unknown } | null }>(
          'select channel_metadata from message_channel_links where id = $1',
          [linkId],
        )
        return result.rows[0]?.channel_metadata ?? null
      })
      expect(linkMetadata?.to, 'the CRM link snapshot lists the recipient').toEqual([recipient])
      expect(linkMetadata?.cc, 'the CRM link snapshot lists the CC').toEqual([copy])
      expect(linkMetadata?.bcc, 'BCC is never written to the CRM link snapshot').toBeUndefined()
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteChannelIfExists(request, token, channelId)
    }
  })

  test('a separate send creates one CRM interaction per link and the thread view shows the message once', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const subject = `HUB-012 separate ${stamp}`
    let token: string | null = null
    let channelId: string | null = null
    let personId: string | null = null

    try {
      token = await getAuthToken(request)
      const seedingAvailable = await isChannelSeedingAvailable(request, token)
      test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled; cannot provision a connected channel.')

      channelId = await seedConnectedChannel(request, token, {
        displayName: `HUB-012 separate ${stamp}`,
        externalIdentifier: `hub-012-separate-${stamp}@example.com`,
      })
      personId = await createPersonFixture(request, token, {
        firstName: 'Separate',
        lastName: `Recipient ${stamp}`,
        displayName: `Separate Recipient ${stamp}`,
      })

      const { messageId } = await sendAsUser(request, token, {
        userChannelId: channelId,
        to: [QA_RECIPIENTS[1], QA_RECIPIENTS[2]],
        subject,
        body: { plain: 'Separate copies.' },
        sendSeparately: true,
        channelMetadata: { crmPersonId: personId },
      })

      const inspected = await inspectMessageChannelLinks(request, token, messageId)
      expect(inspected.links).toHaveLength(2)
      const linkIds = inspected.links.map((link) => link.id)

      await drainUntil(async () => (await countInteractionsForLinks(linkIds)) === 2, 'one CRM interaction per link')

      const threadsResponse = await apiRequest(
        request,
        'GET',
        `/api/customers/people/${encodeURIComponent(personId)}/email-threads`,
        { token },
      )
      expect(threadsResponse.ok()).toBeTruthy()
      const threads = await readJsonSafe<{ threads?: Array<{ messages?: Array<{ messageId?: string | null }> }> }>(threadsResponse)
      const shown = (threads?.threads ?? [])
        .flatMap((thread) => thread.messages ?? [])
        .filter((message) => message.messageId === messageId)
      expect(shown, 'the separately sent message appears once in the Person thread view').toHaveLength(1)
    } finally {
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
