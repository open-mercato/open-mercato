import type { EntityManager } from '@mikro-orm/postgresql'
import { redactEmails } from './redact.js'
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
      payload: entry.payload,
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
