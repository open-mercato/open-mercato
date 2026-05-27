import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity, CustomerInteraction } from '../../data/entities'
import { findPeopleByAddresses, normalizeAddresses } from '../../lib/findPeopleByAddresses'

/**
 * Shared implementation for the link-channel-message subscribers.
 *
 * The auto-discovery scanner requires a single string `event` value on each
 * subscriber file. Because we must handle both `communication_channels.message.received`
 * AND `.sent`, we use TWO thin subscriber files (link-channel-message-received.ts
 * and link-channel-message-sent.ts) that both delegate here.
 */

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Payload emitted by `communication_channels.message.received` and
 * `communication_channels.message.sent`.
 *
 * The canonical field is `channelLinkId` (as emitted by the hub). The alias
 * `messageChannelLinkId` is kept for test stubs and legacy compatibility.
 */
type LinkChannelMessagePayload = {
  eventType?: string
  /** UUID of the MessageChannelLink row (canonical hub field name). */
  channelLinkId?: string
  /** Alias used in some older stubs / test payloads. Prefer channelLinkId. */
  messageChannelLinkId?: string
  channelId?: string | null
  tenantId?: string
  organizationId?: string | null
  providerKey?: string | null
  direction?: 'inbound' | 'outbound' | null
}

type SubscriberContext = {
  resolve: <T = unknown>(name: string) => T
}

// ── Constants ─────────────────────────────────────────────────────────────

const POSTGRES_UNIQUE_VIOLATION = '23505'

// ── Main handler ──────────────────────────────────────────────────────────

export default async function handler(
  payload: LinkChannelMessagePayload,
  ctx: SubscriberContext,
): Promise<void> {
  // Resolve the link ID from either field name.
  const linkId = payload?.channelLinkId ?? payload?.messageChannelLinkId
  if (typeof linkId !== 'string' || !linkId) return

  // Fail-closed when tenantId is missing — unscoped queries are unsafe.
  if (typeof payload.tenantId !== 'string' || !payload.tenantId) return

  const tenantId = payload.tenantId
  const organizationId = payload.organizationId ?? null
  const dscope = { tenantId, organizationId }

  // em.fork() gives us an isolated identity map for this event.
  const em = (ctx.resolve('em') as EntityManager).fork()

  // ── (1) Load the MessageChannelLink row ───────────────────────────────
  //
  // The customers module MUST NOT import MessageChannelLink from the
  // communication_channels module (cross-module ORM boundary rule in AGENTS.md).
  // We use the entity class name as a string so MikroORM's identity map resolves
  // it at runtime — the generated entity registry includes the hub's entities.
  const link = (await em.findOne('MessageChannelLink' as any, {
    id: linkId,
    tenantId,
  } as any)) as Record<string, unknown> | null

  if (!link) return

  const metaJson = (link.channelMetadata ?? null) as Record<string, unknown> | null
  const payloadJson = (link.channelPayload ?? null) as Record<string, unknown> | null

  // ── (2) Resolve the channel to get its owner userId ───────────────────
  //
  // The channel.userId is needed for two purposes:
  //   - authorUserId on the CustomerInteraction row
  //   - default visibility ('private' for user-scoped, 'shared' for tenant-scoped)
  //
  // We look up the channel only when channelId is provided in the event payload.
  let channelUserId: string | null = null
  if (typeof payload.channelId === 'string' && payload.channelId) {
    const channel = (await em.findOne('CommunicationChannel' as any, {
      id: payload.channelId,
      tenantId,
    } as any)) as { userId?: string | null } | null
    channelUserId = channel?.userId ?? null
  }

  // ── (3) Collect recipient addresses ───────────────────────────────────
  //
  // The channel metadata shape differs by provider and direction:
  //   - Outbound (Gmail): subject/to/cc/bcc/from are in channelMetadata
  //     (merged from GmailEmailNativeMetadata by deliver-outbound-message.ts)
  //   - Inbound (Gmail): from/to/cc/bcc/subject are in channelPayload
  //     (from NormalizedInboundMessage.channelPayload)
  //
  // We check channelMetadata first (works for outbound + any provider that
  // writes addresses there), then fall back to channelPayload for inbound.
  const rawAddresses: unknown[] = []

  // channelMetadata sources (outbound, some providers)
  if (metaJson) {
    collectAddressField(rawAddresses, metaJson.from)
    collectAddressField(rawAddresses, metaJson.to)
    collectAddressField(rawAddresses, metaJson.cc)
    collectAddressField(rawAddresses, metaJson.bcc)
  }

  // channelPayload fallback (inbound Gmail / IMAP — addresses stored as
  // { address, name } objects or arrays of objects)
  if (rawAddresses.length === 0 && payloadJson) {
    collectAddressField(rawAddresses, payloadJson.from)
    collectAddressField(rawAddresses, payloadJson.to)
    collectAddressField(rawAddresses, payloadJson.cc)
    collectAddressField(rawAddresses, payloadJson.bcc)
  }

  const normalized = normalizeAddresses(rawAddresses as string[])

  // ── (4) Optional explicit crmPersonId hint ────────────────────────────
  //
  // The outbound compose route stores `crmPersonId` in channelMetadata so the
  // subscriber can link to the intended Person even if their address isn't in
  // the recipient list (e.g. typo in To: field).
  const crmPersonId =
    typeof metaJson?.crmPersonId === 'string' ? (metaJson!.crmPersonId as string) : null

  // Early exit: no addresses AND no hint → nothing to link.
  if (normalized.length === 0 && !crmPersonId) {
    // Before giving up, try threading-inheritance (TC-CRM-EMAIL-005).
    await handleThreadingInheritance(em, link, linkId, tenantId, organizationId, channelUserId, metaJson, payloadJson)
    return
  }

  // ── (5) Resolve People by address ────────────────────────────────────
  const matched = await findPeopleByAddresses(em, normalized, tenantId, organizationId)
  const personIdSet = new Set<string>(matched.map((m) => m.id))
  if (crmPersonId) personIdSet.add(crmPersonId)

  if (personIdSet.size === 0) {
    // Try threading-inheritance before giving up.
    await handleThreadingInheritance(em, link, linkId, tenantId, organizationId, channelUserId, metaJson, payloadJson)
    return
  }

  // ── (6) Determine visibility ──────────────────────────────────────────
  //
  // Priority order:
  //   1. Explicit `crmVisibility` in channelMetadata (set by compose route)
  //   2. Channel owner: 'private' if user-scoped, 'shared' if tenant-scoped
  const visibility: 'private' | 'shared' = resolveVisibility(metaJson, channelUserId)

  // ── (7) Extract subject / body / timestamps ───────────────────────────
  const subject =
    typeof metaJson?.subject === 'string'
      ? (metaJson!.subject as string)
      : typeof payloadJson?.subject === 'string'
        ? (payloadJson!.subject as string)
        : null

  const bodyText =
    typeof metaJson?.bodyText === 'string'
      ? (metaJson!.bodyText as string)
      : typeof payloadJson?.text === 'string'
        ? (payloadJson!.text as string)
        : null

  const occurredAt = link.createdAt instanceof Date ? link.createdAt : new Date()
  const providerKey =
    typeof link.providerKey === 'string' ? (link.providerKey as string) : null

  // ── (8) INSERT one CustomerInteraction per matched Person ─────────────
  await persistInteractions(
    em,
    personIdSet,
    {
      linkId,
      tenantId,
      organizationId,
      interactionType: 'email',
      title: subject,
      body: bodyText,
      authorUserId: channelUserId,
      occurredAt,
      visibility,
      channelProviderKey: providerKey,
    },
  )
}

