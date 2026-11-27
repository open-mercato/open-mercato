import type { EntityManager } from '@mikro-orm/postgresql'
import { sql, type ExpressionBuilder } from 'kysely'
import { hashForLookup, lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  Message,
  MessageExternalParticipant,
  type ExternalParticipantDeliveryStatus,
  type ExternalParticipantRole,
} from '../data/entities'
import { EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE } from './messageSourceEntityTypes'

export const EXTERNAL_PARTICIPANTS_BACKFILL_BATCH_SIZE = 500

type BackfillDatabase = {
  messages: {
    id: string
    tenant_id: string
    organization_id: string | null
    is_draft: boolean
    deleted_at: Date | null
    idempotency_key: string | null
    external_email: string | null
    source_entity_type: string | null
  }
  message_channel_links: {
    message_id: string
    tenant_id: string
    organization_id: string | null
    direction: string
    delivery_status: string
    channel_metadata: unknown
  }
  message_external_participants: {
    message_id: string
    tenant_id: string
    role: string
    email_hash: string
  }
}

export type BackfillLink = {
  deliveryStatus: string | null
  channelMetadata: unknown
}

export type BackfillMessage = {
  externalEmail: string | null
  externalEmailSentAt: Date | null
  externalEmailFailedAt: Date | null
}

export type BackfillParticipant = {
  role: ExternalParticipantRole
  email: string
  deliveryStatus: ExternalParticipantDeliveryStatus | null
}

const ROLES: ExternalParticipantRole[] = ['to', 'cc', 'bcc']

export function mapLinkDeliveryStatus(status: string | null): ExternalParticipantDeliveryStatus | null {
  if (status === 'sent' || status === 'delivered' || status === 'read') return 'sent'
  if (status === 'failed') return 'failed'
  return null
}

function readAddress(value: unknown): string | null {
  const raw = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && typeof (value as { address?: unknown }).address === 'string'
      ? (value as { address: string }).address
      : null
  if (!raw) return null
  const bracketed = raw.match(/<([^>]+)>/)
  const address = (bracketed ? bracketed[1] : raw).trim()
  return address.includes('@') ? address : null
}

/**
 * Mailbox sends keep their recipients in the outbound link metadata; system
 * sends only have `external_email`, whose status lives on the message itself.
 */
