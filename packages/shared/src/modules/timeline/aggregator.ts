import type { TimelineEntry, AggregateOptions } from './types'

export function aggregateTimeline<K extends string>(
  sources: TimelineEntry<K>[][],
  options: AggregateOptions<K>,
): { items: TimelineEntry<K>[]; nextCursor: string | null } {
  let merged: TimelineEntry<K>[] = []
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

function deduplicateEntries<K extends string>(entries: TimelineEntry<K>[]): TimelineEntry<K>[] {
  const seen = new Set<string>()
  const result: TimelineEntry<K>[] = []

  for (const entry of entries) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    result.push(entry)
  }

  return result
}
