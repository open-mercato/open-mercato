import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerInteraction } from '../data/entities'
import { buildEmailVisibilityMikroFilter } from './visibilityFilter'

/**
 * Read model that turns a Person's email `CustomerInteraction` rows into
 * Gmail-style threads for the CRM Person page.
 *
 * The Person↔email anchor lives only on `CustomerInteraction`
 * (`interactionType='email'`, `externalMessageId` → `MessageChannelLink.id`).
 * The thread grouping key and the rich per-message content (From/To/Cc, body,
 * direction) live in the communication_channels hub. We read the hub entities
 * by their string class names — the same cross-module pattern used by
 * `link-channel-message-handler.ts` — so the customers module never imports the
 * hub's entity classes (root AGENTS.md: no direct ORM relationships between
 * modules).
 */

export type EmailThreadDirection = 'inbound' | 'outbound'

export type PersonEmailMessage = {
  id: string
  /** Open Mercato `messages.message` id — used as `parentMessageId` when replying so the reply joins this thread. */
  messageId: string | null
  /** RFC2822 Message-ID of this email — used as `In-Reply-To` on a reply. */
  rfcMessageId: string | null
  /** RFC2822 References chain for this email. */
  references: string[]
  direction: EmailThreadDirection
  fromName: string | null
  fromEmail: string | null
  to: string[]
  cc: string[]
  subject: string | null
  bodyText: string | null
  sentAt: string
  providerKey: string | null
}

export type PersonEmailThread = {
  threadKey: string
  subject: string | null
  preview: string | null
  participants: string[]
  lastMessageAt: string
  messageCount: number
  providerKey: string | null
  lastDirection: EmailThreadDirection
  messages: PersonEmailMessage[]
}

export type BuildPersonEmailThreadsOptions = {
  personId: string
  tenantId: string
  organizationId: string | null
  viewerUserId: string | null
  userFeatures: string[] | null | undefined
  maxThreads?: number
  maxMessagesPerThread?: number
}

const DEFAULT_MAX_THREADS = 50
const DEFAULT_MAX_MESSAGES_PER_THREAD = 200
const PREVIEW_LENGTH = 140

type JsonRecord = Record<string, unknown>

/** Extracts `{ email, name }[]` from the many shapes a channel address field can take. */
function extractAddresses(value: unknown): Array<{ email: string; name: string | null }> {
  const out: Array<{ email: string; name: string | null }> = []
  const pushOne = (item: unknown): void => {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (trimmed) out.push({ email: trimmed, name: null })
      return
    }
    if (item && typeof item === 'object') {
      const rec = item as JsonRecord
      const address = typeof rec.address === 'string' ? rec.address.trim() : null
      const name = typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : null
      if (address) out.push({ email: address, name })
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) pushOne(item)
  } else {
    pushOne(value)
  }
  return out
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function toStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      if (strings.length > 0) return strings
    }
  }
  return []
}

function truncate(value: string | null): string | null {
  if (!value) return value
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= PREVIEW_LENGTH) return collapsed
  return `${collapsed.slice(0, PREVIEW_LENGTH - 1)}…`
}

/**
 * Builds the per-Person email-thread read model. Pure data assembly — callers
 * are responsible for auth and scoping (tenantId/organizationId required).
 */
