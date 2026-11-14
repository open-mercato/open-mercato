import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createRoleFixture, createUserFixture, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import enTranslations from '../i18n/en.json' with { type: 'json' }
import plTranslations from '../i18n/pl.json' with { type: 'json' }
import { CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE } from '../lib/ai-proposal-contract'
import { CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE } from '../message-types'
import { stampSystemProposalFixture } from './helpers/proposals'

async function createMessage(request: APIRequestContext, token: string, data: Record<string, unknown>): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/messages', {
    token,
    data: { visibility: 'internal', subject: 'Approval refusal regression', body: 'Proposed reply', ...data },
  })
  expect(response.status()).toBe(201)
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(typeof body?.id).toBe('string')
  return body!.id!
}

test('TC-CHANNEL-DISCORD-014: approval refusals preserve status, locale and released claims', async ({ request }) => {
  const adminToken = await getAuthToken(request, 'admin')
  const scope = getTokenScope(adminToken)
  const stamp = randomUUID()
  let roleId: string | null = null
  let operatorId: string | null = null
  const messageIds: string[] = []

  try {
    const roleName = `qa_discord_refusal_${stamp}`
    roleId = await createRoleFixture(request, adminToken, { name: roleName, tenantId: scope.tenantId })
    await setRoleAclFeatures(request, adminToken, {
      roleId, features: ['messages.view', 'messages.compose', 'messages.actions'], organizations: [scope.organizationId],
    })
    const email = `qa-discord-refusal-${stamp}@example.com`
    const password = `${randomUUID()}Aa1!`
    operatorId = await createUserFixture(request, adminToken, {
      email, password, organizationId: scope.organizationId, roles: [roleId], name: 'QA Discord Operator',
    })
    const operatorToken = await getAuthToken(request, email, password)
    const sourceId = await createMessage(request, adminToken, {
      recipients: [{ userId: scope.userId, type: 'to' }],
    })
    messageIds.push(sourceId)
    const sourceResponse = await apiRequest(request, 'GET', `/api/messages/${sourceId}`, { token: operatorToken })
    expect(sourceResponse.status()).toBe(403)

    for (const [sourceEntityId, expectedStatus, errorKey] of [
      [sourceId, 403, 'channel_discord.aiProposal.errors.sourceMessageUnreadable'],
      [randomUUID(), 404, 'channel_discord.aiProposal.errors.sourceMessageNotFound'],
    ] as const) {
      const proposalInput = {
        type: CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE,
        visibility: 'internal' as const,
        bodyFormat: 'markdown' as const,
        body: 'Proposed reply',
        sourceEntityType: CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE,
        sourceEntityId,
      }
      const proposalId = await createMessage(request, adminToken, {
        ...proposalInput, recipients: [{ userId: operatorId, type: 'to' }],
      })
      messageIds.push(proposalId)
      await stampSystemProposalFixture(adminToken, proposalId, proposalInput)

      for (const [locale, dictionary] of [['en', enTranslations], ['pl', plTranslations]] as const) {
        const response = await apiRequest(request, 'POST', `/api/messages/${proposalId}/actions/approve_send`, {
          token: operatorToken, data: {}, headers: { 'Accept-Language': locale, Cookie: `locale=${locale}` },
        })
        expect(response.status()).toBe(expectedStatus)
        expect(await readJsonSafe(response)).toEqual({ error: dictionary[errorKey] })
        const detailResponse = await apiRequest(request, 'GET', `/api/messages/${proposalId}`, { token: operatorToken })
        expect(detailResponse.ok()).toBeTruthy()
        expect(await readJsonSafe<Record<string, unknown>>(detailResponse)).toMatchObject({ actionTaken: null })
      }

      const dismissResponse = await apiRequest(request, 'POST', `/api/messages/${proposalId}/actions/dismiss`, {
        token: operatorToken, data: {},
      })
      expect(dismissResponse.status()).toBe(200)
      const afterDismiss = await apiRequest(request, 'POST', `/api/messages/${proposalId}/actions/approve_send`, {
        token: operatorToken, data: {},
      })
      expect(afterDismiss.status()).toBe(409)
    }

    await withClient(async (client) => {
      const sent = await client.query<{ count: string }>(
        'select count(*)::text as count from messages where parent_message_id = $1 and tenant_id = $2', [sourceId, scope.tenantId],
      )
      expect(Number(sent.rows[0].count)).toBe(0)
    })
  } finally {
    try {
      await withClient(async (client) => {
        const fixtures = await client.query<{ id: string }>(
          'select id from messages where tenant_id = $1 and (id = any($2::uuid[]) or sender_user_id = $3)', [scope.tenantId, messageIds, operatorId],
        )
        const cleanupIds = fixtures.rows.map((record) => record.id)
        await client.query('delete from message_recipients where message_id = any($1::uuid[])', [cleanupIds])
        await client.query('delete from messages where id = any($1::uuid[]) and tenant_id = $2', [cleanupIds, scope.tenantId])
      })
    } finally {
      if (operatorId) await deleteUserIfExists(request, adminToken, operatorId)
      if (roleId) await deleteRoleIfExists(request, adminToken, roleId)
    }
  }
})
