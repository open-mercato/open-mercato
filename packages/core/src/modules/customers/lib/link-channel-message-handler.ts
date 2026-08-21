import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity, CustomerInteraction } from '../data/entities'
import { findPeopleByAddresses, normalizeAddresses } from './findPeopleByAddresses'
import { emitCustomersEvent } from '../events'
import { INTERACTION_STATUS_COMPLETED } from './interactionStatus'

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
  // CustomerEntity and CustomerInteraction are organization-scoped. Without an
  // organization id, fail closed instead of linking tenant-wide by email/thread.
  if (!organizationId) return
  const dscope = { tenantId, organizationId }

  // em.fork() gives us an isolated identity map for this event.
  const em = (ctx.resolve('em') as EntityManager).fork()

  // ── (1) Load the MessageChannelLink row ───────────────────────────────
  //
  // The customers module MUST NOT import MessageChannelLink from the
  // communication_channels module (cross-module ORM boundary rule in AGENTS.md).
  // We use the entity class name as a string so MikroORM's identity map resolves
  // it at runtime — the generated entity registry includes the hub's entities.
  // Read through findOneWithDecryption so any encrypted columns on the hub
  // entity are transparently decrypted (per the Encryption section in AGENTS.md).
  const link = (await findOneWithDecryption(
    em,
    'MessageChannelLink' as any,
    { id: linkId, tenantId, organizationId } as any,
    undefined,
    dscope,
  )) as Record<string, unknown> | null

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
    const channel = (await findOneWithDecryption(
      em,
      'CommunicationChannel' as any,
      { id: payload.channelId, tenantId, organizationId } as any,
      undefined,
      dscope,
    )) as { userId?: string | null } | null
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

  // For inbound IMAP messages we ALWAYS read addresses from `channelPayload`,
  // not `channelMetadata`. The IMAP adapter stores raw provider headers in
  // `channelMetadata` (where `from` is a JSON-stringified string that's
  // useless for address matching), and the structured normalized addresses
  // in `channelPayload.from` / `.to` / `.cc` / `.bcc`. Reading metadata
  // first poisoned `rawAddresses` with stringified-JSON garbage so the
  // payload-fallback never ran.
  //
  // Priority: payloadJson (canonical normalized shape) → metaJson fallback
  // (for legacy/outbound providers that still write addresses there).
  if (payloadJson) {
    collectAddressField(rawAddresses, payloadJson.from)
    collectAddressField(rawAddresses, payloadJson.to)
    collectAddressField(rawAddresses, payloadJson.cc)
    collectAddressField(rawAddresses, payloadJson.bcc)
  }

  if (rawAddresses.length === 0 && metaJson) {
    collectAddressField(rawAddresses, metaJson.from)
    collectAddressField(rawAddresses, metaJson.to)
    collectAddressField(rawAddresses, metaJson.cc)
    collectAddressField(rawAddresses, metaJson.bcc)
  }

  const normalized = normalizeAddresses(rawAddresses as string[])

  // ── (4) Optional explicit crmPersonId hint ────────────────────────────
  //
  // The outbound compose route stores `crmPersonId` in channelMetadata so the
  // subscriber can link to the intended Person even if their address isn't in
  // the recipient list (e.g. typo in To: field).
  const crmPersonIdHint =
    typeof metaJson?.crmPersonId === 'string' ? (metaJson!.crmPersonId as string) : null

  // Defense-in-depth: the crmPersonId hint is written by the compose route
  // (which already verifies tenant ownership), but the subscriber MUST re-verify
  // the hinted Person belongs to THIS tenant before linking. Otherwise a stale or
  // forged hint could attach an interaction to a Person in another tenant.
  let crmPersonId: string | null = null
  if (crmPersonIdHint) {
    const hintedPerson = await findOneWithDecryption(
      em,
      CustomerEntity,
      { id: crmPersonIdHint, kind: 'person', tenantId, organizationId, deletedAt: null } as any,
      undefined,
      dscope,
    )
    if (hintedPerson) crmPersonId = crmPersonIdHint
  }

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
  const linkDirection =
    link.direction === 'inbound' || link.direction === 'outbound' ? link.direction : null
  const visibility: 'private' | 'shared' = resolveVisibility(metaJson, channelUserId, linkDirection)

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
  // ── Primary: inherit Person(s) from the hub's authoritative thread ──────
  //
  // The hub threads an inbound reply into the same `messages.message.thread_id`
  // as the outbound that started the conversation (via the thread token /
  // subject+participants matcher). That outbound is already linked to the CRM
  // Person (through the `crmPersonId` hint set by the compose route). So a reply
  // inherits the Person of any existing email interaction in the same thread.
  //
  // This is the dependable join where the alternatives are not:
  //   - Address matching (`findPeopleByAddresses`) filters the *encrypted*
  //     `primary_email` column by a plaintext value, which never matches when
  //     tenant data encryption is on (ciphertext != plaintext).
  //   - RFC Message-IDs are rewritten by some providers (e.g. Gmail) on send,
  //     so the legacy In-Reply-To/References inheritance below also misses.
  // The hub thread id survives both, so we resolve by it first.
  const inboundMessageId = typeof _link.messageId === 'string' ? _link.messageId : null
  if (inboundMessageId && organizationId) {
    const threadPersonRows = (await em.getConnection().execute(
      `SELECT DISTINCT ci.entity_id AS entity_id
       FROM messages inbound_m
       JOIN messages thread_m ON thread_m.thread_id = inbound_m.thread_id
       JOIN message_channel_links mcl ON mcl.message_id = thread_m.id
       JOIN customer_interactions ci ON ci.external_message_id = mcl.id
       WHERE inbound_m.id = ?
         AND inbound_m.tenant_id = ?
         AND inbound_m.organization_id = ?
         AND inbound_m.deleted_at IS NULL
         AND inbound_m.thread_id IS NOT NULL
         AND thread_m.tenant_id = ?
         AND thread_m.organization_id = ?
         AND thread_m.deleted_at IS NULL
         AND mcl.tenant_id = ?
         AND mcl.organization_id = ?
         AND ci.tenant_id = ?
         AND ci.organization_id = ?
         AND ci.interaction_type = 'email'
         AND ci.deleted_at IS NULL
         AND ci.entity_id IS NOT NULL
       LIMIT 200`,
      [
        inboundMessageId,
        tenantId,
        organizationId,
        tenantId,
        organizationId,
        tenantId,
        organizationId,
        tenantId,
        organizationId,
      ],
    )) as Array<{ entity_id: string }>
    const threadPersonIds = new Set<string>(
      threadPersonRows.map((row) => row.entity_id).filter((id): id is string => !!id),
    )
    if (threadPersonIds.size > 0) {
      const subject =
        typeof metaJson?.subject === 'string'
          ? (metaJson.subject as string)
          : typeof payloadJson?.subject === 'string'
            ? (payloadJson.subject as string)
            : null
      const bodyText =
        typeof payloadJson?.text === 'string'
          ? (payloadJson.text as string)
          : typeof metaJson?.bodyText === 'string'
            ? (metaJson.bodyText as string)
            : null
      const occurredAt = _link.createdAt instanceof Date ? (_link.createdAt as Date) : new Date()
      const providerKey = typeof _link.providerKey === 'string' ? (_link.providerKey as string) : null
      await persistInteractions(em, threadPersonIds, {
        linkId,
        tenantId,
        organizationId,
        interactionType: 'email',
        title: subject,
        body: bodyText,
        authorUserId: channelUserId,
        occurredAt,
        visibility: channelUserId ? 'private' : 'shared',
        channelProviderKey: providerKey,
      })
      return
    }
  }

  // ── Fallback: legacy In-Reply-To / References Message-ID inheritance ─────
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
  // Bounded lookup: narrow to the candidate Message-IDs directly in SQL instead
  // of loading every link in the tenant and filtering in JS (which does not scale
  // on a busy mailbox — this path runs for every inbound reply that didn't match a
  // Person by address). channel_metadata is NOT an encrypted column, so a
  // parameterized raw query is safe; we match both bracketed (`<id>`) and
  // unbracketed (`id`) Message-ID storage forms, capped to a sane page.
  const dscope = { tenantId, organizationId }
  const messageIdCandidates = Array.from(
    new Set(refIds.flatMap((ref) => [ref, `<${ref}>`])),
  )
  const placeholders = messageIdCandidates.map(() => '?').join(', ')
  const parentLinkRows = (await em.getConnection().execute(
    `SELECT id FROM message_channel_links
     WHERE tenant_id = ?
       AND organization_id = ?
       AND channel_metadata->>'messageId' IN (${placeholders})
     LIMIT 200`,
    [tenantId, organizationId, ...messageIdCandidates],
  )) as Array<{ id: string }>

  const matchedParentIds = parentLinkRows.map((parentLink) => parentLink.id)

  if (matchedParentIds.length === 0) return

  // Find existing email CustomerInteraction rows for those parent links.
  const parentInteractions = (await findWithDecryption(
    em,
    CustomerInteraction,
    {
      externalMessageId: { $in: matchedParentIds },
      tenantId,
      organizationId,
      interactionType: 'email',
      deletedAt: null,
    } as any,
    undefined,
    dscope,
  )) as Array<{ entity: { id: string } }>

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
    const interaction = rowEm.create(CustomerInteraction, {
      tenantId: data.tenantId,
      organizationId: data.organizationId,
      entity: entityRef,
      interactionType: data.interactionType,
      title: data.title,
      body: data.body,
      authorUserId: data.authorUserId,
      occurredAt: data.occurredAt,
      // Emails are logged AFTER they're sent/received — they are not
      // scheduled work. Without an explicit status the entity default
      // ('planned') combined with a past `occurredAt` makes the activity
      // timeline render the email as "overdue", which is the wrong UX.
      // The canonical terminal-success value is `INTERACTION_STATUS_COMPLETED`
      // ('done'); see `lib/interactionStatus.ts` for the open/terminal semantics.
      status: INTERACTION_STATUS_COMPLETED,
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
      // Duplicate (retried delivery) — already linked, skip the refresh signal.
      continue
    }
    // Live-refresh signal for the CRM Person page (clientBroadcast → SSE). The
    // interaction is already persisted, so a failed emit must not abort linking
    // or fail this persistent (retried) subscriber.
    try {
      await emitCustomersEvent('customers.email.linked', {
        personId,
        interactionId: interaction.id,
        tenantId: data.tenantId,
        organizationId: data.organizationId,
      })
    } catch {
      /* swallow — UI refresh signal is non-critical */
    }
  }
}

function resolveVisibility(
  metaJson: Record<string, unknown> | null,
  channelUserId: string | null,
  direction: 'inbound' | 'outbound' | null,
): 'private' | 'shared' {
  // The explicit `crmVisibility` override is written ONLY by the outbound compose
  // route. Inbound `channelMetadata` is provider-derived (and therefore attacker-
  // influenceable), so it MUST NOT be able to downgrade a user-owned channel's
  // inbound mail from private → shared. Honor the override on outbound only.
  if (direction === 'outbound') {
    if (metaJson?.crmVisibility === 'shared') return 'shared'
    if (metaJson?.crmVisibility === 'private') return 'private'
  }
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
