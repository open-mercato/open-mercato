type SortDirection = 'asc' | 'desc'
type OrderBy = Record<string, string> | Array<Record<string, string>>
type SortableValue = Date | string | number | bigint | null | undefined

export type TiedTimestampOrderOptions = {
  orderBy?: OrderBy
  limit?: number
  offset?: number
}

function sortKeys(orderBy: OrderBy | undefined): Array<[string, SortDirection]> {
  if (!orderBy) return []
  const entries = Array.isArray(orderBy)
    ? orderBy.flatMap((clause) => Object.entries(clause))
    : Object.entries(orderBy)
  return entries.map(([key, direction]) => [key, direction.toLowerCase() === 'desc' ? 'desc' : 'asc'])
}

function comparable(value: SortableValue): number | string | bigint {
  if (value instanceof Date) return value.getTime()
  if (value === null || value === undefined) return Number.POSITIVE_INFINITY
  return value
}

function compareValues(left: SortableValue, right: SortableValue): number {
  const leftValue = comparable(left)
  const rightValue = comparable(right)
  if (leftValue < rightValue) return -1
  if (leftValue > rightValue) return 1
  return 0
}

/**
 * Models how Postgres treats rows that tie on every ORDER BY key: their
 * relative order is unspecified and may differ between two executions of the
 * same query. Each call starts from a different rotation of the rows, so a
 * page walk only stays consistent when the requested order is total.
 */
export function createTiedTimestampOrdering<Row extends Record<string, unknown>>(rows: Row[]) {
  let executions = 0
  return function orderPage(options: TiedTimestampOrderOptions = {}): Row[] {
    const rotation = rows.length === 0 ? 0 : executions % rows.length
    executions += 1
    const arrangement = [...rows.slice(rotation), ...rows.slice(0, rotation)]
    const keys = sortKeys(options.orderBy)
    const ordered = [...arrangement].sort((left, right) => {
      for (const [key, direction] of keys) {
        const result = compareValues(left[key] as SortableValue, right[key] as SortableValue)
        if (result !== 0) return direction === 'desc' ? -result : result
      }
      return 0
    })
    const offset = options.offset ?? 0
    return options.limit === undefined ? ordered.slice(offset) : ordered.slice(offset, offset + options.limit)
  }
}
