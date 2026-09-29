import { processOutcomeSchema, type ProcessOutcome } from '../../data/validators'

/**
 * Readers for the optional `process_instances.outcome_*` columns — what a
 * completed BUSINESS EXECUTION produced (unification spec, 2026-09-06 §Outcome).
 * It belongs to workflow/business-process completion, never to a single agent
 * run: at the moment an agent finishes, a proposal's record does not exist yet.
 *
 * Dependency-free and client-safe like its `triggers.ts` / `milestones.ts`
 * siblings (no ORM, no module registry, no server-only import): the projection,
 * the API route, the detail pages and the tests all read the outcome through
 * here rather than touching the three columns by hand.
 *
 * The outcome is OPTIONAL BY DECISION — a research or monitoring process
 * produces nothing — so every reader here returns `null` rather than throwing
 * when a row carries none.
 */

/**
 * The three persisted columns, in either camelCase (the ORM entity) or the raw
 * snake_case list projection. Values are `unknown` so an untyped API row reads
 * through the same door as the entity.
 */
export type ProcessOutcomeColumns = {
  outcomeType?: unknown
  outcomeId?: unknown
  outcomeLabel?: unknown
  outcome_type?: unknown
  outcome_id?: unknown
  outcome_label?: unknown
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Reads the outcome off an execution row. An incomplete pair (type without id) is no outcome. */
export function readProcessOutcome(row: ProcessOutcomeColumns | null | undefined): ProcessOutcome | null {
  if (!row) return null
  const type = readString(row.outcomeType) ?? readString(row.outcome_type)
  const id = readString(row.outcomeId) ?? readString(row.outcome_id)
  if (!type || !id) return null
  const label = readString(row.outcomeLabel) ?? readString(row.outcome_label)
  const parsed = processOutcomeSchema.safeParse(label ? { type, id, label } : { type, id })
  return parsed.success ? parsed.data : null
}

/**
 * Parses an outcome DECLARED by the terminating source — the finished workflow
 * instance's final context — under its `outcome` key. Nothing DERIVES an
 * outcome; the terminating source declares one or there is none.
 * Anything that does not match the shape is ignored rather than thrown on: a
 * malformed declaration must not turn a successful run into a failed one.
 */
export function parseDeclaredOutcome(raw: unknown): ProcessOutcome | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const parsed = processOutcomeSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** The `outcome` key of a context/result bag, when it carries one. */
export function declaredOutcomeOf(source: unknown): ProcessOutcome | null {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  return parseDeclaredOutcome((source as Record<string, unknown>).outcome)
}

/**
 * The owning module of an outcome type (`claims:claim` → `claims`), or null
 * when the type carries no `<module>:<entity>` prefix. Storage never enforces
 * the prefix, so its absence degrades the link, never the record.
 */
export function outcomeModuleId(type: string): string | null {
  const separator = type.indexOf(':')
  if (separator <= 0 || separator === type.length - 1) return null
  return type.slice(0, separator)
}

/** The entity half of an outcome type (`claims:claim` → `claim`). */
export function outcomeEntityName(type: string): string | null {
  const separator = type.indexOf(':')
  if (separator <= 0 || separator === type.length - 1) return null
  return type.slice(separator + 1)
}

/**
 * What a reader sees. The LABEL SNAPSHOT is the point of the column: it stays
 * readable when the owning module is absent, so it wins over the raw id.
 */
export function outcomeDisplayLabel(outcome: ProcessOutcome): string {
  return outcome.label ?? outcome.id
}

export type { ProcessOutcome }
