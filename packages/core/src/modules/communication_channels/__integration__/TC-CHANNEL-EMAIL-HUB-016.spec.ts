import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { expect, test } from '@playwright/test'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { getAuthToken } from '@open-mercato/core/helpers/integration/authFixtures'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  deleteChannelIfExists,
  inspectMessageChannelLinks,
  isChannelSeedingAvailable,
  seedConnectedChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  isSchedulingAvailable,
  makeScheduledMessageDue,
  readMessageScheduleRow,
  runScheduledRelease,
  scheduledAtInMinutes,
} from '@open-mercato/core/modules/messages/__integration__/scheduledSendFixtures'

/**
 * TC-CHANNEL-EMAIL-HUB-016 — "Send later" from the CRM email dialog.
 *
 * Scheduling through `POST /api/customers/people/{id}/emails` stores the message
 * as scheduled with no channel link. The release hands it to the mailbox with
 * the CRM context kept: the link carries `crmPersonId`, `crmVisibility` and the
 * CC (never the BCC), and the CRM interaction gets the chosen visibility.
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

async function readInteractionVisibilities(linkId: string): Promise<Array<string | null>> {
  return withClient(async (client) => {
    const result = await client.query<{ visibility: string | null }>(
      `select visibility from customer_interactions
        where external_message_id = $1::uuid and interaction_type = 'email' and deleted_at is null`,
      [linkId],
    )
    return result.rows.map((row) => row.visibility)
  })
}

test.describe('TC-CHANNEL-EMAIL-HUB-016: scheduled CRM email', () => {
  test('keeps CRM person, visibility and CC through the scheduled release', async ({ request }) => {
    test.slow()
    const stamp = Date.now()
    const recipient = `hub-016-${stamp}@example.com`
    const copy = `hub-016-copy-${stamp}@example.com`
    const hidden = `hub-016-hidden-${stamp}@example.com`
    const subject = `HUB-016 scheduled CRM ${stamp}`
    let token: string | null = null
    let channelId: string | null = null
    let personId: string | null = null
    let messageId: string | null = null

    try {
      token = await getAuthToken(request)
      test.skip(!(await isChannelSeedingAvailable(request, token)), 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
      test.skip(!(await isSchedulingAvailable(request, token)), 'scheduler module is not enabled')

      channelId = await seedConnectedChannel(request, token, {
        displayName: `HUB-016 ${stamp}`,
        externalIdentifier: `hub-016-sender-${stamp}@example.com`,
      })
      personId = await createPersonFixture(request, token, {
        firstName: 'Scheduled',
        lastName: `Recipient ${stamp}`,
        displayName: `Scheduled Recipient ${stamp}`,
        primaryEmail: recipient,
      })

      const scheduledAt = scheduledAtInMinutes(30)
      const sendResponse = await apiRequest(
        request,
        'POST',
        `/api/customers/people/${encodeURIComponent(personId)}/emails`,
        {
          token,
          data: {
            userChannelId: channelId,
            to: [recipient],
            cc: [copy],
            bcc: [hidden],
            subject,
            body: 'Scheduled from the CRM.',
            bodyFormat: 'text',
            visibility: 'shared',
            scheduledAt,
          },
        },
      )
      expect(sendResponse.status(), 'the CRM route accepts a scheduled send').toBe(200)
      const sendBody = await readJsonSafe<{ messageId?: string; scheduledAt?: string; queuedAt?: string }>(sendResponse)
      messageId = sendBody?.messageId ?? null
      expect(messageId).toBeTruthy()
      expect(sendBody?.scheduledAt).toBe(new Date(scheduledAt).toISOString())
      expect(sendBody?.queuedAt).toBeUndefined()

      expect(await readMessageScheduleRow(messageId as string)).toMatchObject({ status: 'scheduled', sender_channel_id: channelId })
      const before = await inspectMessageChannelLinks(request, token, messageId as string)
      expect(before.links, 'no channel link before release').toHaveLength(0)

      await makeScheduledMessageDue(messageId as string)
      await runScheduledRelease(token)

      await drainUntil(
        async () => {
          const { links } = await inspectMessageChannelLinks(request, token as string, messageId as string)
          return links.length > 0 && links.every((link) => link.deliveryStatus === 'sent')
        },
        'the released email to be delivered through the mailbox',
      )
      expect(await readMessageScheduleRow(messageId as string)).toMatchObject({ status: 'sent', is_draft: false })
      const after = await inspectMessageChannelLinks(request, token, messageId as string)
      expect(after.links, 'release creates one outbound link').toHaveLength(1)
      const linkId = after.links[0].id

      const linkMetadata = await withClient(async (client) => {
        const result = await client.query<{ channel_metadata: Record<string, unknown> | null }>(
          'select channel_metadata from message_channel_links where id = $1',
          [linkId],
        )
        return result.rows[0]?.channel_metadata ?? null
      })
      expect(linkMetadata).toMatchObject({ crmPersonId: personId, crmVisibility: 'shared', to: [recipient], cc: [copy] })
      expect(linkMetadata?.bcc, 'BCC is never written to the CRM link snapshot').toBeUndefined()

      await drainUntil(async () => (await readInteractionVisibilities(linkId)).length === 1, 'the CRM interaction of the released email')
      expect(await readInteractionVisibilities(linkId)).toEqual(['shared'])
    } finally {
      if (token && messageId) {
        await apiRequest(request, 'DELETE', `/api/messages/${encodeURIComponent(messageId)}`, { token }).catch(() => {})
      }
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      await deleteChannelIfExists(request, token, channelId)
    }
  })
})
