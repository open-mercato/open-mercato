import type { EntityManager } from '@mikro-orm/postgresql'
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
  em: EntityManager,
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
    const record = em.create(MarketingDispatchDeadLetter, {
      source: entry.source,
      eventId: entry.eventId ?? null,
      campaignId: entry.campaignId ?? null,
      tenantId: entry.tenantId ?? null,
      organizationId: entry.organizationId ?? null,
      payload: entry.payload,
      error: (entry.error instanceof Error ? entry.error.message : String(entry.error)).slice(0, 4000),
  })
    em.persist(record)
    await em.flush()
  } catch {
    // Intentionally ignored — see the note above.
  }
}
