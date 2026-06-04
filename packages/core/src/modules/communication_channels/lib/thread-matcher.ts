import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChannelThreadMapping, ChannelThreadToken, MessageChannelLink } from '../data/entities'
import { extractTokenFromBody, extractTokenFromHeaders } from './thread-token'

/**
 * Layered thread-matching for inbound messages. Five ordered strategies;
 * first hit wins.
 *
 *   1. Token in References / In-Reply-To headers  (high confidence)
 *   2. Token in body                              (high confidence)
 *   3. JWZ on Message-Id                          (medium confidence)
 *   4. Subject + participants (last 30 days)      (low confidence)
 *   5. None → caller creates a new thread
 *
 * All DB queries are tenant-scoped. The matcher returns the resolved
 * thread id (or null) and lets the caller perform the actual ingest. It
 * never flushes the caller's unit of work: the only write is a scoped raw
 * `UPDATE` that bumps a matched token's `last_seen_at` (a future-GC hint),
 * which does not touch the caller's pending entities.
 *
 * See `.ai/specs/2026-05-27-email-integration-inbound-reliability-and-threading.md`
 * § 4 Threading Algorithm.
 */

export type ThreadMatchInput = {
  channelId: string
  tenantId: string
  organizationId: string | null

  /** RFC 5322 Message-ID of this inbound message (no angle brackets). */
  messageId: string | null
  /** In-Reply-To header value (no angle brackets). */
  inReplyTo: string | null
  /** References header, ordered root → most recent. */
  references: string[]

  /** Already-normalized subject is preferred; we re-normalize defensively. */
  subject: string
  fromAddress: string
  toAddresses: string[]
  ccAddresses: string[]

  bodyPlain: string | null
  bodyHtml: string | null

  receivedAt: Date
}

export type ThreadMatchStrategy =
  | 'token-references'
  | 'token-body'
  | 'jwz-headers'
  | 'subject-participants'

export type ThreadMatchConfidence = 'high' | 'medium' | 'low'

export type ThreadMatch = {
  messageThreadId: string
  matchedBy: ThreadMatchStrategy
  confidence: ThreadMatchConfidence
}

export type ThreadMatcherDeps = {
  em: EntityManager
  /** Stable reference for testing — defaults to `new Date()`. */
  now?: () => Date
}

const SUBJECT_PREFIX_PATTERN = /^\s*((?:re|fwd|fw|aw|wg|sv|tr|antw)\s*[:\-]\s*|\[[^\]]+\]\s*)+/i
const PARTICIPANT_LOOKBACK_DAYS = 30
const MAX_REFERENCES_TO_SCAN = 40

/**
 * Normalize a subject for low-confidence subject+participants matching:
 *   - Trim whitespace
 *   - Strip leading reply/forward prefixes (`Re:`, `RE:`, `Aw:`, `Fwd:`, `Tr:`, `WG:`, `Sv:`, etc.)
 *   - Strip leading bracketed tags (`[EXTERNAL]`, `[Encrypted]`, `[SPAM?]`, …)
 *   - Repeat until the pattern no longer matches
 *   - Lowercase the result
 *
 * Returns an empty string for `null`/empty input — the caller should
 * skip the subject+participants strategy in that case.
 */
export function normalizeSubject(subject: string | null | undefined): string {
  if (typeof subject !== 'string') return ''
  let current = subject.trim()
  // Loop until no prefix matches — handles `Re: Fwd: [EXTERNAL] Re: …`.
  let safety = 16
  while (safety > 0 && SUBJECT_PREFIX_PATTERN.test(current)) {
    current = current.replace(SUBJECT_PREFIX_PATTERN, '').trim()
    safety -= 1
  }
  return current.toLowerCase()
}

