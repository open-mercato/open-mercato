import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import type { CustomerTodoLink } from '../data/entities'
import type { InteractionRecord } from './interactionCompatibility'
import { CUSTOMER_INTERACTION_TASK_SOURCE } from './interactionCompatibility'

export type CustomerTodoRow = {
  id: string
  todoId: string
  todoSource: string
  todoTitle: string | null
  todoIsDone: boolean | null
  todoPriority?: number | null
  todoSeverity?: string | null
  todoDescription?: string | null
  todoDueAt?: string | null
  todoCustomValues?: Record<string, unknown> | null
  todoOrganizationId: string | null
  organizationId: string
  tenantId: string
  createdAt: string
  customer: {
    id: string | null
    displayName: string | null
    kind: string | null
  }
}

export type LegacyTodoDetail = {
  title: string | null
  isDone: boolean | null
  priority: number | null
  severity: string | null
  description: string | null
  dueAt: string | null
  organizationId: string | null
  customValues: Record<string, unknown> | null
}

type CustomerSummary = {
  id: string | null
  displayName: string | null
  kind: string | null
}

function extractTodoTitle(record: Record<string, unknown>): string | null {
  const candidates = ['title', 'subject', 'name', 'summary', 'text', 'description']
  for (const key of candidates) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return null
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) return null
    const parsed = Number(trimmed)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

function parseDateValue(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.length) return null
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function readCustomField(record: Record<string, unknown>, key: string): unknown {
  const custom = record.custom ?? record.customFields ?? record.cf
  if (custom && typeof custom === 'object') {
    const bucket = custom as Record<string, unknown>
    if (key in bucket) return bucket[key]
  }
  return undefined
}

export async function resolveLegacyTodoDetails(
  queryEngine: QueryEngine,
  links: CustomerTodoLink[],
  tenantId: string | null,
  organizationIds: Array<string | null>,
): Promise<Map<string, LegacyTodoDetail>> {
  const details = new Map<string, LegacyTodoDetail>()
  if (!links.length || !tenantId) return details

  const scopedOrganizationIds = organizationIds.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  )

  const idsBySource = new Map<string, Set<string>>()
  for (const link of links) {
    const source =
      typeof link.todoSource === 'string' && link.todoSource.trim().length > 0
        ? link.todoSource
        : 'example:todo'
    const id =
      typeof link.todoId === 'string' && link.todoId.trim().length > 0
        ? link.todoId
        : String(link.todoId ?? '')
    if (!id) continue
    if (!idsBySource.has(source)) idsBySource.set(source, new Set<string>())
    idsBySource.get(source)!.add(id)
  }

  for (const [source, idSet] of idsBySource.entries()) {
    const ids = Array.from(idSet)
    if (!ids.length) continue
    try {
      const result = await queryEngine.query<Record<string, unknown>>(source as EntityId, {
        tenantId,
        organizationIds: scopedOrganizationIds.length > 0 ? scopedOrganizationIds : undefined,
        filters: { id: { $in: ids } },
        includeCustomFields: ['priority', 'due_at', 'severity', 'description'],
        page: { page: 1, pageSize: Math.max(ids.length, 1) },
      })

      for (const item of result.items ?? []) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        const rawId =
          typeof record.id === 'string' && record.id.trim().length > 0
            ? record.id
            : String(record.id ?? '')
        if (!rawId) continue

        const isDone = (() => {
          const direct = parseBooleanFromUnknown(record.is_done)
          if (direct !== null) return direct
          const custom = parseBooleanFromUnknown(readCustomField(record, 'is_done'))
          if (custom !== null) return custom
          const generic = parseBooleanFromUnknown(record.isDone)
          if (generic !== null) return generic
          return parseBooleanFromUnknown(readCustomField(record, 'isDone'))
        })()

        const priority = (() => {
          const candidates = [
            record['cf:priority'],
            record['cf_priority'],
            record.priority,
            readCustomField(record, 'priority'),
          ]
          for (const candidate of candidates) {
            const parsed = parseNumber(candidate)
            if (parsed !== null) return parsed
          }
          return null
        })()

        const severity = (() => {
          const candidates = [
            record['cf:severity'],
            record['cf_severity'],
            record.severity,
            readCustomField(record, 'severity'),
          ]
          for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
              return candidate.trim()
            }
          }
          return null
        })()

        const description = (() => {
          const candidates = [
            record.description,
            record['cf:description'],
            record['cf_description'],
            readCustomField(record, 'description'),
          ]
          for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
              return candidate.trim()
            }
          }
          return null
        })()

        const dueAt = (() => {
          const candidates = [
            record.due_at,
            record.dueAt,
            record['cf:due_at'],
            record['cf_due_at'],
            readCustomField(record, 'due_at'),
            readCustomField(record, 'dueAt'),
          ]
          for (const candidate of candidates) {
            const parsed = parseDateValue(candidate)
            if (parsed) return parsed
          }
          return null
        })()

        const organizationId = (() => {
          const candidates = [
            record.organization_id,
            record.organizationId,
            record['cf:organization_id'],
            record['cf_organization_id'],
            readCustomField(record, 'organization_id'),
            readCustomField(record, 'organizationId'),
          ]
          for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
              return candidate.trim()
            }
          }
          return null
        })()

        const customValues: Record<string, unknown> = {}
        const assignCustomValue = (key: string, value: unknown) => {
          const trimmedKey = key.trim()
          if (!trimmedKey.length) return
          customValues[trimmedKey] = value === undefined ? null : value
        }
        for (const [rawKey, rawValue] of Object.entries(record)) {
          if (rawKey.startsWith('cf:')) {
            assignCustomValue(rawKey.slice(3), rawValue)
          } else if (rawKey.startsWith('cf_')) {
            assignCustomValue(rawKey.slice(3), rawValue)
          }
        }
        const nestedCustom = record.custom ?? record.customFields ?? record.cf
        if (nestedCustom && typeof nestedCustom === 'object') {
          for (const [key, value] of Object.entries(nestedCustom as Record<string, unknown>)) {
            assignCustomValue(key, value)
          }
        }

        details.set(`${source}:${rawId}`, {
          title: extractTodoTitle(record),
          isDone,
          priority,
          severity,
          description,
          dueAt,
          organizationId,
          customValues: Object.keys(customValues).length > 0 ? customValues : null,
        })
      }
    } catch (err) {
      console.warn(`[customers.todoCompatibility] Failed to resolve details for source="${source}"`, err)
      continue
    }
  }

  return details
}