export async function buildPersonEmailThreads(
  em: EntityManager,
  opts: BuildPersonEmailThreadsOptions,
): Promise<PersonEmailThread[]> {
  const {
    personId,
    tenantId,
    organizationId,
    viewerUserId,
    userFeatures,
    maxThreads = DEFAULT_MAX_THREADS,
    maxMessagesPerThread = DEFAULT_MAX_MESSAGES_PER_THREAD,
  } = opts

  // ── (1) Load the Person's email interactions (the Person↔email anchor) ──
  const interactionWhere: JsonRecord = {
    entity: personId,
    interactionType: 'email',
    deletedAt: null,
    tenantId,
  }
  if (organizationId) interactionWhere.organizationId = organizationId

  // Per-email visibility (v1: strict owner-only, no admin bypass) — the CRM
  // Person page applies the SAME rule as every other interactions read path via
  // `buildEmailVisibilityMikroFilter`, so the Emails tab and the `/interactions`
  // timeline can never disagree about who sees an email:
  //   - `visibility = 'shared'` is visible to every user with CRM access to this
  //     Person (lets a teammate pick up a handed-off thread),
  //   - `visibility = 'private'` is visible ONLY to its author (the mailbox
  //     owner) — never to teammates, not even an admin/superadmin (team
  //     oversight is a deliberate v2 follow-up),
  //   - legacy/unset rows (`visibility IS NULL`) stay visible so pre-existing
  //     CRM history is never silently hidden.
  // Fail-closed: a null viewer (API-key caller) never matches the author arm, so
  // it only ever sees shared/legacy rows — never anyone's private email.
  interactionWhere.$or = buildEmailVisibilityMikroFilter({
    currentUserId: viewerUserId,
    userFeatures,
  }).$or

  // `customer_interaction.title`/`body` are encrypted at rest, so reads go
  // through `findWithDecryption` even though we only consume non-encrypted
  // columns here — this keeps the encrypted-entity contract intact.
  const dscope = { tenantId, organizationId: organizationId ?? null }
  const interactions = (await findWithDecryption(
    em,
    CustomerInteraction,
    interactionWhere as never,
    { orderBy: { occurredAt: 'desc', createdAt: 'desc' }, limit: maxThreads * 20 },
    dscope,
  )) as CustomerInteraction[]

  const linkIdByInteraction = new Map<string, { occurredAt: Date }>()
  const linkIds: string[] = []
  for (const interaction of interactions) {
    const linkId = interaction.externalMessageId
    if (!linkId || linkIdByInteraction.has(linkId)) continue
    linkIdByInteraction.set(linkId, { occurredAt: interaction.occurredAt ?? interaction.createdAt })
    linkIds.push(linkId)
  }
  if (linkIds.length === 0) return []

  // ── (2) Resolve MessageChannelLink rows (rich content + direction) ──────
  const linkWhere: JsonRecord = { id: { $in: linkIds }, tenantId }
  if (organizationId) linkWhere.organizationId = organizationId
  const links = (await findWithDecryption(
    em,
    'MessageChannelLink' as never,
    linkWhere as never,
    undefined,
    dscope,
  )) as JsonRecord[]

  // ── (3) Resolve hub Message rows (the authoritative thread grouping) ────
  const messageIds = Array.from(
    new Set(
      links
        .map((link) => (typeof link.messageId === 'string' ? (link.messageId as string) : null))
        .filter((value): value is string => !!value),
    ),
  )
  const messageById = new Map<string, JsonRecord>()
  if (messageIds.length > 0) {
    const messageWhere: JsonRecord = { id: { $in: messageIds }, tenantId }
    if (organizationId) messageWhere.organizationId = organizationId
    const messages = (await findWithDecryption(
      em,
      'Message' as never,
      messageWhere as never,
      undefined,
      dscope,
    )) as JsonRecord[]
    for (const message of messages) {
      if (typeof message.id === 'string') messageById.set(message.id, message)
    }
  }

  // ── (4) Build per-message DTOs grouped by thread ────────────────────────
  const threadsByKey = new Map<string, PersonEmailThread>()

  for (const link of links) {
    const linkId = typeof link.id === 'string' ? (link.id as string) : null
    if (!linkId) continue
    const direction: EmailThreadDirection = link.direction === 'outbound' ? 'outbound' : 'inbound'
    const providerKey = typeof link.providerKey === 'string' ? (link.providerKey as string) : null
    const payload = (link.channelPayload ?? null) as JsonRecord | null
    const meta = (link.channelMetadata ?? null) as JsonRecord | null
    const messageId = typeof link.messageId === 'string' ? (link.messageId as string) : null
    const message = messageId ? messageById.get(messageId) ?? null : null

    // Outbound addresses live in channelMetadata; inbound in channelPayload.
    // Prefer the direction-appropriate source, fall back to the other.
    const primary = direction === 'outbound' ? meta : payload
    const secondary = direction === 'outbound' ? payload : meta
    const fromList = extractAddresses(primary?.from ?? secondary?.from)
    const toList = extractAddresses(primary?.to ?? secondary?.to)
    const ccList = extractAddresses(primary?.cc ?? secondary?.cc)

    const subject = firstString(
      primary?.subject,
      secondary?.subject,
      typeof message?.subject === 'string' ? message.subject : null,
    )
    const bodyText = firstString(
      direction === 'outbound' ? meta?.bodyText : payload?.text,
      direction === 'outbound' ? payload?.text : meta?.bodyText,
      typeof message?.body === 'string' ? message.body : null,
    )

    const sentAtRaw =
      (typeof message?.sentAt === 'string' || message?.sentAt instanceof Date
        ? message.sentAt
        : null) ??
      (link.createdAt instanceof Date || typeof link.createdAt === 'string' ? link.createdAt : null) ??
      linkIdByInteraction.get(linkId)?.occurredAt ??
      new Date()
    const sentAt = (sentAtRaw instanceof Date ? sentAtRaw : new Date(sentAtRaw)).toISOString()

    const threadKey =
      (typeof message?.threadId === 'string' && message.threadId ? message.threadId : null) ??
      (messageId ? `message:${messageId}` : `link:${linkId}`)

    const dto: PersonEmailMessage = {
      id: linkId,
      messageId,
      rfcMessageId: firstString(primary?.messageId, secondary?.messageId),
      references: toStringArray(primary?.references, secondary?.references),
      direction,
      fromName: fromList[0]?.name ?? null,
      fromEmail: fromList[0]?.email ?? null,
      to: toList.map((a) => a.email),
      cc: ccList.map((a) => a.email),
      subject,
      bodyText,
      sentAt,
      providerKey,
    }

    const existing = threadsByKey.get(threadKey)
    if (existing) {
      existing.messages.push(dto)
    } else {
      threadsByKey.set(threadKey, {
        threadKey,
        subject,
        preview: null,
        participants: [],
        lastMessageAt: sentAt,
        messageCount: 0,
        providerKey,
        lastDirection: direction,
        messages: [dto],
      })
    }
  }

  // ── (5) Finalize thread summaries ───────────────────────────────────────
  const threads: PersonEmailThread[] = []
  for (const thread of threadsByKey.values()) {
    thread.messages.sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    if (thread.messages.length > maxMessagesPerThread) {
      thread.messages = thread.messages.slice(thread.messages.length - maxMessagesPerThread)
    }
    const last = thread.messages[thread.messages.length - 1]
    const firstWithSubject = thread.messages.find((m) => m.subject)
    const participantSet = new Set<string>()
    for (const message of thread.messages) {
      // External counterpart = the "from" for inbound, the "to" for outbound.
      if (message.direction === 'inbound' && message.fromEmail) participantSet.add(message.fromEmail)
      if (message.direction === 'outbound') message.to.forEach((email) => participantSet.add(email))
    }
    thread.subject = firstWithSubject?.subject ?? thread.subject
    thread.preview = truncate(last?.bodyText ?? null)
    thread.participants = Array.from(participantSet)
    thread.lastMessageAt = last?.sentAt ?? thread.lastMessageAt
    thread.lastDirection = last?.direction ?? thread.lastDirection
    thread.providerKey = last?.providerKey ?? thread.providerKey
    thread.messageCount = thread.messages.length
    threads.push(thread)
  }

  threads.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
  return threads.slice(0, maxThreads)
}