export async function matchThread(
  input: ThreadMatchInput,
  deps: ThreadMatcherDeps,
): Promise<ThreadMatch | null> {
  const { em, now } = deps
  const tenantId = input.tenantId
  const dscope = { tenantId, organizationId: input.organizationId }

  // Strategy 1: token in References / In-Reply-To header.
  const headerToken = extractTokenFromHeaders(input.inReplyTo, input.references)
  if (headerToken) {
    const threadId = await resolveTokenThread(em, dscope, {
      tenantId,
      channelId: input.channelId,
      token: headerToken,
      now,
    })
    if (threadId) {
      return {
        messageThreadId: threadId,
        matchedBy: 'token-references',
        confidence: 'high',
      }
    }
  }

  // Strategy 2: token in body.
  const bodyToken = extractTokenFromBody(input.bodyHtml, input.bodyPlain)
  if (bodyToken) {
    const threadId = await resolveTokenThread(em, dscope, {
      tenantId,
      channelId: input.channelId,
      token: bodyToken,
      now,
    })
    if (threadId) {
      return {
        messageThreadId: threadId,
        matchedBy: 'token-body',
        confidence: 'high',
      }
    }
  }

  // Strategy 3: JWZ — find any MessageChannelLink in this channel whose
  // recorded `channelMetadata.messageId` matches In-Reply-To or any of the
  // References values. The first hit's `messages.message.threadId` is our
  // thread. Bounded by MAX_REFERENCES_TO_SCAN.
  const candidates = collectReferenceCandidates(input.inReplyTo, input.references)
  if (candidates.length > 0) {
    const jwzMatch = await findThreadByMessageIds(em, {
      tenantId,
      organizationId: input.organizationId,
      channelId: input.channelId,
      messageIds: candidates,
    })
    if (jwzMatch) {
      return {
        messageThreadId: jwzMatch,
        matchedBy: 'jwz-headers',
        confidence: 'medium',
      }
    }
  }

  // Strategy 4: subject + participants in the same channel within 30 days.
  // Low confidence — never used to overwrite a stronger token-based match
  // (we already returned above on hits). The caller may still choose to
  // create a new thread when confidence === 'low'.
  const normalizedSubject = normalizeSubject(input.subject)
  if (normalizedSubject.length > 0) {
    const cutoff = subtractDays((now ?? (() => new Date()))(), PARTICIPANT_LOOKBACK_DAYS)
    const participants = collectParticipants(input)
    if (participants.length > 0) {
      const subjectMatch = await findThreadBySubjectParticipants(em, {
        tenantId,
        organizationId: input.organizationId,
        channelId: input.channelId,
        normalizedSubject,
        participants,
        cutoff,
      })
      if (subjectMatch) {
        return {
          messageThreadId: subjectMatch,
          matchedBy: 'subject-participants',
          confidence: 'low',
        }
      }
    }
  }

  // No match — caller creates a new thread.
  return null
}

/**
 * Resolve a thread token to its `messageThreadId`, but ONLY when that thread
 * belongs to the channel that received the inbound message.
 *
 * The token is unguessable + HMAC-signed + tenant-scoped, so it cannot leak
 * across tenants. Within a tenant, though, the same external contact may
 * correspond with several users/channels — and a thread token that ends up in
 * a *different* mailbox (e.g. a forwarded thread) must not graft the inbound
 * message onto another channel's thread. The `ChannelThreadMapping`
 * (thread ↔ channel) is the authoritative link; if there's no mapping joining
 * this thread to the receiving channel, we treat the token as a non-match and
 * let the lower-confidence strategies (or a fresh thread) take over.
 *
 * Returns the thread id on a verified hit (and bumps `last_seen_at`), else null.
 */
