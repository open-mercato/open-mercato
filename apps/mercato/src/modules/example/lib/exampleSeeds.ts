import { createHash } from 'node:crypto'

export const EXAMPLE_CALENDAR_ENTITY_ID = 'example:calendar_entity' as const
export const EXAMPLE_TODO_ENTITY_ID = 'example:todo' as const

/**
 * The custom entities this module owns. `installCustomEntitiesFromModules` installs
 * every declared entity when given no filter; a module setup hook narrows to its own
 * so initializing one module never rewrites another module's definitions.
 */
export const EXAMPLE_SETUP_ENTITY_IDS = [EXAMPLE_CALENDAR_ENTITY_ID, EXAMPLE_TODO_ENTITY_ID] as const

export type ExampleSeedScope = {
  tenantId: string
  organizationId: string
}

/**
 * Deterministic record id, derived from the scope and a stable slug.
 *
 * This is what makes `seedDefaults` idempotent without a read-before-write:
 * `DataEngine.createCustomEntityRecord` upserts on
 * `(entity_type, entity_id, organization_id)`, so re-running the hook rewrites the
 * same rows instead of appending duplicates. Same construction as
 * `packages/core/src/modules/integrations/setup.ts` — a sha256 digest truncated to
 * 16 bytes with the RFC 4122 version/variant bits forced, because the storage
 * column wants a UUID.
 */
export function stableExampleRecordId(
  scope: ExampleSeedScope,
  entityId: string,
  slug: string,
): string {
  const bytes = createHash('sha256')
    .update(`${entityId}|${scope.tenantId}|${scope.organizationId}|${slug}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export type CalendarReferenceSeed = {
  slug: string
  title: string
  when: string
  location: string
  notes: string
}

/**
 * Structural reference rows, not demo data: they describe the operating rhythm a
 * fresh organization is expected to have, so they ship from `seedDefaults` (always)
 * rather than `seedExamples` (skipped by `mercato init --no-examples`).
 */
export const CALENDAR_REFERENCE_SEEDS: CalendarReferenceSeed[] = [
  {
    slug: 'weekly-operations-review',
    title: 'Weekly operations review',
    when: 'Every Monday',
    location: 'Operations room',
    notes: 'Standing review of open work and blockers for the current week.',
  },
  {
    slug: 'monthly-data-quality-check',
    title: 'Monthly data quality check',
    when: 'First working day of the month',
    location: 'Remote',
    notes: 'Reconcile reference data and archive records closed in the previous month.',
  },
  {
    slug: 'quarterly-planning',
    title: 'Quarterly planning',
    when: 'First week of each quarter',
    location: 'Main office',
    notes: 'Set objectives for the coming quarter and review the previous one.',
  },
]

export type CalendarReferenceRecord = {
  recordId: string
  values: Record<string, string>
}

export function buildCalendarReferenceRecords(scope: ExampleSeedScope): CalendarReferenceRecord[] {
  return CALENDAR_REFERENCE_SEEDS.map((seed) => ({
    recordId: stableExampleRecordId(scope, EXAMPLE_CALENDAR_ENTITY_ID, seed.slug),
    values: {
      title: seed.title,
      when: seed.when,
      location: seed.location,
      notes: seed.notes,
    },
  }))
}
