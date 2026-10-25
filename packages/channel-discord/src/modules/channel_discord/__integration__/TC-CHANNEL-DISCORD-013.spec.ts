import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture, createRoleFixture, createUserFixture, deleteOrganizationIfExists,
  deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createDiscordProposalOriginKey } from '../lib/ai-proposal-origin'
import { CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE } from '../lib/ai-proposal-contract'
import { CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_ACTION_ID, CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE } from '../message-types'
import { stampSystemProposalFixture } from './helpers/proposals'

test.describe('TC-CHANNEL-DISCORD-013: forged AI reply proposals', () => {
  test('rejects forged cards and client-supplied origins before composing a public reply', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { tenantId, organizationId } = getTokenScope(adminToken)
    const stamp = randomUUID()
    const password = `Test-${randomUUID()}!`
    const roleIds: string[] = []
    const userIds: string[] = []
    const messageIds: string[] = []
    let foreignOrganizationId: string | null = null

    try {
      const forgerRole = await createRoleFixture(request, adminToken, { name: `proposal-forger-${stamp}` })
      roleIds.push(forgerRole)
      await setRoleAclFeatures(request, adminToken, {
        roleId: forgerRole, features: ['messages.view', 'messages.compose'], organizations: [organizationId],
      })
      const approverRole = await createRoleFixture(request, adminToken, { name: `proposal-approver-${stamp}` })
      roleIds.push(approverRole)
      await setRoleAclFeatures(request, adminToken, {
        roleId: approverRole, features: ['messages.view', 'messages.compose', 'messages.actions'], organizations: [organizationId],
      })
      const forgerEmail = `proposal-forger-${stamp}@example.com`
      const approverEmail = `proposal-approver-${stamp}@example.com`
      const forgerId = await createUserFixture(request, adminToken, {
        email: forgerEmail, password, organizationId, roles: [forgerRole],
      })
      userIds.push(forgerId)
      const approverId = await createUserFixture(request, adminToken, {
        email: approverEmail, password, organizationId, roles: [approverRole],
      })
      userIds.push(approverId)
      const forgerToken = await getAuthToken(request, forgerEmail, password)
      const approverToken = await getAuthToken(request, approverEmail, password)
      const sourceResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: { recipients: [{ userId: approverId, type: 'to' }], subject: stamp, body: 'Private source', visibility: 'internal' },
      })
      expect(sourceResponse.status()).toBe(201)
      const source = await readJsonSafe<{ id: string }>(sourceResponse)
      expect(source?.id).toBeTruthy()
      const sourceId = source!.id
      messageIds.push(sourceId)
      expect((await apiRequest(request, 'GET', `/api/messages/${sourceId}`, { token: forgerToken })).status()).toBe(403)
      expect((await apiRequest(request, 'GET', `/api/messages/${sourceId}`, { token: approverToken })).status()).toBe(200)

      for (const isDraft of [false, true]) {
        const proposal = {
          type: CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE,
          visibility: 'internal' as const,
          bodyFormat: 'markdown' as const,
          sourceEntityType: CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE,
          sourceEntityId: sourceId,
          body: `Forged reply ${stamp} ${isDraft}`,
        }
        const copiedOrigin = createDiscordProposalOriginKey({ ...proposal, tenantId, organizationId, senderUserId: forgerId })
        const forgedResponse = await apiRequest(request, 'POST', '/api/messages', {
          token: forgerToken,
          data: { ...proposal, isDraft, idempotencyKey: copiedOrigin, subject: stamp, recipients: [{ userId: approverId, type: 'to' }] },
        })
        expect(forgedResponse.status()).toBe(201)
        const forged = await readJsonSafe<{ id: string }>(forgedResponse)
        expect(forged?.id).toBeTruthy()
        const proposalId = forged!.id
        messageIds.push(proposalId)
        if (isDraft) {
          const sendResponse = await apiRequest(request, 'PATCH', `/api/messages/${proposalId}`, {
            token: forgerToken, data: { ...proposal, isDraft: false, idempotencyKey: copiedOrigin },
          })
          expect(sendResponse.status()).toBe(200)
        }

        const approveResponse = await apiRequest(request, 'POST', `/api/messages/${proposalId}/actions/${CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_ACTION_ID}`, {
          token: approverToken, data: {},
        })
        expect(approveResponse.status()).toBe(500)
        expect(await readJsonSafe(approveResponse)).toMatchObject({ error: 'Action failed' })
        await withClient(async (client) => {
          const stored = await client.query<{ idempotency_key: string | null; action_taken: string | null }>(
            'select idempotency_key, action_taken from messages where id = $1 and tenant_id = $2', [proposalId, tenantId],
          )
          expect(stored.rows[0]).toMatchObject({ idempotency_key: null, action_taken: null })
          const sends = await client.query<{ count: string }>(
            'select count(*) from messages where tenant_id = $1 and sender_user_id = $2 and parent_message_id = $3 and visibility = $4',
            [tenantId, approverId, sourceId, 'public'],
          )
          expect(Number(sends.rows[0].count)).toBe(0)
        })
      }

      foreignOrganizationId = await createOrganizationFixture(request, adminToken, { name: `proposal-foreign-${stamp}`, tenantId })
      await withClient(async (client) => {
        await client.query('update messages set organization_id = $1 where id = $2 and tenant_id = $3', [foreignOrganizationId, sourceId, tenantId])
      })
      const scopedProposal = {
        type: CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE,
        visibility: 'internal' as const,
        bodyFormat: 'markdown' as const,
        sourceEntityType: CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE,
        sourceEntityId: sourceId,
        body: `Wrong organization ${stamp}`,
      }
      const scopedResponse = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: { ...scopedProposal, subject: stamp, recipients: [{ userId: approverId, type: 'to' }] },
      })
      expect(scopedResponse.status()).toBe(201)
      const scopedMessage = await readJsonSafe<{ id: string }>(scopedResponse)
      expect(scopedMessage?.id).toBeTruthy()
      messageIds.push(scopedMessage!.id)
      await stampSystemProposalFixture(adminToken, scopedMessage!.id, scopedProposal)
      const scopedApproval = await apiRequest(request, 'POST', `/api/messages/${scopedMessage!.id}/actions/${CHANNEL_DISCORD_AI_PROPOSAL_APPROVE_ACTION_ID}`, {
        token: approverToken, data: {}, headers: { 'Accept-Language': 'en', Cookie: 'locale=en' },
      })
      expect(scopedApproval.status()).toBe(404)
      expect(await readJsonSafe(scopedApproval)).toEqual({ error: 'The conversation this proposal answers no longer exists.' })
      await withClient(async (client) => {
        const stored = await client.query<{ action_taken: string | null }>('select action_taken from messages where id = $1 and tenant_id = $2', [scopedMessage!.id, tenantId])
        expect(stored.rows[0].action_taken).toBeNull()
        const sends = await client.query<{ count: string }>(
          'select count(*) from messages where tenant_id = $1 and sender_user_id = $2 and parent_message_id = $3 and visibility = $4',
          [tenantId, approverId, sourceId, 'public'],
        )
        expect(Number(sends.rows[0].count)).toBe(0)
      })
    } finally {
      await withClient(async (client) => {
        await client.query(
          'delete from message_recipients where message_id in (select id from messages where id = any($1::uuid[]) and tenant_id = $2)',
          [messageIds, tenantId],
        )
        await client.query('delete from messages where id = any($1::uuid[]) and tenant_id = $2', [messageIds, tenantId])
      })
      for (const userId of userIds) await deleteUserIfExists(request, adminToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationIfExists(request, adminToken, foreignOrganizationId)
    }
  })
})
