import { composeMessageSchema, updateDraftSchema } from '@open-mercato/core/modules/messages/data/validators'
import { createDiscordProposalOriginKey, hasDiscordProposalOrigin } from '../ai-proposal-origin'
import { CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE } from '../../message-types'
import { CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE } from '../ai-proposal-contract'

const proposal = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  senderUserId: '00000000-0000-0000-0000-000000000000',
  type: CHANNEL_DISCORD_AI_PROPOSAL_MESSAGE_TYPE,
  sourceEntityType: CHANNEL_DISCORD_AI_PROPOSAL_SOURCE_ENTITY_TYPE,
  sourceEntityId: '33333333-3333-4333-8333-333333333333',
  visibility: 'internal' as const,
  bodyFormat: 'markdown' as const,
  body: 'The proposed reply.',
}

describe('Discord proposal system origin', () => {
  it('verifies server-filed proposals without depending on the current bot account', () => {
    for (const senderUserId of [proposal.senderUserId, '44444444-4444-4444-8444-444444444444']) {
      const message = { ...proposal, senderUserId }
      expect(hasDiscordProposalOrigin({ ...message, idempotencyKey: createDiscordProposalOriginKey(message) })).toBe(true)
    }
  })

  it('keeps identical proposals independent rather than deduplicating subsequent reviews', () => {
    const firstKey = createDiscordProposalOriginKey(proposal)
    const secondKey = createDiscordProposalOriginKey(proposal)
    expect(firstKey).not.toBe(secondKey)
    expect(firstKey.length).toBeLessThanOrEqual(255)
  })

  it.each([
    { tenantId: '55555555-5555-4555-8555-555555555555' },
    { organizationId: null },
    { senderUserId: '44444444-4444-4444-8444-444444444444' },
    { type: 'default' },
    { sourceEntityType: 'other.record' },
    { sourceEntityId: '55555555-5555-4555-8555-555555555555' },
    { visibility: 'public' as const },
    { bodyFormat: 'text' as const },
    { body: 'Changed reply' },
    { actionData: { actions: [] } },
  ])('refuses changed proposal data: %j', (overrides) => {
    const idempotencyKey = createDiscordProposalOriginKey(proposal)
    expect(hasDiscordProposalOrigin({ ...proposal, idempotencyKey, ...overrides })).toBe(false)
  })

  it.each([undefined, null, '', 'cc:channel:external-message', 'channel_discord:ai_reply_proposal:v1:invalid'])('refuses absent or malformed origin: %s', (idempotencyKey) => {
    expect(hasDiscordProposalOrigin({ ...proposal, idempotencyKey })).toBe(false)
  })

  it('strips even a copied valid origin from both public write schemas', () => {
    const idempotencyKey = createDiscordProposalOriginKey(proposal)
    const input = {
      ...proposal,
      idempotencyKey,
      subject: 'Proposed reply',
      recipients: [{ userId: '44444444-4444-4444-8444-444444444444', type: 'to' }],
    }

    expect(composeMessageSchema.parse(input)).not.toHaveProperty('idempotencyKey')
    expect(updateDraftSchema.parse({ ...input, id: proposal.sourceEntityId })).not.toHaveProperty('idempotencyKey')
  })
})
