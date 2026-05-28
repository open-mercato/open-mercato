import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ChannelThreadToken, MessageChannelLink } from '../data/entities'
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
 * All DB queries are tenant-scoped. The matcher does not write — it
 * returns the resolved thread id (or null) and lets the caller perform
 * the actual ingest. Tokens get their `last_seen_at` bumped here as a
 * side-effect when a token-based strategy hits (used for future GC).
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
    const row = await findOneWithDecryption(
      em,
      ChannelThreadToken,
      { tenantId, token: headerToken },
      undefined,
      dscope,
    )
    if (row) {
      row.lastSeenAt = (now ?? (() => new Date()))()
      await em.flush()
      return {
        messageThreadId: row.messageThreadId,
        matchedBy: 'token-references',
        confidence: 'high',
      }
    }
  }

  // Strategy 2: token in body.
  const bodyToken = extractTokenFromBody(input.bodyHtml, input.bodyPlain)
  if (bodyToken) {
    const row = await findOneWithDecryption(
      em,
      ChannelThreadToken,
      { tenantId, token: bodyToken },
      undefined,
      dscope,
    )
    if (row) {
      row.lastSeenAt = (now ?? (() => new Date()))()
      await em.flush()
      return {
        messageThreadId: row.messageThreadId,
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
  args: { tenantId: string; channelId: string; messageIds: string[] },
): Promise<string | null> {
  if (args.messageIds.length === 0) return null
  // MikroORM v7 dropped the Knex builder; we use raw SQL via
  // `em.getConnection().execute()` with positional placeholders. The JSONB
  // lookup compares `channel_metadata->>'messageId'` against a Postgres
  // text array built from the candidate message-ids.
  const idArray = `{${args.messageIds
    .map((id) => `"${id.replace(/"/g, '\\"')}"`)
    .join(',')}}`
  const rows = await em.getConnection().execute<Array<{ message_id: string }>>(
    `SELECT link.message_id FROM message_channel_links AS link
       INNER JOIN external_conversations AS conv
         ON conv.id = link.external_conversation_id
      WHERE link.tenant_id = ? AND conv.channel_id = ?
        AND link.channel_metadata->>'messageId' = ANY(?::text[])
      LIMIT 1`,
    [args.tenantId, args.channelId, idArray],
  )
  if (!rows || rows.length === 0) return null

  const messageId = rows[0].message_id as string
  // Translate `messages.message.id` to `messages.message.thread_id`. We
  // intentionally avoid importing the messages entity (cross-module rule).
  const threadRows = await em.getConnection().execute<Array<{ thread_id: string | null }>>(
    `SELECT thread_id FROM messages
      WHERE id = ? AND tenant_id = ? LIMIT 1`,
    [messageId, args.tenantId],
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
  const participantList = `{${args.participants
    .map((p) => `"${p.replace(/"/g, '\\"')}"`)
    .join(',')}}`
  const rows = await em.getConnection().execute<Array<{ thread_id: string | null }>>(
    `SELECT messages.thread_id
       FROM message_channel_links AS link
       INNER JOIN external_conversations AS conv
         ON conv.id = link.external_conversation_id
       INNER JOIN messages
         ON messages.id = link.message_id
         AND messages.tenant_id = link.tenant_id
      WHERE link.tenant_id = ? AND conv.channel_id = ? AND link.created_at >= ?
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
