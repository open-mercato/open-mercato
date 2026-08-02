export type ReferenceTaskDueBucket = 'none' | 'overdue' | 'today' | 'future'

export function classifyReferenceTaskDueDate(
  value: Date | string | null | undefined,
  now = new Date(),
): ReferenceTaskDueBucket {
  if (value === null || value === undefined) return 'none'
  const due = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(due.getTime())) return 'none'
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const nextDay = new Date(dayStart)
  nextDay.setDate(nextDay.getDate() + 1)
  if (due < dayStart) return 'overdue'
  if (due < nextDay) return 'today'
  return 'future'
}
