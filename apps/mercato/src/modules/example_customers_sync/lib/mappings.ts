import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ExampleCustomerInteractionMapping } from '../data/entities'
import type { ExampleCustomersSyncScope } from './runtime'

export type { ExampleCustomersSyncScope }

export type ExampleCustomersSyncMappingInput = ExampleCustomersSyncScope & {
  interactionId: string
  todoId: string
  syncStatus: 'pending' | 'synced' | 'error'
  lastSyncedAt?: Date | null
  lastError?: string | null
  sourceUpdatedAt?: Date | null
}

const EXAMPLE_PRIORITY_RAW_KEY = '__om_customer_interaction_priority_raw'
const EXAMPLE_SEVERITY_RAW_KEY = '__om_customer_interaction_severity_raw'

export function buildExampleTodoHref(todoId: string): string {
  return `/backend/todos/${encodeURIComponent(todoId)}/edit`
}

function parsePriorityValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function normalizeExamplePriorityValue(value: number): number {
  return Math.min(5, Math.max(1, Math.round(value)))
}

function normalizeSeverityValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null
}

function normalizeExampleSeverityValue(value: unknown): string | null {
  const normalized = normalizeSeverityValue(value)
  if (!normalized) return null
  if (normalized === 'critical') return 'high'
  if (normalized === 'normal') return 'medium'
  return normalized
}

export function buildExampleTodoCustomValuesFromInteraction(
  interaction: {
    priority?: number | null
    body?: string | null
    customValues?: Record<string, unknown> | null
  },
  options: {
    includeClears?: boolean
  } = {},
): Record<string, unknown> {
  const includeClears = options.includeClears === true
  const values: Record<string, unknown> = {}
  if (typeof interaction.priority === 'number' && Number.isFinite(interaction.priority)) {
    values.priority = normalizeExamplePriorityValue(interaction.priority)
    values[EXAMPLE_PRIORITY_RAW_KEY] = interaction.priority
  } else if (includeClears) {
    values.priority = null
    values[EXAMPLE_PRIORITY_RAW_KEY] = null
  }
  if (typeof interaction.body === 'string') {
    values.description = interaction.body
  } else if (includeClears) {
    values.description = null
  }
  const severity = interaction.customValues?.severity
  if (typeof severity === 'string' && severity.trim().length > 0) {
    values.severity = normalizeExampleSeverityValue(severity)
    values[EXAMPLE_SEVERITY_RAW_KEY] = normalizeSeverityValue(severity)
  } else if (includeClears) {
    values.severity = null
    values[EXAMPLE_SEVERITY_RAW_KEY] = null
  }
  return values
}

export function buildInteractionUpdateFromExampleTodo(input: {
  title: string | null
  isDone: boolean
  customValues?: Record<string, unknown> | null
  occurredAt?: Date | null
}, options: {
  includeClears?: boolean
} = {}) {
  const severity = input.customValues?.severity
  const priorityRaw = input.customValues?.priority
  const priorityCanonicalRaw = input.customValues?.[EXAMPLE_PRIORITY_RAW_KEY]
  const descriptionRaw = input.customValues?.description
  const severityCanonicalRaw = input.customValues?.[EXAMPLE_SEVERITY_RAW_KEY]
  const includeClears = options.includeClears === true
  const priorityValue = parsePriorityValue(priorityRaw)
  const priorityRawValue = parsePriorityValue(priorityCanonicalRaw)
  const priority =
    priorityValue !== null
      ? priorityRawValue !== null && priorityValue === normalizeExamplePriorityValue(priorityRawValue)
        ? priorityRawValue
        : priorityValue
      : includeClears
        ? null
        : priorityRawValue
  const description =
    typeof descriptionRaw === 'string'
      ? descriptionRaw
      : descriptionRaw == null
        ? null
        : String(descriptionRaw)
  const severityValue = normalizeSeverityValue(severity)
  const severityRawValue = normalizeSeverityValue(severityCanonicalRaw)
  const resolvedSeverity =
    severityValue
      ? severityRawValue && severityValue === normalizeExampleSeverityValue(severityRawValue)
        ? severityRawValue
        : severityValue
      : includeClears
        ? null
        : severityRawValue

  return {
    title: input.title,
    status: input.isDone ? 'done' : 'planned',
    occurredAt: input.isDone ? (input.occurredAt ?? new Date()) : null,
    priority,
    body: description,
    customValues:
      resolvedSeverity !== null
        ? { severity: resolvedSeverity }
        : includeClears
          ? { severity: null }
          : {},
  }
}

export async function findMappingByInteractionId(
  em: EntityManager,
  scope: ExampleCustomersSyncScope,
  interactionId: string,
): Promise<ExampleCustomerInteractionMapping | null> {
  return await findOneWithDecryption(
    em,
    ExampleCustomerInteractionMapping,
    {
      interactionId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )
}

export async function findMappingByTodoId(
  em: EntityManager,
  scope: ExampleCustomersSyncScope,
  todoId: string,
): Promise<ExampleCustomerInteractionMapping | null> {
  return await findOneWithDecryption(
    em,
    ExampleCustomerInteractionMapping,
    {
      todoId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (
      (typeof (error as { code?: unknown }).code === 'string' && (error as { code: string }).code === '23505')
      || (typeof (error as { message?: unknown }).message === 'string'
        && (error as { message: string }).message.toLowerCase().includes('duplicate key'))
    )
  )
}

function applyMappingInput(
  mapping: ExampleCustomerInteractionMapping,
  input: ExampleCustomersSyncMappingInput,
): void {
  mapping.organizationId = input.organizationId
  mapping.tenantId = input.tenantId
  mapping.interactionId = input.interactionId
  mapping.todoId = input.todoId
  mapping.syncStatus = input.syncStatus
  mapping.lastSyncedAt = input.lastSyncedAt ?? null
  mapping.lastError = input.lastError ?? null
  mapping.sourceUpdatedAt = input.sourceUpdatedAt ?? null
}

export async function upsertExampleCustomerInteractionMapping(
  em: EntityManager,
  input: ExampleCustomersSyncMappingInput,
): Promise<{ mapping: ExampleCustomerInteractionMapping; created: boolean }> {
  let mapping =
    await findMappingByInteractionId(em, input, input.interactionId)
    ?? await findMappingByTodoId(em, input, input.todoId)
  const created = !mapping
  if (!mapping) {
    mapping = em.create(ExampleCustomerInteractionMapping, {
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      interactionId: input.interactionId,
      todoId: input.todoId,
      syncStatus: input.syncStatus,
      lastSyncedAt: input.lastSyncedAt ?? null,
      lastError: input.lastError ?? null,
      sourceUpdatedAt: input.sourceUpdatedAt ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(mapping)
  } else {
    applyMappingInput(mapping, input)
  }
  try {
    await em.flush()
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
    em.clear()
    const existing =
      await findMappingByInteractionId(em, input, input.interactionId)
      ?? await findMappingByTodoId(em, input, input.todoId)
    if (!existing) throw error
    applyMappingInput(existing, input)
    await em.flush()
    return { mapping: existing, created: false }
  }
  return { mapping, created }
}

export async function deleteExampleCustomerInteractionMapping(
  em: EntityManager,
  mapping: ExampleCustomerInteractionMapping | null | undefined,
): Promise<boolean> {
  if (!mapping) return false
  await em.removeAndFlush(mapping)
  return true
}
