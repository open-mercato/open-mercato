import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import {
  CustomerInteraction,
  CustomerTodoLink,
} from '../data/entities'
import type { InteractionRecord } from './interactionCompatibility'
import {
  CUSTOMER_INTERACTION_TASK_SOURCE,
  EXAMPLE_TODO_SOURCE,
  resolveExampleIntegrationHref,
} from './interactionCompatibility'
import { hydrateCanonicalInteractions, loadCustomerSummaries } from './interactionReadModel'

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
  externalHref?: string | null
  _integrations?: Record<string, unknown>
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

type CustomersAuthLike = {
  tenantId: string | null
  orgId?: string | null
  sub?: string | null
  userId?: string | null
  keyId?: string | null
}

type CustomersContainerLike = {
  resolve: (name: string) => unknown
}

export type CanonicalTodoListResult = {
  items: CustomerTodoRow[]
  bridgeIds: Set<string>
  total: number
}

export type ListTodosPagination = { page: number; pageSize: number }

function resolveLegacyTodoSource(source: string | null | undefined): string {
  return typeof source === 'string' && source.trim().length > 0
    ? source
    : EXAMPLE_TODO_SOURCE
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

export function normalizeTodoSearch(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

export function sortTodoRows(rows: CustomerTodoRow[]): CustomerTodoRow[] {
  return [...rows].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime()
    const rightTime = new Date(right.createdAt).getTime()
    if (leftTime === rightTime) {
      return right.id.localeCompare(left.id)
    }
    return rightTime - leftTime
  })
}

