import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import {
  clearCapturedSystemEmails,
  isChannelSeedingAvailable,
  listCapturedSystemEmails,
  seedSystemEmailChannel,
} from '@open-mercato/core/helpers/integration/communicationChannelsFixtures'
import { composeMessageWithToken, decodeJwtSubject, deleteMessageIfExists } from './helpers'

const DAILY_LIMIT_CONFIG = 'externalEmailDailyRecipientLimit'

test.describe('TC-MSG-EMAIL-003: External email budgets reject without delivery', () => {
  let token = ''
  let tenantId = ''
  let userId = ''
  let stamp = ''
  let startedAt = new Date(0)
  let createdMessageIds: string[] = []
  let recipientHashes: string[] = []
  let configInstalled = false

  test.beforeEach(async ({ request }) => {
    token = await getAuthToken(request, 'admin')
    const scope = getTokenScope(token)
    tenantId = scope.tenantId
    userId = decodeJwtSubject(token)
    stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    startedAt = new Date()
    createdMessageIds = []
    recipientHashes = []
    configInstalled = false
    const seedingAvailable = await isChannelSeedingAvailable(request, token)
    test.skip(!seedingAvailable, 'OM_ENABLE_TEST_CHANNEL_SEEDING is not enabled.')
    await seedSystemEmailChannel(request, token)
    await clearCapturedSystemEmails(request, token)
    await withClient(async (client) => {
      const current = await client.query<{ count: string }>(
        `select count(distinct recipient_hash)::text as count from message_external_recipient_days where tenant_id = $1`,
        [tenantId],
      )
      const dailyLimit = Number(current.rows[0]?.count ?? '0') + 1
      await client.query(
        `delete from module_configs where tenant_id = $1 and module_id = 'messages' and name = $2`,
        [tenantId, DAILY_LIMIT_CONFIG],
      )
      await client.query(
        `insert into module_configs (id, module_id, name, value_json, tenant_id, organization_id, created_at, updated_at)
         values ($1, 'messages', $2, $3::jsonb, $4, null, now(), now())`,
        [randomUUID(), DAILY_LIMIT_CONFIG, JSON.stringify(dailyLimit), tenantId],
      )
    })
    configInstalled = true
    const cachePurge = await apiRequest(request, 'POST', '/api/configs/cache', {
      token,
      data: { action: 'purgeAll' },
    })
    expect(cachePurge.status()).toBe(200)
  })

  test.afterEach(async ({ request }) => {
    if (!tenantId || !userId || !configInstalled) return
    for (const messageId of createdMessageIds) await deleteMessageIfExists(request, token, messageId)
    await withClient(async (client) => {
      await client.query(
        `delete from module_configs where tenant_id = $1 and module_id = 'messages' and name = $2`,
        [tenantId, DAILY_LIMIT_CONFIG],
      )
      if (recipientHashes.length > 0) {
        await client.query(
          `delete from message_external_recipient_days where tenant_id = $1 and recipient_hash = any($2::text[]) and created_at >= $3`,
          [tenantId, recipientHashes, startedAt],
        )
      }
      await client.query(
        `delete from message_external_email_windows where tenant_id = $1 and subject_id = $2 and created_at >= $3`,
        [tenantId, userId, startedAt],
      )
    })
    await drainIntegrationQueue('events')
    await drainIntegrationQueue('messages-email')
    await clearCapturedSystemEmails(request, token)
    await apiRequest(request, 'POST', '/api/configs/cache', {
      token,
      data: { action: 'purgeAll' },
    })
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
})
