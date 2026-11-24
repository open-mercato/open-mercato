import type { TodoLinkSummary } from './types'
import type { TaskFormPayload } from './hooks/usePersonTasks'
import type { InteractionUpdatePayload } from './hooks/useInteractions'

const RESERVED_TASK_CUSTOM_KEYS = new Set(['priority', 'description', 'due_at', 'dueAt'])

export function buildTaskFormInitialValues(task: TodoLinkSummary | null): Record<string, unknown> | undefined {
  if (!task) return undefined
  const values: Record<string, unknown> = {
    title: task.title ?? '',
    is_done: task.isDone ?? false,
    status: task.status ?? 'planned',
    description: task.description ?? '',
    priority: task.priority ?? '',
    scheduledAt: task.dueAt ?? '',
  }
  if (task.customValues) {
    for (const [key, value] of Object.entries(task.customValues)) {
      if (RESERVED_TASK_CUSTOM_KEYS.has(key)) continue
      const formKey = `cf_${key}`
      if (values[formKey] === undefined) values[formKey] = value
    }
  }
  return values
}

export function buildCanonicalTaskUpdatePayload(payload: TaskFormPayload): InteractionUpdatePayload {
  return {
    title: payload.base.title,
    status: payload.base.status ?? (payload.base.is_done ? 'done' : 'planned'),
    priority: payload.base.priority ?? null,
    body: payload.base.description ?? null,
    scheduledAt: payload.base.scheduledAt ?? null,
    customValues: payload.custom,
  }
}
