import type { CalendarItem } from '../../components/calendar/types'

export const PACKED_COLUMN_GAP_PX = 2
export const MIN_PACKED_COLUMN_WIDTH_PX = 64
export const DEFAULT_MAX_PACKED_COLUMNS = 3
export const MIN_COLLAPSE_LIMIT_COLUMNS = 2

const UNINDEXED_CLUSTER = -1

export type PackedCalendarItem = {
  item: CalendarItem
  column: number
  columns: number
  /**
   * Index of the overlap cluster `packOverlaps` placed the item in. Optional so
   * entries built with the original three fields keep working: without it,
   * `collapseDenseClusters` groups hidden events by their time ranges alone.
   */
  cluster?: number
}

export type PackedOverflow = {
  cluster: number
  group: number
  items: CalendarItem[]
  column: number
  columns: number
  start: Date
  end: Date
}

export type DenseLayout = {
  visible: PackedCalendarItem[]
  overflow: PackedOverflow[]
}

export function packOverlaps(dayItems: CalendarItem[]): PackedCalendarItem[] {
  const sorted = [...dayItems].sort((first, second) => {
    const startDelta = first.start.getTime() - second.start.getTime()
    if (startDelta !== 0) return startDelta
    return second.end.getTime() - first.end.getTime()
  })

  const result: PackedCalendarItem[] = []
  let cluster: Array<{ item: CalendarItem; column: number }> = []
  let columnEnds: number[] = []
  let clusterEnd = Number.NEGATIVE_INFINITY
  let clusterIndex = 0

  const flushCluster = () => {
    const columns = columnEnds.length
    for (const entry of cluster) {
      result.push({ item: entry.item, column: entry.column, columns, cluster: clusterIndex })
    }
    if (cluster.length > 0) clusterIndex += 1
    cluster = []
    columnEnds = []
    clusterEnd = Number.NEGATIVE_INFINITY
  }

  for (const item of sorted) {
    const startTime = item.start.getTime()
    if (cluster.length > 0 && startTime >= clusterEnd) flushCluster()
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= startTime)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(item.end.getTime())
    } else {
      columnEnds[column] = item.end.getTime()
    }
    cluster.push({ item, column })
    clusterEnd = Math.max(clusterEnd, item.end.getTime())
  }
  flushCluster()

  return result
}

/**
 * How many packed columns still leave each event a readable label. Unknown or
 * unmeasured widths fall back to a conservative default; a column never drops
 * below two slots, so a pair stays visible and at least one event sits beside
 * the overflow disclosure, however narrow the column.
 */
export function resolveMaxPackedColumns(usableWidthPx: number | null): number {
  if (usableWidthPx == null || !Number.isFinite(usableWidthPx) || usableWidthPx <= 0) {
    return DEFAULT_MAX_PACKED_COLUMNS
  }
  const slotWidth = MIN_PACKED_COLUMN_WIDTH_PX + PACKED_COLUMN_GAP_PX
  return Math.max(MIN_COLLAPSE_LIMIT_COLUMNS, Math.floor((usableWidthPx + PACKED_COLUMN_GAP_PX) / slotWidth))
}

/**
 * Collapses clusters wider than `maxColumns` into the first `maxColumns - 1`
 * regular columns plus one overflow column. Hidden events are grouped only
 * with the hidden events they overlap in time, so each "+N more" slot covers
 * its own time range and never pulls a later meeting away from its start. A
 * hidden event that overlaps no other hidden event is drawn in place in the
 * overflow column. Clusters that already fit are returned untouched. The limit
 * never drops below two columns: a pair is never folded, and a denser cluster
 * keeps one visible event.
 */
export function collapseDenseClusters(packed: PackedCalendarItem[], maxColumns: number): DenseLayout {
  const limit = Math.max(MIN_COLLAPSE_LIMIT_COLUMNS, Math.floor(maxColumns))
  const visibleColumns = limit - 1
  const visible: PackedCalendarItem[] = []
  const hiddenByCluster = new Map<number, PackedCalendarItem[]>()

  for (const entry of packed) {
    if (entry.columns <= limit) {
      visible.push(entry)
      continue
    }
    if (entry.column < visibleColumns) {
      visible.push({ ...entry, columns: limit })
      continue
    }
    const clusterKey = entry.cluster ?? UNINDEXED_CLUSTER
    const bucket = hiddenByCluster.get(clusterKey)
    if (bucket) bucket.push(entry)
    else hiddenByCluster.set(clusterKey, [entry])
  }

  const overflow: PackedOverflow[] = []
  for (const [cluster, entries] of hiddenByCluster) {
    const groups = groupOverlappingEntries(entries)
    groups.forEach((group, groupIndex) => {
      if (group.entries.length === 1) {
        visible.push({ ...group.entries[0], column: visibleColumns, columns: limit })
        return
      }
      overflow.push({
        cluster,
        group: groupIndex,
        items: group.entries.map((entry) => entry.item),
        column: visibleColumns,
        columns: limit,
        start: new Date(group.startMs),
        end: new Date(group.endMs),
      })
    })
  }

  visible.sort((first, second) => {
    const startDelta = first.item.start.getTime() - second.item.start.getTime()
    if (startDelta !== 0) return startDelta
    return first.column - second.column
  })

  return { visible, overflow }
}

type OverlapGroup = { entries: PackedCalendarItem[]; startMs: number; endMs: number }

function groupOverlappingEntries(entries: PackedCalendarItem[]): OverlapGroup[] {
  const sorted = [...entries].sort((first, second) => first.item.start.getTime() - second.item.start.getTime())
  const groups: OverlapGroup[] = []
  for (const entry of sorted) {
    const startMs = entry.item.start.getTime()
    const endMs = entry.item.end.getTime()
    const current = groups[groups.length - 1]
    if (current && startMs < current.endMs) {
      current.entries.push(entry)
      current.endMs = Math.max(current.endMs, endMs)
      continue
    }
    groups.push({ entries: [entry], startMs, endMs })
  }
  return groups
}

/**
 * Inline geometry for a packed column. The gap is shared evenly across the
 * cluster so the last column ends exactly at the container edge.
 */
export function packedColumnGeometry(column: number, columns: number): { insetInlineStart: string; width: string } {
  const widthPct = 100 / columns
  const gapShare = PACKED_COLUMN_GAP_PX / columns
  return {
    insetInlineStart: `calc(${column * widthPct}% + ${column * gapShare}px)`,
    width: `calc(${widthPct}% - ${(columns - 1) * gapShare}px)`,
  }
}