export function filterTodoRows(rows: CustomerTodoRow[], search: string | null): CustomerTodoRow[] {
  if (!search) return rows
  return rows.filter((row) => {
    const haystack = [
      row.customer.displayName,
      row.todoTitle,
      row.todoDescription,
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .toLowerCase()
    return haystack.includes(search)
  })
}

export function paginateTodoRows(
  rows: CustomerTodoRow[],
  page: number,
  pageSize: number,
  exportAll: boolean,
): { items: CustomerTodoRow[]; total: number; page: number; pageSize: number; totalPages: number } {
  const total = rows.length
  if (exportAll) {
    return {
      items: rows,
      total,
      page: 1,
      pageSize: total,
      totalPages: 1,
    }
  }
  const start = (page - 1) * pageSize
  return {
    items: rows.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
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
    const source = resolveLegacyTodoSource(link.todoSource)
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

export async function listLegacyTodoRows(
  em: EntityManager,
  queryEngine: QueryEngine,
  tenantId: string,
  organizationIds: string[] | null,
  entityId: string | undefined,
  options?: { limit?: number | null },
): Promise<CustomerTodoRow[]> {
  const where: Record<string, unknown> = { tenantId }
  if (organizationIds && organizationIds.length > 0) {
    where.organizationId = { $in: organizationIds }
  }
  if (entityId) {
    where.entity = entityId
  }

  const findOptions: Record<string, unknown> = {
    populate: ['entity'],
    orderBy: { createdAt: 'desc' },
  }
  if (typeof options?.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    findOptions.limit = options.limit
  }

  const links = await em.find(CustomerTodoLink, where, findOptions as any)
  const details = await resolveLegacyTodoDetails(
    queryEngine,
    links,
    tenantId,
    organizationIds ?? [],
  )

  return links.map((link) => {
    const source = resolveLegacyTodoSource(link.todoSource)
    return mapLegacyTodoLinkToRow(
      link,
      details.get(`${source}:${link.todoId}`) ?? null,
    )
  })
}

export async function listCanonicalTodoRows(
  em: EntityManager,
  container: CustomersContainerLike,
  auth: CustomersAuthLike,
  selectedOrganizationId: string | null,
  organizationIds: string[] | null,
  options?: {
    entityId?: string
    includeDeleted?: boolean
    source?: string | string[] | null
    pagination?: ListTodosPagination | null
    searchText?: string | null
    limit?: number | null
  },
): Promise<CanonicalTodoListResult> {
  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    interactionType: 'task',
  }
  if (!options?.includeDeleted) {
    where.deletedAt = null
  }
  if (organizationIds && organizationIds.length > 0) {
    where.organizationId = { $in: organizationIds }
  }
  if (options?.entityId) {
    where.entity = options.entityId
  }
  if (options?.source) {
    where.source = Array.isArray(options.source) ? { $in: options.source } : options.source
  }
  const trimmedSearch =
    typeof options?.searchText === 'string' ? options.searchText.trim() : ''
  if (trimmedSearch.length > 0) {
    const pattern = `%${trimmedSearch}%`
    where.$or = [
      { title: { $ilike: pattern } },
      { body: { $ilike: pattern } },
    ]
  }

  const findOptions: Record<string, unknown> = {
    orderBy: { createdAt: 'desc' },
  }
  const pagination = options?.pagination ?? null
  if (pagination) {
    findOptions.offset = Math.max(0, (pagination.page - 1) * pagination.pageSize)
    findOptions.limit = pagination.pageSize
  } else if (
    typeof options?.limit === 'number' &&
    Number.isFinite(options.limit) &&
    options.limit > 0
  ) {
    findOptions.limit = options.limit
  }

  let interactions: CustomerInteraction[]
  let total: number
  if (pagination) {
    const [rows, count] = await em.findAndCount(CustomerInteraction, where, findOptions as any)
    interactions = rows
    total = count
  } else {
    interactions = await em.find(CustomerInteraction, where, findOptions as any)
    total = interactions.filter((interaction) => !interaction.deletedAt).length
  }
  const activeInteractions = interactions.filter((interaction) => !interaction.deletedAt)
  const groups = new Map<string, CustomerInteraction[]>()

  for (const interaction of activeInteractions) {
    const organizationId =
      typeof interaction.organizationId === 'string' && interaction.organizationId.trim().length > 0
        ? interaction.organizationId
        : selectedOrganizationId ?? ''
    const bucket = groups.get(organizationId)
    if (bucket) {
      bucket.push(interaction)
    } else {
      groups.set(organizationId, [interaction])
    }
  }

  const rowByInteractionId = new Map<string, CustomerTodoRow>()

  for (const [groupOrganizationId, groupedInteractions] of groups.entries()) {
    const scopedOrganizationId = groupOrganizationId.length > 0 ? groupOrganizationId : null
    const hydrated = await hydrateCanonicalInteractions({
      em,
      container,
      auth: {
        ...auth,
        orgId: auth.orgId ?? null,
      },
      selectedOrganizationId: scopedOrganizationId,
      interactions: groupedInteractions,
    })
    const customerIds = Array.from(
      new Set(
        hydrated
          .map((interaction) => interaction.entityId ?? null)
          .filter((value): value is string => !!value),
      ),
    )
    const customerSummaries = await loadCustomerSummaries(
      em,
      customerIds,
      auth.tenantId,
      scopedOrganizationId,
    )

    for (const interaction of hydrated) {
      rowByInteractionId.set(
        interaction.id,
        mapInteractionRecordToTodoRow(
          interaction,
          interaction.entityId ? customerSummaries.get(interaction.entityId) ?? null : null,
        ),
      )
    }
  }

  return {
    items: activeInteractions
      .map((interaction) => rowByInteractionId.get(interaction.id) ?? null)
      .filter((row): row is CustomerTodoRow => !!row),
    bridgeIds: new Set(interactions.map((interaction) => interaction.id)),
    total,
  }
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
    todoSource: resolveLegacyTodoSource(link.todoSource),
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
    _integrations: undefined,
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
    externalHref: resolveExampleIntegrationHref(interaction),
    _integrations: interaction._integrations ?? undefined,
    customer: customer ?? {
      id: interaction.entityId ?? null,
      displayName: null,
      kind: null,
    },
  }
}
