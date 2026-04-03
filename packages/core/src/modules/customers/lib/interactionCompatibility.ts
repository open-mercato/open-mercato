import type { InteractionSummary, ActivitySummary, TodoLinkSummary } from '../components/detail/types'

export const CUSTOMER_INTERACTION_ENTITY_ID = 'customers:customer_interaction'
export const CUSTOMER_INTERACTION_TASK_SOURCE = 'customers:interaction'
export const CUSTOMER_INTERACTION_TASK_TYPE = 'task'
export const CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE = 'adapter:activity'
export const CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE = 'adapter:todo'

export type InteractionRecord = InteractionSummary & {
  authorName?: string | null
  authorEmail?: string | null
  dealTitle?: string | null
  customValues?: Record<string, unknown> | null
  _integrations?: Record<string, unknown>
}

export function isTaskInteractionType(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === CUSTOMER_INTERACTION_TASK_TYPE
}

export function isAdapterActivitySource(value: string | null | undefined): boolean {
  return value === CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE
}

export function isAdapterTodoSource(value: string | null | undefined): boolean {
  return value === CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE
}

export function mapInteractionRecordToActivitySummary(interaction: InteractionRecord): ActivitySummary {
  return {
    id: interaction.id,
    activityType: interaction.interactionType,
    subject: interaction.title ?? null,
    body: interaction.body ?? null,
    occurredAt: interaction.occurredAt ?? interaction.scheduledAt ?? null,
    createdAt: interaction.createdAt,
    appearanceIcon: interaction.appearanceIcon ?? null,
    appearanceColor: interaction.appearanceColor ?? null,
    entityId: interaction.entityId ?? null,
    authorUserId: interaction.authorUserId ?? null,
    authorName: interaction.authorName ?? null,
    authorEmail: interaction.authorEmail ?? null,
    dealId: interaction.dealId ?? null,
    dealTitle: interaction.dealTitle ?? null,
    customValues: interaction.customValues ?? null,
  }
}

export function mapInteractionRecordToTodoSummary(interaction: InteractionRecord): TodoLinkSummary {
  const customValues: Record<string, unknown> = { ...(interaction.customValues ?? {}) }
  if (interaction.priority !== undefined) customValues.priority = interaction.priority
  if (interaction.body !== undefined && customValues.description === undefined) {
    customValues.description = interaction.body ?? null
  }
  if (interaction.scheduledAt !== undefined && customValues.due_at === undefined) {
    customValues.due_at = interaction.scheduledAt ?? null
  }

  return {
    id: interaction.id,
    todoId: interaction.id,
    todoSource: CUSTOMER_INTERACTION_TASK_SOURCE,
    createdAt: interaction.createdAt,
    title: interaction.title ?? null,
    isDone: interaction.status === 'done',
    status: interaction.status,
    priority: interaction.priority ?? null,
    severity:
      typeof customValues.severity === 'string' && customValues.severity.trim().length
        ? customValues.severity.trim()
        : null,
    description: interaction.body ?? null,
    dueAt: interaction.scheduledAt ?? null,
    todoOrganizationId: null,
    customValues: Object.keys(customValues).length > 0 ? customValues : null,
  }
}