export function mapLegacyTodoLinkToRow(
  link: CustomerTodoLink,
  detail: LegacyTodoDetail | null,
  customerOverride?: CustomerSummary | null,
): CustomerTodoRow {
  const entity = customerOverride ?? {
    id: typeof link.entity === 'string' ? null : link.entity.id,
    displayName: typeof link.entity === 'string' ? null : link.entity.displayName ?? null,
    kind: typeof link.entity === 'string' ? null : link.entity.kind ?? null,
  }

  return {
    id: link.id,
    todoId: link.todoId,
    todoSource:
      typeof link.todoSource === 'string' && link.todoSource.trim().length > 0
        ? link.todoSource
        : 'example:todo',
    todoTitle: detail?.title ?? null,
    todoIsDone: detail?.isDone ?? null,
    todoPriority: detail?.priority ?? null,
    todoSeverity: detail?.severity ?? null,
    todoDescription: detail?.description ?? null,
    todoDueAt: detail?.dueAt ?? null,
    todoCustomValues: detail?.customValues ?? null,
    todoOrganizationId: detail?.organizationId ?? link.organizationId ?? null,
    organizationId: link.organizationId,
    tenantId: link.tenantId,
    createdAt: link.createdAt.toISOString(),
    customer: entity,
  }
}

export function mapInteractionRecordToTodoRow(
  interaction: InteractionRecord,
  customer: CustomerSummary | null,
  options?: { rowId?: string | null; todoSource?: string | null },
): CustomerTodoRow {
  const customValues: Record<string, unknown> = { ...(interaction.customValues ?? {}) }
  if (interaction.priority !== undefined && customValues.priority === undefined) {
    customValues.priority = interaction.priority ?? null
  }
  if (interaction.body !== undefined && customValues.description === undefined) {
    customValues.description = interaction.body ?? null
  }
  if (interaction.scheduledAt !== undefined && customValues.due_at === undefined) {
    customValues.due_at = interaction.scheduledAt ?? null
  }

  return {
    id:
      typeof options?.rowId === 'string' && options.rowId.trim().length > 0
        ? options.rowId
        : interaction.id,
    todoId: interaction.id,
    todoSource:
      typeof options?.todoSource === 'string' && options.todoSource.trim().length > 0
        ? options.todoSource
        : CUSTOMER_INTERACTION_TASK_SOURCE,
    todoTitle: interaction.title ?? null,
    todoIsDone: interaction.status === 'done',
    todoPriority: interaction.priority ?? null,
    todoSeverity:
      typeof customValues.severity === 'string' && customValues.severity.trim().length > 0
        ? customValues.severity.trim()
        : null,
    todoDescription: interaction.body ?? null,
    todoDueAt: interaction.scheduledAt ?? null,
    todoCustomValues: Object.keys(customValues).length > 0 ? customValues : null,
    todoOrganizationId: interaction.organizationId ?? null,
    organizationId: interaction.organizationId ?? '',
    tenantId: interaction.tenantId ?? '',
    createdAt: interaction.createdAt,
    customer: customer ?? {
      id: interaction.entityId ?? null,
      displayName: null,
      kind: null,
    },
  }
}
