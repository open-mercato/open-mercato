import { processRunOutcomeSchema, type ProcessRunOutcome } from '../../data/validators'

/**
 * Readers for the optional `agent_process_runs.outcome_*` columns — what a
 * completed run PRODUCED (spec `2026-08-11-triggered-process-model.md` §Outcome).
 *
 * Dependency-free and client-safe like its `triggers.ts` / `milestones.ts`
 * siblings (no ORM, no module registry, no server-only import): the executor,
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
export type ProcessRunOutcomeColumns = {
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

/** Reads the outcome off a run row. An incomplete pair (type without id) is no outcome. */
export function readProcessRunOutcome(row: ProcessRunOutcomeColumns | null | undefined): ProcessRunOutcome | null {
  if (!row) return null
  const type = readString(row.outcomeType) ?? readString(row.outcome_type)
  const id = readString(row.outcomeId) ?? readString(row.outcome_id)
  if (!type || !id) return null
  const label = readString(row.outcomeLabel) ?? readString(row.outcome_label)
  const parsed = processRunOutcomeSchema.safeParse(label ? { type, id, label } : { type, id })
  return parsed.success ? parsed.data : null
}

/**
 * Parses an outcome DECLARED by the terminating source (a workflow instance's
 * final context, a researcher agent's result data) under its `outcome` key.
 * Anything that does not match the shape is ignored rather than thrown on: a
 * malformed declaration must not turn a successful run into a failed one.
 */
export function parseDeclaredOutcome(raw: unknown): ProcessRunOutcome | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const parsed = processRunOutcomeSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** The `outcome` key of a context/result bag, when it carries one. */
export function declaredOutcomeOf(source: unknown): ProcessRunOutcome | null {
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
export function outcomeDisplayLabel(outcome: ProcessRunOutcome): string {
  return outcome.label ?? outcome.id
}

export type { ProcessRunOutcome }
