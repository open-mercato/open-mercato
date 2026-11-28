import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedSystemEmailChannel,
  seedConnectedChannel,
  deleteChannelIfExists,
  ingestInboundEmailMessage,
  purgeSeededInboundMessage,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { composeMessageWithToken, deleteMessageIfExists } from './helpers'
import { createEmailBudgetFixture, deleteEmailBudgetSystemChannel, readEmailBudgetLedger } from './emailBudgetFixture'

test.describe('TC-MSG-EMAIL-003: External email budgets reject without delivery', () => {
  let token = ''
  let tenantId = ''
  let stamp = ''
  let createdMessageIds: string[] = []
  let recipientHashes: string[] = []
  let fixture: Awaited<ReturnType<typeof createEmailBudgetFixture>> | null = null
  let systemChannelId: string | null = null

  test.beforeEach(async ({ request }) => {
    test.slow()
    fixture = null
    systemChannelId = null
    createdMessageIds = []
    recipientHashes = []
    fixture = await createEmailBudgetFixture(request)
    ;({ token, tenantId } = fixture)
    stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
    systemChannelId = await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)
    await fixture.setDailyLimit(1)
    await withClient(async (client) => {
      const previousDay = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      await client.query(
        `insert into message_external_recipient_days (id, tenant_id, utc_day, recipient_hash, created_at)
         values ($1, $2, $3, $4, now())`,
        [randomUUID(), tenantId, previousDay, hashForLookup(`qa-historical-${stamp}@example.test`, 'messages.external_recipient')],
      )
      const current = await client.query<{ count: number }>(
        `select count(*)::int as count from message_external_recipient_days where tenant_id = $1 and utc_day = $2`,
        [tenantId, new Date().toISOString().slice(0, 10)],
      )
      expect(current.rows).toEqual([{ count: 0 }])
    })
  })

  test.afterEach(async ({ request }) => {
    if (!fixture) return
    try {
      for (const messageId of createdMessageIds) await deleteMessageIfExists(request, token, messageId)
      await drainIntegrationQueue('events')
      await drainIntegrationQueue('messages-email')
      if (systemChannelId) await clearCapturedSystemEmails(request, token)
    } finally {
      try {
        await deleteEmailBudgetSystemChannel(request, token, systemChannelId)
      } finally {
        await fixture.cleanup()
      }
    }
  })

  test('cleans both pre-existing quota windows after repeated interrupted fixture use', async ({ request }) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const interruptedFixture = await createEmailBudgetFixture(request)
      const interrupted = new Error('[internal] Simulated interruption after quota admission')
      await expect((async () => {
        try {
          await withClient(async (client) => {
            for (const [scope, subjectId] of [['user', interruptedFixture.userId], ['tenant', interruptedFixture.tenantId]]) {
              await client.query(
                `insert into message_external_email_windows (id, scope, tenant_id, subject_id, window_start, count, created_at, updated_at)
                 values ($1, $2, $3, $4, 0, 7, now() - interval '1 day', now())`,
                [randomUUID(), scope, interruptedFixture.tenantId, subjectId],
              )
            }
            await client.query('update message_external_email_windows set count = count + 1 where tenant_id = $1', [interruptedFixture.tenantId])
            await client.query(
              `insert into message_external_recipient_days (id, tenant_id, utc_day, recipient_hash, created_at)
               values ($1, $2, $3, $4, now())`,
              [randomUUID(), interruptedFixture.tenantId, new Date().toISOString().slice(0, 10), `interrupted-${attempt}`],
            )
          })
          throw interrupted
        } finally {
          await interruptedFixture.cleanup()
        }
      })()).rejects.toBe(interrupted)
      await withClient(async (client) => {
        const remaining = await client.query<{ count: number }>(
          `select ((select count(*) from message_external_email_windows where tenant_id = $1)
            + (select count(*) from message_external_recipient_days where tenant_id = $1))::int as count`,
          [interruptedFixture.tenantId],
        )
        expect(remaining.rows).toEqual([{ count: 0 }])
      })
    }
  })

  test('rejects the second distinct compose recipient without creating a message or email', async ({ request }) => {
    const firstEmail = `qa-budget-first-${stamp}@example.test`
    const secondEmail = `qa-budget-second-${stamp}@example.test`
    recipientHashes = [firstEmail, secondEmail].map((email) => hashForLookup(email, 'messages.external_recipient'))

    createdMessageIds.push(await composeMessageWithToken(request, token, {
      visibility: 'public',
      externalEmail: firstEmail,
      recipients: [],
      subject: `QA budget first ${stamp}`,
      body: 'First recipient is allowed.',
      sendViaEmail: true,
    }))
    const rejected = await apiRequest(request, 'POST', '/api/messages', {
      token,
      data: {
        visibility: 'public',
        externalEmail: secondEmail,
        recipients: [],
        subject: `QA budget rejected ${stamp}`,
        body: 'Second recipient must not be delivered.',
        sendViaEmail: true,
      },
    })

    expect(rejected.status()).toBe(429)
    await withClient(async (client) => {
      const result = await client.query<{ count: string }>(
        `select count(*)::text as count from messages where tenant_id = $1 and subject = $2`,
        [tenantId, `QA budget rejected ${stamp}`],
      )
      expect(result.rows[0]?.count).toBe('0')
    })
    await drainIntegrationQueue('events')
    await drainIntegrationQueue('messages-email')
    const captured = await listCapturedSystemEmails(request, token)
    expect(captured.some((email) => email.metadata?.to === secondEmail)).toBe(false)
  })

  test('rejects an over-cap draft send without changing draft state or sending email', async ({ request }) => {
    const firstEmail = `qa-draft-budget-first-${stamp}@example.test`
    const secondEmail = `qa-draft-budget-second-${stamp}@example.test`
    recipientHashes = [firstEmail, secondEmail].map((email) => hashForLookup(email, 'messages.external_recipient'))

    const firstDraftId = await composeMessageWithToken(request, token, {
      visibility: 'public',
      externalEmail: firstEmail,
      recipients: [],
      subject: `QA draft budget first ${stamp}`,
      body: 'First draft is allowed.',
      isDraft: true,
      sendViaEmail: true,
    })
    createdMessageIds.push(firstDraftId)
    const firstSend = await apiRequest(request, 'PATCH', `/api/messages/${firstDraftId}`, {
      token,
      data: { isDraft: false },
    })
    expect(firstSend.status()).toBe(200)

    const secondDraftId = await composeMessageWithToken(request, token, {
      visibility: 'public',
      externalEmail: secondEmail,
      recipients: [],
      subject: `QA draft budget rejected ${stamp}`,
      body: 'Second draft must remain unsent.',
      isDraft: true,
      sendViaEmail: true,
    })
    createdMessageIds.push(secondDraftId)
    const rejected = await apiRequest(request, 'PATCH', `/api/messages/${secondDraftId}`, {
      token,
      data: { isDraft: false },
    })

    expect(rejected.status()).toBe(429)
    await withClient(async (client) => {
      const result = await client.query<{ is_draft: boolean }>(
        `select is_draft from messages where id = $1 and tenant_id = $2`,
        [secondDraftId, tenantId],
      )
      expect(result.rows[0]?.is_draft).toBe(true)
    })
    await drainIntegrationQueue('events')
    await drainIntegrationQueue('messages-email')
    const captured = await listCapturedSystemEmails(request, token)
    expect(captured.some((email) => email.metadata?.to === secondEmail)).toBe(false)
  })
  test('admits exactly one of two simultaneous sends at the tenant cap across organizations', async ({ request }) => {
    if (!fixture) throw new Error('[internal] Missing email budget fixture')
    const otherOrganizationId = await fixture.createOrganization()
    const otherSender = await fixture.createActor(otherOrganizationId)
    const denied = await fixture.createActor(fixture.organizationId, ['messages.view'])
    const actors = [fixture, otherSender] as const
    const acceptedIds: string[] = []
    let connectedChannelId: string | null = null
    let otherSystemChannelId: string | null = null

    const listFixtureMessages = () => withClient(async (client) => {
      const result = await client.query<{ id: string; sender_user_id: string }>(
        'select id, sender_user_id from messages where tenant_id = $1',
        [tenantId],
      )
      return result.rows
    })

    try {
      connectedChannelId = await seedConnectedChannel(request, token)
      otherSystemChannelId = await seedSystemEmailChannel(request, otherSender.token)
      const rejectedSend = (senderToken: string) => apiRequest(request, 'POST', '/api/communication_channels/send-as-user', {
        token: senderToken,
        data: {
          userChannelId: connectedChannelId,
          to: [`qa-denied-${stamp}@example.test`],
          subject: `QA denied email quota ${stamp}`,
          body: { plain: 'An inaccessible mailbox cannot reserve quota.' },
        },
      })

      await fixture.clearLedger()
      const [noPermission, wrongOrganization] = await Promise.all([
        rejectedSend(denied.token),
        rejectedSend(otherSender.token),
      ])
      expect(noPermission.status()).toBe(403)
      expect(wrongOrganization.status()).toBe(404)
      expect(await readEmailBudgetLedger(tenantId)).toEqual({ recipients: [], windows: [] })
      expect(await listFixtureMessages()).toEqual([])

      for (let round = 1; round <= 10; round += 1) {
        await fixture.clearLedger()
        const addresses = actors.map((_, index) => `qa-exact-cap-${stamp}-${round}-${index}@example.test`)
        const results = await Promise.all(actors.map((actor, index) => apiRequest(request, 'POST', '/api/messages', {
          token: actor.token,
          data: {
            visibility: 'public',
            externalEmail: addresses[index],
            recipients: [],
            subject: `QA concurrent email quota ${addresses[index]}`,
            body: 'One of the two concurrent sends is admitted.',
            sendViaEmail: true,
          },
        })))
        expect(results.map((result) => result.status()).sort(), `round ${round}`).toEqual([201, 429])
        const winner = results.findIndex((result) => result.status() === 201)
        const accepted = await readJsonSafe<{ id?: string }>(results[winner])
        acceptedIds.push(expectId(accepted?.id, 'Admitted concurrent message'))
        expect(Number(results[1 - winner].headers()['retry-after'])).toBeGreaterThan(0)
        expect(await readEmailBudgetLedger(tenantId)).toEqual({
          recipients: [{ recipient_hash: hashForLookup(addresses[winner], 'messages.external_recipient') }],
          windows: [
            { scope: 'tenant', subject_id: tenantId, count: 1 },
            { scope: 'user', subject_id: actors[winner].userId, count: 1 },
          ],
        })
      }
      expect((await listFixtureMessages()).map(({ id }) => id).sort()).toEqual(acceptedIds.sort())
    } finally {
      try {
        await drainIntegrationQueue('events')
        await drainIntegrationQueue('messages-email')
        if (otherSystemChannelId) await clearCapturedSystemEmails(request, otherSender.token)
      } finally {
        try {
          for (const message of await listFixtureMessages()) {
            const sender = actors.find((actor) => actor.userId === message.sender_user_id)
            await deleteMessageIfExists(request, sender?.token, message.id)
          }
        } finally {
          await deleteChannelIfExists(request, token, connectedChannelId)
          await deleteEmailBudgetSystemChannel(request, otherSender.token, otherSystemChannelId)
        }
      }
    }
  })

  test('counts case-insensitive repeat sends hourly and never refunds a deleted message', async ({ request }) => {
    const externalEmail = `qa-repeat-${stamp}@example.test`
    const payload = {
      visibility: 'public' as const,
      recipients: [],
      body: 'Daily accounting is per normalized recipient.',
      sendViaEmail: true,
    }
    const firstId = await composeMessageWithToken(request, token, {
      ...payload, externalEmail, subject: `QA quota repeat first ${stamp}`,
    })
    createdMessageIds.push(firstId)
    createdMessageIds.push(await composeMessageWithToken(request, token, {
      ...payload, externalEmail: externalEmail.toUpperCase(), subject: `QA quota repeat second ${stamp}`,
    }))
    const beforeDelete = await readEmailBudgetLedger(tenantId)
    expect(beforeDelete.recipients).toContainEqual({
      recipient_hash: hashForLookup(externalEmail, 'messages.external_recipient'),
    })
    expect(beforeDelete.recipients).toHaveLength(2)
    expect(beforeDelete.windows.reduce((totals, { scope, count }) => ({
      ...totals,
      [scope]: (totals[scope] ?? 0) + count,
    }), {} as Record<string, number>)).toEqual({ tenant: 2, user: 2 })

    const deleted = await apiRequest(request, 'DELETE', `/api/messages/${firstId}`, { token })
    expect(deleted.status()).toBe(200)
    expect(await readEmailBudgetLedger(tenantId)).toEqual(beforeDelete)

    const rejected = await apiRequest(request, 'POST', '/api/messages', {
      token,
      data: { ...payload, externalEmail: `another-${externalEmail}`, subject: `QA quota repeat denied ${stamp}` },
    })
    expect(rejected.status()).toBe(429)
    expect(await readEmailBudgetLedger(tenantId)).toEqual(beforeDelete)
  })

  for (const entrypoint of ['channel', 'customer'] as const) {
    test(`rejects an over-cap ${entrypoint} email before message and channel writes`, async ({ request }) => {
      const firstEmail = `qa-direct-budget-first-${stamp}@example.test`
      const secondEmail = `qa-direct-budget-second-${stamp}@example.test`
      const ccEmail = `qa-direct-budget-cc-${stamp}@example.test`
      const bccEmail = `qa-direct-budget-bcc-${stamp}@example.test`
      recipientHashes = [firstEmail, secondEmail, ccEmail, bccEmail]
        .map((email) => hashForLookup(email, 'messages.external_recipient'))
      let channelId: string | null = null
      let personId: string | null = null
      const subject = `QA direct budget rejected ${stamp}`
      try {
        channelId = await seedConnectedChannel(request, token, {
          displayName: `QA direct budget ${stamp}`,
          externalIdentifier: `qa-direct-budget-${stamp}@test-seed.local`,
        })
        if (entrypoint === 'customer') {
          personId = await createPersonFixture(request, token, {
            firstName: 'Budget', lastName: stamp, displayName: `Budget ${stamp}`,
          })
        }
        createdMessageIds.push(await composeMessageWithToken(request, token, {
          visibility: 'public', externalEmail: firstEmail, recipients: [],
          subject: `QA direct budget first ${stamp}`, body: 'Reserve the last available recipient.', sendViaEmail: true,
        }))
        const path = entrypoint === 'channel'
          ? '/api/communication_channels/send-as-user'
          : `/api/customers/people/${personId}/emails`
        const rejected = await apiRequest(request, 'POST', path, {
          token,
          data: {
            userChannelId: channelId, to: [secondEmail], cc: [ccEmail], bcc: [bccEmail], subject,
            body: entrypoint === 'channel' ? { plain: 'This send must be rejected.' } : 'This send must be rejected.',
          },
        })
        expect(rejected.status()).toBe(429)
        expect(Number(rejected.headers()['retry-after'])).toBeGreaterThan(0)
        await withClient(async (client) => {
          const messages = await client.query<{ count: string }>(
            `select count(*)::text as count from messages where tenant_id = $1 and subject = $2`,
            [tenantId, subject],
          )
          expect(messages.rows[0]?.count).toBe('0')
          const conversations = await client.query<{ count: string }>(
            `select count(*)::text as count from external_conversations where tenant_id = $1 and channel_id = $2`,
            [tenantId, channelId],
          )
          expect(conversations.rows[0]?.count).toBe('0')
          const recipients = await client.query<{ count: string }>(
            `select count(*)::text as count from message_external_recipient_days where tenant_id = $1 and recipient_hash = any($2::text[])`,
            [tenantId, recipientHashes.slice(1)],
          )
          expect(recipients.rows[0]?.count).toBe('0')
        })
      } finally {
        await deleteChannelIfExists(request, token, channelId)
        await deleteEntityIfExists(request, token, '/api/customers/people', personId)
      }
    })
  }

  for (const sendViaEmail of [false, undefined]) {
    test(`rejects an email-channel reply with sendViaEmail=${sendViaEmail} before outbound bridging`, async ({ request }) => {
      const firstEmail = `qa-reply-first-${stamp}@example.test`
      const senderEmail = `qa-reply-sender-${stamp}@example.test`
      recipientHashes = [firstEmail, senderEmail].map((email) => hashForLookup(email, 'messages.external_recipient'))
      let channelId: string | null = null
      let inbound: { messageId: string; conversationId: string; channelLinkId: string } | null = null
      try {
        channelId = await seedConnectedChannel(request, token, { externalIdentifier: `qa-reply-${stamp}@test-seed.local` })
        const seeded = await ingestInboundEmailMessage(request, token, {
          channelId, senderAddress: senderEmail, senderDisplayName: 'Quota sender', subject: `QA reply quota ${stamp}`,
          body: 'An inbound message never consumes outbound quota.', externalMessageId: `<qa-reply-${stamp}@example.test>`,
          externalConversationId: `qa-reply-${stamp}`,
        })
        expect(seeded.status).toBe('created')
        expect(seeded.messageId && seeded.conversationId && seeded.channelLinkId).toBeTruthy()
        inbound = { messageId: seeded.messageId!, conversationId: seeded.conversationId!, channelLinkId: seeded.channelLinkId! }
        createdMessageIds.push(await composeMessageWithToken(request, token, {
          visibility: 'public', externalEmail: firstEmail, recipients: [], subject: `QA reply admitted ${stamp}`,
          body: 'Consume the last recipient slot.', sendViaEmail: true,
        }))
        const before = await withClient(async (client) => (await client.query('select * from messages where id = $1', [inbound!.messageId])).rows[0])
        const rejected = await apiRequest(request, 'POST', `/api/messages/${inbound.messageId}/reply`, {
          token, data: { body: 'Must not queue a reply.', ...(sendViaEmail === undefined ? {} : { sendViaEmail }) },
        })
        expect(rejected.status()).toBe(429)
        expect(Number(rejected.headers()['retry-after'])).toBeGreaterThan(0)
        await drainIntegrationQueue('events')
        await drainIntegrationQueue('communication-channels-outbound')
        await withClient(async (client) => {
          expect((await client.query('select * from messages where id = $1', [inbound!.messageId])).rows[0]).toEqual(before)
          expect((await client.query('select count(*)::int as count from messages where parent_message_id = $1', [inbound!.messageId])).rows).toEqual([{ count: 0 }])
          expect((await client.query("select count(*)::int as count from message_channel_links where external_conversation_id = $1 and direction = 'outbound'", [inbound!.conversationId])).rows).toEqual([{ count: 0 }])
        })
      } finally {
        if (inbound && channelId) await purgeSeededInboundMessage(request, token, channelId, inbound)
        await deleteChannelIfExists(request, token, channelId)
      }
    })
  }

})