export function buildBackfillParticipants(message: BackfillMessage, links: BackfillLink[]): BackfillParticipant[] {
  const participants: BackfillParticipant[] = []
  const seen = new Set<string>()
  const push = (role: ExternalParticipantRole, email: string, deliveryStatus: ExternalParticipantDeliveryStatus | null) => {
    const key = `${role}:${email.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    participants.push({ role, email, deliveryStatus })
  }
  if (links.length > 0) {
    for (const link of links) {
      const metadata = link.channelMetadata && typeof link.channelMetadata === 'object'
        ? link.channelMetadata as Record<string, unknown>
        : {}
      const deliveryStatus = mapLinkDeliveryStatus(link.deliveryStatus)
      for (const role of ROLES) {
        const list = metadata[role]
        for (const entry of Array.isArray(list) ? list : [list]) {
          const email = readAddress(entry)
          if (email) push(role, email, deliveryStatus)
        }
      }
    }
    return participants
  }
  const email = message.externalEmail?.trim()
  if (!email) return participants
  const deliveryStatus = message.externalEmailSentAt ? 'sent' : message.externalEmailFailedAt ? 'failed' : null
  push('to', email, deliveryStatus)
  return participants
}

async function hasChannelLinksTable(em: EntityManager): Promise<boolean> {
  const rows = await em.getConnection().execute<Array<{ present: boolean }>>(
    `select to_regclass('message_channel_links') is not null as present`,
  )
  return Boolean(rows[0]?.present)
}

type BackfillScope = { tenantId: string; organizationId: string }

async function selectOutboundMessageIds(
  em: EntityManager,
  scope: BackfillScope,
  afterId: string | null,
  withLinks: boolean,
): Promise<string[]> {
  const db = em.getKysely<BackfillDatabase>()
  const linkExists = (eb: ExpressionBuilder<BackfillDatabase, 'messages'>, direction?: string) => {
    let link = eb.selectFrom('message_channel_links as l')
      .select(sql<number>`1`.as('one'))
      .whereRef('l.message_id', '=', 'messages.id')
      .where('l.tenant_id', '=', scope.tenantId)
    if (direction) link = link.where('l.direction', '=', direction)
    return eb.exists(link)
  }
  let query = db.selectFrom('messages')
    .select('messages.id')
    .where('messages.tenant_id', '=', scope.tenantId)
    .where('messages.organization_id', '=', scope.organizationId)
    .where('messages.is_draft', '=', false)
    .where('messages.deleted_at', 'is', null)
    .where((eb) => eb.or([
      eb('messages.idempotency_key', 'is', null),
      eb('messages.idempotency_key', 'not like', 'cc:%'),
    ]))
  if (afterId) query = query.where('messages.id', '>', afterId)
  const systemPathOnly = (eb: ExpressionBuilder<BackfillDatabase, 'messages'>) => eb.and([
    eb('messages.external_email', 'is not', null),
    eb('messages.source_entity_type', 'is distinct from', EXTERNAL_CONVERSATION_SOURCE_ENTITY_TYPE),
  ])
  query = withLinks
    ? query.where((eb) => eb.and([
        eb.not(linkExists(eb, 'inbound')),
        eb.or([
          linkExists(eb, 'outbound'),
          eb.and([eb.not(linkExists(eb)), systemPathOnly(eb)]),
        ]),
      ]))
    : query.where((eb) => systemPathOnly(eb))
  const rows = await query.orderBy('messages.id').limit(EXTERNAL_PARTICIPANTS_BACKFILL_BATCH_SIZE).execute()
  return rows.map((row) => row.id)
}

async function backfillBatch(
  em: EntityManager,
  scope: BackfillScope,
  messageIds: string[],
  withLinks: boolean,
): Promise<number> {
  const messages = await findWithDecryption(
    em,
    Message,
    { id: { $in: messageIds }, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  const db = em.getKysely<BackfillDatabase>()
  const linkRows = withLinks
    ? await db.selectFrom('message_channel_links')
        .select(['message_id', 'delivery_status', 'channel_metadata'])
        .where('tenant_id', '=', scope.tenantId)
        .where('organization_id', '=', scope.organizationId)
        .where('direction', '=', 'outbound')
        .where('message_id', 'in', messageIds)
        .execute()
    : []
  const existingRows = await db.selectFrom('message_external_participants')
    .select(['message_id', 'role', 'email_hash'])
    .where('tenant_id', '=', scope.tenantId)
    .where('message_id', 'in', messageIds)
    .execute()
  const existing = new Set(existingRows.map((row) => `${row.message_id}:${row.role}:${row.email_hash}`))

  let created = 0
  for (const message of messages) {
    const links = linkRows
      .filter((row) => row.message_id === message.id)
      .map((row) => ({ deliveryStatus: row.delivery_status, channelMetadata: row.channel_metadata }))
    const participants = buildBackfillParticipants(
      {
        externalEmail: message.externalEmail ?? null,
        externalEmailSentAt: message.externalEmailSentAt ?? null,
        externalEmailFailedAt: message.externalEmailFailedAt ?? null,
      },
      links,
    )
    for (const participant of participants) {
      const alreadyStored = lookupHashCandidates(participant.email)
        .some((hash) => existing.has(`${message.id}:${participant.role}:${hash}`))
      if (alreadyStored) continue
      em.persist(em.create(MessageExternalParticipant, {
        messageId: message.id,
        role: participant.role,
        email: participant.email,
        emailHash: hashForLookup(participant.email),
        deliveryStatus: participant.deliveryStatus,
        sentAt: participant.deliveryStatus === 'sent' ? message.externalEmailSentAt ?? message.sentAt ?? null : null,
        tenantId: message.tenantId,
        organizationId: message.organizationId ?? null,
      }))
      created += 1
    }
  }
  await em.flush()
  return created
}

/**
 * Creates participant rows for outbound messages sent before the relation
 * existed. Each batch commits on its own, so an interrupted run resumes where it
 * stopped; rows already present (any hash version) are skipped.
 */
export async function backfillExternalParticipants(
  baseEm: EntityManager,
  scope: BackfillScope,
): Promise<{ scanned: number; created: number }> {
  const withLinks = await hasChannelLinksTable(baseEm.fork())
  let afterId: string | null = null
  let scanned = 0
  let created = 0
  for (;;) {
    const em = baseEm.fork()
    const messageIds = await selectOutboundMessageIds(em, scope, afterId, withLinks)
    if (messageIds.length === 0) break
    created += await em.transactional((trx) => backfillBatch(trx, scope, messageIds, withLinks))
    scanned += messageIds.length
    afterId = messageIds[messageIds.length - 1]
    if (messageIds.length < EXTERNAL_PARTICIPANTS_BACKFILL_BATCH_SIZE) break
  }
  return { scanned, created }
}
