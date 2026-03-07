import type { TimelineEntry, TimelineEntryKind } from './types'

export type AggregateOptions = {
  limit: number
  before: string | null
  types: Set<TimelineEntryKind> | null
}

export function aggregateTimeline(
  sources: TimelineEntry[][],
  options: AggregateOptions,
): { items: TimelineEntry[]; nextCursor: string | null } {
  let merged: TimelineEntry[] = []
  for (const source of sources) {
    for (const entry of source) {
      merged.push(entry)
    }
  }

  if (options.types && options.types.size > 0) {
    merged = merged.filter((entry) => options.types!.has(entry.kind))
  }

  if (options.before) {
    const beforeTs = new Date(options.before).getTime()
    if (Number.isFinite(beforeTs)) {
      merged = merged.filter((entry) => new Date(entry.occurredAt).getTime() < beforeTs)
    }
  }

  merged.sort((a, b) => {
    const aTs = new Date(a.occurredAt).getTime()
    const bTs = new Date(b.occurredAt).getTime()
    return bTs - aTs
  })

  const deduped = deduplicateEntries(merged)
  const limited = deduped.slice(0, options.limit)
  const nextCursor = limited.length === options.limit && deduped.length > options.limit
    ? limited[limited.length - 1].occurredAt
    : null

  return { items: limited, nextCursor }
}

function deduplicateEntries(entries: TimelineEntry[]): TimelineEntry[] {
  const seen = new Set<string>()
  const result: TimelineEntry[] = []

  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    result.push(entry)
  }

  return result
}
