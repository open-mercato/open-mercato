import fs from 'node:fs'
import path from 'node:path'
import { matchEventPattern } from '@open-mercato/shared/lib/events/patterns'
import eventsConfig from '../../events'

const SUBSCRIBER_DIR = path.join(__dirname, '..')

type SubscriberMetadata = { event: string; id: string }

function loadInvalidationPatterns(): SubscriberMetadata[] {
  return fs
    .readdirSync(SUBSCRIBER_DIR)
    .filter((file) => file.startsWith('invalidate-enricher-cache-') && file.endsWith('.ts'))
    .map((file) => {
      const mod = require(path.join(SUBSCRIBER_DIR, file)) as { metadata: SubscriberMetadata }
      return mod.metadata
    })
}

/**
 * Every WMS event that moves data the inventory enrichers read MUST be covered
 * by an invalidation subscriber. A write surface added without one is exactly
 * the failure this cache carries: stock that stays wrong until the TTL expires.
 * The events deliberately excluded below do not change any enriched field.
 */
const EVENTS_WITHOUT_ENRICHED_DATA = new Set([
  // Zones and locations sit below a warehouse; no enriched field reads them.
  'wms.zone.created',
  'wms.zone.updated',
  'wms.location.created',
  'wms.location.updated',
])

describe('WMS inventory enricher cache invalidation coverage', () => {
  const patterns = loadInvalidationPatterns()

  it('registers a unique subscriber id per pattern', () => {
    const ids = patterns.map((meta) => meta.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThan(0)
  })

  it('covers every WMS event that changes data the enrichers read', () => {
    const declared = eventsConfig.events.map((event) => event.id)
    const relevant = declared.filter((id) => !EVENTS_WITHOUT_ENRICHED_DATA.has(id))

    const uncovered = relevant.filter(
      (eventId) => !patterns.some((meta) => matchEventPattern(eventId, meta.event)),
    )

    expect(uncovered).toEqual([])
  })

  it('covers the catalog variant events the product enricher depends on', () => {
    for (const eventId of ['catalog.variant.created', 'catalog.variant.updated', 'catalog.variant.deleted']) {
      expect(patterns.some((meta) => matchEventPattern(eventId, meta.event))).toBe(true)
    }
  })
})
