import type { EntityManager } from '@mikro-orm/postgresql'
import { redactEmails, redactPayload } from './redact.js'
import { MarketingDispatchDeadLetter } from '../data/entities.js'

/**
 * Records a dispatch that could not be processed at all.
 *
 * Append-only and nothing reprocesses it automatically. The point is that a malformed payload
 * stops being retried forever while still leaving evidence — a queue that silently swallows
 * bad messages and one that retries them until the end of time are both worse.
 *
 * A failure to write the dead letter is swallowed: losing the record is bad, but throwing here
 * would mask the original error that caused it.
 */
export async function recordDeadLetter(
  source: EntityManager,
  entry: {
    source: 'dispatch' | 'resume'
    error: unknown
    payload: Record<string, unknown>
    eventId?: string | null
    campaignId?: string | null
    tenantId?: string | null
    organizationId?: string | null
  },
): Promise<void> {
  try {
    // A FORKED entity manager on purpose. The caller's EM usually reached this path because its
    // own flush failed, so its unit of work still holds the offending entity: flushing the dead
    // letter through it would retry that same write, fail identically, and lose the evidence —
    // and leave the dirty unit of work to poison the next campaign in the same job.
    const em = source.fork()
    const record = em.create(MarketingDispatchDeadLetter, {
      source: entry.source,
      eventId: entry.eventId ?? null,
      campaignId: entry.campaignId ?? null,
      tenantId: entry.tenantId ?? null,
      organizationId: entry.organizationId ?? null,
      /**
       * Redacted like the error beside it, and for a stronger reason.
       *
       * `readInboundPayload` copies every key a partner posted into the trigger context, so a failed dispatch of
       * an inbound hook wrote their whole body here — contact addresses, phone numbers, names — into plaintext
       * jsonb that every replica carries and that a future reader will show. Redacting the error while storing
       * the payload verbatim was protecting the smaller half.
       *
       * NOTE: there is no reader yet. This comment said "the jobs screen shows" it, and that screen reads
       * `marketing_job_runs` — a different table. Nothing in `api/` or `backend/` touches this one, so a dead
       * letter is written, pruned at thirty days, and never seen. The argument below for refusing automatic
       * replay is right — "replay belongs behind a person deciding" — but there is no screen for that person to
       * decide on, which makes this table write-only until one exists.
       */
      payload: redactPayload(entry.payload),
      // Redacted for the same reason `last_error` is: this is third-party failure text, and a transport
      // rejection quotes the address it rejected.
      error: redactEmails(entry.error instanceof Error ? entry.error.message : String(entry.error)).slice(0, 4000),
  })
    em.persist(record)
    await em.flush()
  } catch {
    // Intentionally ignored — see the note above.
  }
}

/**
 * How long a dead letter is kept.
 *
 * Thirty days, matching the job-run log: the two answer the same question from opposite sides, and a reader
 * comparing "what ran" with "what could not" should not have to hold two windows in their head.
 */
export const DEAD_LETTER_RETENTION_DAYS = 30

/**
 * Removes dead letters past the retention window.
 *
 * The table was append-only with nothing ever reading or removing a row, so a tenant with a malformed
 * integration accumulated one per failed delivery for ever. Pruned by the sweep that writes them, for the
 * reason the job log is: a cleanup task nobody scheduled is a table that grows until somebody notices.
 *
 * Rows with no scope are included. The dispatcher records one when it could not resolve a tenant at all, so
 * those rows belong to nobody and would otherwise be the only ones that never expire — and past the window
 * there is nothing in them anybody can act on. The payload is redacted on write, so what ages out here is
 * already a redacted record rather than a partner's body.
 *
 * This is retention, not a replay. Nothing reprocesses a dead letter automatically and nothing should: a
 * dispatch is guarded against duplicates by an occurrence key with a window, and replaying one after that
 * window has passed would start the journey a second time. Replay belongs behind a person deciding.
 */
export async function pruneDeadLetters(
  source: EntityManager,
  scope: { tenantId: string; organizationId: string },
  now: Date,
  retentionDays = DEAD_LETTER_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000)
  return source.nativeDelete(MarketingDispatchDeadLetter, {
    $and: [
      { $or: [{ tenantId: scope.tenantId }, { tenantId: null }] },
      { $or: [{ organizationId: scope.organizationId }, { organizationId: null }] },
      { createdAt: { $lt: cutoff } },
    ],
  })
}