async function resolveTokenThread(
  em: EntityManager,
  dscope: { tenantId: string; organizationId: string | null },
  args: { tenantId: string; channelId: string; token: string; now?: () => Date },
): Promise<string | null> {
  const row = await findOneWithDecryption(
    em,
    ChannelThreadToken,
    {
      tenantId: args.tenantId,
      organizationId: dscope.organizationId,
      token: args.token,
    },
    undefined,
    dscope,
  )
  if (!row) return null

  const mapping = await findOneWithDecryption(
    em,
    ChannelThreadMapping,
    {
      tenantId: args.tenantId,
      organizationId: dscope.organizationId,
      messageThreadId: row.messageThreadId,
      channelId: args.channelId,
    },
    undefined,
    dscope,
  )
  if (!mapping) return null

  // Bump `last_seen_at` (future-GC hint) via a scoped raw UPDATE rather than
  // `em.flush()`. A flush here would commit the ENTIRE unit of work, including
  // any pending mutations the caller (`ingest-inbound-message`, shared by all
  // provider adapters) holds — turning this "pure" matcher into a hidden commit
  // boundary. The raw UPDATE keeps the matcher side-effect-free w.r.t. the
  // caller's EntityManager.
  await em.getConnection().execute(
    `UPDATE channel_thread_tokens
        SET last_seen_at = ?
      WHERE id = ?
        AND tenant_id = ?
        AND ((?::uuid IS NULL AND organization_id IS NULL) OR organization_id = ?::uuid)`,
    [
      (args.now ?? (() => new Date()))(),
      row.id,
      args.tenantId,
      dscope.organizationId,
      dscope.organizationId,
    ],
  )
  return row.messageThreadId
}

function collectReferenceCandidates(
  inReplyTo: string | null,
  references: string[] | undefined,
): string[] {
  const out: string[] = []
  const push = (value: string | null | undefined): void => {
    if (typeof value !== 'string') return
    const stripped = value.replace(/^<|>$/g, '').trim()
    if (stripped.length > 0) out.push(stripped)
  }
  push(inReplyTo)
  if (Array.isArray(references)) {
    for (const ref of references) push(ref)
  }
  return Array.from(new Set(out)).slice(0, MAX_REFERENCES_TO_SCAN)
}

async function findThreadByMessageIds(
  em: EntityManager,
  args: { tenantId: string; organizationId: string | null; channelId: string; messageIds: string[] },
): Promise<string | null> {
  if (args.messageIds.length === 0) return null
  // MikroORM v7 dropped the Knex builder; we use raw SQL via
  // `em.getConnection().execute()` with positional placeholders. The JSONB
  // lookup compares `channel_metadata->>'messageId'` against a Postgres
  // text array built from the candidate message-ids.
  // Escape backslash BEFORE quote — a Message-ID can legitimately contain `\`
  // (RFC 5322), and an unescaped backslash yields a malformed Postgres array
  // literal that throws and silently defeats threading.
  const idArray = `{${args.messageIds
    .map((id) => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')}}`
  const rows = await em.getConnection().execute<Array<{ message_id: string }>>(
    `SELECT link.message_id FROM message_channel_links AS link
       INNER JOIN external_conversations AS conv
         ON conv.id = link.external_conversation_id
      WHERE link.tenant_id = ?
        AND ((?::uuid IS NULL AND link.organization_id IS NULL) OR link.organization_id = ?::uuid)
        AND conv.tenant_id = ?
        AND ((?::uuid IS NULL AND conv.organization_id IS NULL) OR conv.organization_id = ?::uuid)
        AND conv.channel_id = ?
        AND link.channel_metadata->>'messageId' = ANY(?::text[])
      LIMIT 1`,
    [
      args.tenantId,
      args.organizationId,
      args.organizationId,
      args.tenantId,
      args.organizationId,
      args.organizationId,
      args.channelId,
      idArray,
    ],
  )
  if (!rows || rows.length === 0) return null

  const messageId = rows[0].message_id as string
  // Translate `messages.message.id` to `messages.message.thread_id`. We
  // intentionally avoid importing the messages entity (cross-module rule).
  const threadRows = await em.getConnection().execute<Array<{ thread_id: string | null }>>(
    `SELECT thread_id FROM messages
      WHERE id = ?
        AND tenant_id = ?
        AND ((?::uuid IS NULL AND organization_id IS NULL) OR organization_id = ?::uuid)
        AND deleted_at IS NULL
      LIMIT 1`,
    [messageId, args.tenantId, args.organizationId, args.organizationId],
  )
  if (!threadRows || threadRows.length === 0) return null
  return threadRows[0].thread_id as string | null
}