// ── Threading-inheritance fallback ────────────────────────────────────────

/**
 * When direct address matching finds 0 people AND crmPersonId is absent, look
 * up parent message references from channelMetadata (`inReplyTo` + `references`).
 *
 * For each reference (an RFC2822 Message-ID), find a prior MessageChannelLink
 * in this tenant whose `channelMetadata.messageId` matches. For each such
 * parent link, find any existing email CustomerInteraction rows where
 * `externalMessageId = parent.id` — and link THIS message to the same Persons.
 *
 * This enables TC-CRM-EMAIL-005: a reply from an unknown address is still
 * attached to alice's timeline because the original thread was.
 */
async function handleThreadingInheritance(
  em: EntityManager,
  _link: Record<string, unknown>,
  linkId: string,
  tenantId: string,
  organizationId: string | null,
  channelUserId: string | null,
  metaJson: Record<string, unknown> | null,
  payloadJson: Record<string, unknown> | null,
): Promise<void> {
  // Collect reference message-ids from inReplyTo + references
  const refIds: string[] = []
  const inReplyTo =
    typeof metaJson?.inReplyTo === 'string'
      ? stripBrackets(metaJson!.inReplyTo as string)
      : typeof payloadJson?.inReplyTo === 'string'
        ? stripBrackets(payloadJson!.inReplyTo as string)
        : null
  if (inReplyTo) refIds.push(inReplyTo)

  const refs =
    Array.isArray(metaJson?.references)
      ? (metaJson!.references as unknown[])
      : Array.isArray(payloadJson?.references)
        ? (payloadJson!.references as unknown[])
        : []
  for (const r of refs) {
    if (typeof r === 'string') {
      const stripped = stripBrackets(r)
      if (stripped && !refIds.includes(stripped)) refIds.push(stripped)
    }
  }

  if (refIds.length === 0) return

  // Find parent MessageChannelLinks whose channelMetadata.messageId is in refIds.
  // NOTE: We can't do a JSON path filter portably in MikroORM without raw SQL,
  // so we fetch candidates and filter in JS. In practice, refIds is 1-5 items.
  //
  // We use a string-name entity lookup here too to avoid cross-module imports.
  const parentLinks = (await em.find('MessageChannelLink' as any, {
    tenantId,
  } as any)) as Array<{ id: string; channelMetadata?: Record<string, unknown> | null }>

  const matchedParentIds = parentLinks
    .filter((pl) => {
      const plMessageId =
        typeof pl.channelMetadata?.messageId === 'string'
          ? stripBrackets(pl.channelMetadata!.messageId as string)
          : null
      return plMessageId && refIds.includes(plMessageId)
    })
    .map((pl) => pl.id)

  if (matchedParentIds.length === 0) return

  // Find existing email CustomerInteraction rows for those parent links.
  const parentInteractions = (await em.find(CustomerInteraction, {
    externalMessageId: { $in: matchedParentIds } as any,
    tenantId,
    interactionType: 'email',
    deletedAt: null,
  } as any)) as Array<{ entity: { id: string } }>

  const inheritedPersonIdSet = new Set<string>(
    parentInteractions.map((pi) => pi.entity?.id).filter(Boolean) as string[],
  )

  if (inheritedPersonIdSet.size === 0) return

  const visibility: 'private' | 'shared' = channelUserId ? 'private' : 'shared'
  const link = _link
  const inheritedMeta = (link.channelMetadata ?? null) as Record<string, unknown> | null
  const subject =
    typeof inheritedMeta?.subject === 'string' ? (inheritedMeta.subject as string) : null
  const occurredAt = link.createdAt instanceof Date ? (link.createdAt as Date) : new Date()
  const providerKey =
    typeof link.providerKey === 'string' ? (link.providerKey as string) : null

  await persistInteractions(
    em,
    inheritedPersonIdSet,
    {
      linkId,
      tenantId,
      organizationId,
      interactionType: 'email',
      title: subject,
      body: null,
      authorUserId: channelUserId,
      occurredAt,
      visibility,
      channelProviderKey: providerKey,
    },
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

interface InteractionData {
  linkId: string
  tenantId: string
  organizationId: string | null
  interactionType: string
  title: string | null
  body: string | null
  authorUserId: string | null
  occurredAt: Date
  visibility: 'private' | 'shared'
  channelProviderKey: string | null
}

async function persistInteractions(
  em: EntityManager,
  personIdSet: Set<string>,
  data: InteractionData,
): Promise<void> {
  for (const personId of personIdSet) {
    // Fork per row so a unique-violation on one row doesn't poison the identity
    // map for subsequent rows. The parent em's connection pool is reused.
    const rowEm = em.fork()
    // Use em.getReference so we satisfy the ManyToOne relation without a
    // redundant SELECT — MikroORM will flush the FK column directly.
    const entityRef = rowEm.getReference(CustomerEntity, personId)
    rowEm.create(CustomerInteraction, {
      tenantId: data.tenantId,
      organizationId: data.organizationId,
      entity: entityRef,
      interactionType: data.interactionType,
      title: data.title,
      body: data.body,
      authorUserId: data.authorUserId,
      occurredAt: data.occurredAt,
      externalMessageId: data.linkId,
      visibility: data.visibility,
      channelProviderKey: data.channelProviderKey,
    } as any)
    try {
      await rowEm.flush()
    } catch (err) {
      // Idempotency: swallow unique-violation on (entity_id, external_message_id).
      // The partial unique index `customer_interactions_email_dedupe_uq` guarantees
      // at-most-once semantics across retries.
      const code = (err as { code?: string }).code
      if (code !== POSTGRES_UNIQUE_VIOLATION) throw err
    }
  }
}

function resolveVisibility(
  metaJson: Record<string, unknown> | null,
  channelUserId: string | null,
): 'private' | 'shared' {
  // Explicit override from the compose route takes highest priority.
  if (metaJson?.crmVisibility === 'shared') return 'shared'
  if (metaJson?.crmVisibility === 'private') return 'private'
  // Tenant-scoped channels (no userId) → shared; user-scoped → private.
  return channelUserId ? 'private' : 'shared'
}

/**
 * Collect email address strings from a field that may be:
 *   - a plain string: 'alice@example.com'
 *   - an array of strings: ['alice@example.com', 'bob@example.com']
 *   - an object with an `address` property: { address: 'alice@example.com', name: 'Alice' }
 *   - an array of such objects
 */
function collectAddressField(out: unknown[], value: unknown): void {
  if (!value) return
  if (typeof value === 'string') {
    out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        out.push(item)
      } else if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).address === 'string') {
        out.push((item as Record<string, unknown>).address as string)
      }
    }
    return
  }
  if (typeof value === 'object' && typeof (value as Record<string, unknown>).address === 'string') {
    out.push((value as Record<string, unknown>).address as string)
  }
}

function stripBrackets(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}
