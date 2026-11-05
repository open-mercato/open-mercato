import type { CalendarItem } from '../../components/calendar/types'

export type PackedCalendarItem = {
  item: CalendarItem
  column: number
  columns: number
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

  const flushCluster = () => {
    const columns = columnEnds.length
    for (const entry of cluster) {
      result.push({ item: entry.item, column: entry.column, columns })
    }
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
