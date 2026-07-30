/**
 * Failure-queue error grouping (spec §8.4) — PURE.
 *
 * > "Failure queue + bulk replay: `Send to failure queue` directive parks
 * > instances as ATTENTION; with FAILED instances they form a triage list with
 * > error grouping; bulk retry/cancel runs through the progress module."
 *
 * A triage list is only useful if 400 failures collapse into the four things
 * that actually broke. Grouping on the raw message never does that: every row
 * carries its own order id, its own timestamp, its own retry count. So each
 * message is normalized into a SHAPE — identifiers, numbers, quoted values and
 * timestamps replaced by placeholders — and rows are grouped on the shape while
 * the first raw message is kept as the human label.
 *
 * The normalization is deliberately conservative. Over-normalizing merges two
 * genuinely different failures, which is worse than showing them apart: an
 * operator who sees two groups can still bulk-replay both, but one who sees a
 * merged group cannot tell that half of it will fail again.
 */

/** Longest label kept for a group; the full message stays on each instance. */
export const FAILURE_GROUP_LABEL_MAX = 160

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g
const QUOTED = /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g
const HEX_BLOB = /\b[0-9a-f]{12,}\b/gi
const NUMBER = /\b\d+(?:\.\d+)?\b/g
const WHITESPACE = /\s+/g

export type TriageInstanceInput = {
  id: string
  workflowId: string
  status: string
  errorMessage?: string | null
  /** `metadata.attention.reason` when the instance was parked by a directive. */
  attentionReason?: string | null
  /** The run's verdict; a `partial_failure` carries no `errorMessage` of its own. */
  outcome?: string | null
}

export type FailureGroup = {
  /** Stable key for the normalized shape — safe to use as a filter value. */
  key: string
  /** First raw message seen for this shape, truncated for display. */
  label: string
  count: number
  /** Distinct workflow ids in the group, so a cross-workflow failure is visible. */
  workflowIds: string[]
  /** Instance ids in the group, in the order they were scanned. */
  instanceIds: string[]
}

/**
 * Reduce an error message to its shape. Two messages that differ only in the
 * ids/numbers/quoted values they mention normalize to the same string.
 */
export function normalizeFailureMessage(message: string): string {
  return message
    .replace(UUID, '{id}')
    .replace(ISO_TIMESTAMP, '{time}')
    .replace(QUOTED, '{value}')
    .replace(HEX_BLOB, '{hex}')
    .replace(NUMBER, '{n}')
    .replace(WHITESPACE, ' ')
    .trim()
}

const UNCLASSIFIED_KEY = 'unclassified'
const UNCLASSIFIED_LABEL = 'No error message recorded'

/**
 * Fallback shape for a run that reached END while tolerating a failure. It has
 * no `errorMessage` — the run did not fail — and no attention marker, so
 * without this every partial failure in the tenant would collapse into the one
 * meaningless `unclassified` bucket next to genuinely unlabelled rows.
 */
const PARTIAL_FAILURE_LABEL = 'Completed with tolerated failures'

function truncate(value: string): string {
  return value.length <= FAILURE_GROUP_LABEL_MAX ? value : `${value.slice(0, FAILURE_GROUP_LABEL_MAX - 1)}…`
}

/**
 * The message a group is derived from. A parked instance often has no
 * `errorMessage` of its own — the directive recorded WHY it parked in
 * `metadata.attention.reason` — so that is the fallback rather than dumping
 * every parked run into one meaningless bucket.
 */
export function resolveFailureMessage(instance: TriageInstanceInput): string | null {
  if (instance.errorMessage && instance.errorMessage.trim().length > 0) return instance.errorMessage.trim()
  if (instance.attentionReason && instance.attentionReason.trim().length > 0) {
    return instance.attentionReason.trim()
  }
  if (instance.outcome === 'partial_failure') return PARTIAL_FAILURE_LABEL
  return null
}

export function groupFailures(instances: readonly TriageInstanceInput[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>()

  for (const instance of instances) {
    const message = resolveFailureMessage(instance)
    const key = message ? normalizeFailureMessage(message) : UNCLASSIFIED_KEY
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      existing.instanceIds.push(instance.id)
      if (!existing.workflowIds.includes(instance.workflowId)) {
        existing.workflowIds.push(instance.workflowId)
      }
      continue
    }
    groups.set(key, {
      key,
      label: truncate(message ?? UNCLASSIFIED_LABEL),
      count: 1,
      workflowIds: [instance.workflowId],
      instanceIds: [instance.id],
    })
  }

  // Biggest group first — that is the one worth fixing. Ties break on the key
  // so the ordering is stable across requests rather than hash-order.
  return [...groups.values()].sort(
    (left, right) => right.count - left.count || left.key.localeCompare(right.key)
  )
}

/** Does this instance belong to the given group? Used to narrow the triage list. */
export function matchesFailureGroup(instance: TriageInstanceInput, groupKey: string): boolean {
  const message = resolveFailureMessage(instance)
  return (message ? normalizeFailureMessage(message) : UNCLASSIFIED_KEY) === groupKey
}
