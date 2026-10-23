import { createHash, randomUUID } from 'node:crypto'
import type { Message } from '@open-mercato/core/modules/messages/data/entities'

type ProposalOrigin = Pick<
  Message,
  'tenantId' | 'organizationId' | 'senderUserId' | 'sourceEntityType' | 'sourceEntityId'
  | 'visibility' | 'type' | 'bodyFormat' | 'body'
>

const ORIGIN_PREFIX = 'channel_discord:ai_reply_proposal:v1:'
const ORIGIN_PATTERN = /^channel_discord:ai_reply_proposal:v1:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):[0-9a-f]{64}$/

function buildOriginKey(proposal: ProposalOrigin, nonce: string): string {
  const digest = createHash('sha256').update(JSON.stringify([
    nonce,
    proposal.tenantId,
    proposal.organizationId ?? null,
    proposal.senderUserId,
    proposal.sourceEntityType ?? null,
    proposal.sourceEntityId ?? null,
    proposal.visibility ?? null,
    proposal.type,
    proposal.bodyFormat,
    proposal.body,
  ])).digest('hex')
  return `${ORIGIN_PREFIX}${nonce}:${digest}`
}

export function createDiscordProposalOriginKey(proposal: ProposalOrigin): string {
  return buildOriginKey(proposal, randomUUID())
}

export function hasDiscordProposalOrigin(
  proposal: ProposalOrigin & Pick<Message, 'idempotencyKey' | 'actionData'>,
): boolean {
  if (proposal.actionData != null || typeof proposal.idempotencyKey !== 'string') return false
  const nonce = ORIGIN_PATTERN.exec(proposal.idempotencyKey)?.[1]
  return !!nonce && proposal.idempotencyKey === buildOriginKey(proposal, nonce)
}