function collectParticipants(input: ThreadMatchInput): string[] {
  const set = new Set<string>()
  const push = (value: string | null | undefined): void => {
    if (typeof value !== 'string') return
    const cleaned = value.trim().toLowerCase()
    if (cleaned.length > 0) set.add(cleaned)
  }
  push(input.fromAddress)
  for (const addr of input.toAddresses) push(addr)
  for (const addr of input.ccAddresses) push(addr)
  return Array.from(set)
}

async function findThreadBySubjectParticipants(
  em: EntityManager,
  args: {
    tenantId: string
    organizationId: string | null
    channelId: string
    normalizedSubject: string
    participants: string[]
    cutoff: Date
  },
): Promise<string | null> {
  // MikroORM v7 raw SQL — see `findThreadByMessageIds` for the rationale.
  // We look at recent links from this channel whose channelMetadata subject
  // (server-side normalized) equals the inbound subject AND share at least
  // one participant. The first match wins.
  const subjectLowerLike = args.normalizedSubject
  // Escape backslash before quote (see findThreadByMessageIds) — participant
  // addresses are attacker-influenced inbound header values.
  const participantList = `{${args.participants
    .map((p) => `"${p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')}}`
  const rows = await em.getConnection().execute<Array<{ thread_id: string | null }>>(
    `SELECT messages.thread_id
       FROM message_channel_links AS link
       INNER JOIN external_conversations AS conv
         ON conv.id = link.external_conversation_id
       INNER JOIN messages
         ON messages.id = link.message_id
         AND messages.tenant_id = link.tenant_id
         AND ((link.organization_id IS NULL AND messages.organization_id IS NULL) OR messages.organization_id = link.organization_id)
         AND messages.deleted_at IS NULL
      WHERE link.tenant_id = ?
        AND ((?::uuid IS NULL AND link.organization_id IS NULL) OR link.organization_id = ?::uuid)
        AND conv.tenant_id = ?
        AND ((?::uuid IS NULL AND conv.organization_id IS NULL) OR conv.organization_id = ?::uuid)
        AND conv.channel_id = ?
        AND link.created_at >= ?
        AND lower(regexp_replace(coalesce(link.channel_metadata->>'subject', ''),
              '^\\s*((re|fwd|fw|aw|wg|sv|tr|antw)\\s*[:\\-]\\s*|\\[[^\\]]+\\]\\s*)+',
              '',
              'i'
            )) = ?
        AND (
          lower(coalesce(link.channel_metadata->>'from', '')) = ANY(?::text[])
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(coalesce(link.channel_metadata->'to', '[]'::jsonb)) AS t(addr)
              WHERE lower(t.addr) = ANY(?::text[])
          )
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(coalesce(link.channel_metadata->'cc', '[]'::jsonb)) AS t(addr)
              WHERE lower(t.addr) = ANY(?::text[])
          )
        )
      ORDER BY link.created_at DESC
      LIMIT 1`,
    [
      args.tenantId,
      args.organizationId,
      args.organizationId,
      args.tenantId,
      args.organizationId,
      args.organizationId,
      args.channelId,
      args.cutoff,
      subjectLowerLike,
      participantList,
      participantList,
      participantList,
    ],
  )
  if (!rows || rows.length === 0) return null
  return rows[0].thread_id as string | null
}

function subtractDays(from: Date, days: number): Date {
  const next = new Date(from)
  next.setUTCDate(next.getUTCDate() - days)
  return next
}

// Re-export `MessageChannelLink` so callers importing types from this module
// don't have to reach into `data/entities.ts` indirectly.
export type { MessageChannelLink }
