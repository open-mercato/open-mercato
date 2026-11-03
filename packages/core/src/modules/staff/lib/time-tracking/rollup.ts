export type RollupTask = {
  id: string
  parentTaskId?: string | null
  deletedAt?: Date | string | null
}

export type RollupEntry = {
  durationMinutes?: number | null
  deletedAt?: Date | string | null
}

export type EntriesByTaskId =
  | ReadonlyMap<string, readonly RollupEntry[]>
  | Record<string, readonly RollupEntry[] | undefined>

export type TaskRollup = {
  ownMinutes: number
  loggedMinutes: number
  childCount: number
}

function readEntries(source: EntriesByTaskId | null | undefined, taskId: string): readonly RollupEntry[] {
  if (!source) return []
  if (source instanceof Map) return source.get(taskId) ?? []
  return (source as Record<string, readonly RollupEntry[] | undefined>)[taskId] ?? []
}

function sumEntryMinutes(entries: readonly RollupEntry[]): number {
  let total = 0
  for (const entry of entries) {
    if (!entry || entry.deletedAt) continue
    const minutes = entry.durationMinutes
    if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) continue
    total += minutes
  }
  return total
}

export function loggedMinutes(
  task: RollupTask,
  allTasks: readonly RollupTask[],
  entriesByTaskId: EntriesByTaskId,
): TaskRollup {
  const ownMinutes = sumEntryMinutes(readEntries(entriesByTaskId, task.id))
  const children = (allTasks ?? []).filter(
    (candidate) => candidate.parentTaskId === task.id && candidate.id !== task.id && !candidate.deletedAt,
  )

  let childMinutes = 0
  for (const child of children) {
    childMinutes += sumEntryMinutes(readEntries(entriesByTaskId, child.id))
  }

  return {
    ownMinutes,
    loggedMinutes: ownMinutes + childMinutes,
    childCount: children.length,
  }
}
