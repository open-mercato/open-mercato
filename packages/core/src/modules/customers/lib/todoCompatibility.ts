import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type { EntityId } from '@open-mercato/shared/modules/entities'
import { isValidEntityIdShape } from '@open-mercato/shared/lib/query/engine'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import {
  CustomerInteraction,
  CustomerTodoLink,
} from '../data/entities'
import type { InteractionRecord } from './interactionCompatibility'
import {
  CUSTOMER_INTERACTION_TASK_SOURCE,
  CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
  EXAMPLE_TODO_SOURCE,
  resolveExampleIntegrationHref,
} from './interactionCompatibility'
import { hydrateCanonicalInteractions, loadCustomerSummaries } from './interactionReadModel'
import {
  INTERACTION_STATUS_COMPLETED,
  TERMINAL_INTERACTION_STATUS_LIST,
  isOpenInteractionStatus,
} from './interactionStatus'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

export async function countCustomerTodos(
  em: EntityManager,
  scope: { entityId: string; tenantId: string; organizationId: string },
  unified: boolean,
): Promise<number> {
  const entityScope = {
    entity: scope.entityId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
  if (unified) {
    return em.count(CustomerInteraction, { ...entityScope, interactionType: 'task', deletedAt: null })
  }

  const adapterScope = {
    ...entityScope,
    interactionType: 'task',
    source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
  }
  const adapterIds = em.createQueryBuilder(CustomerInteraction).select('id').where(adapterScope)
  const [legacyCount, adapterCount] = await Promise.all([
    em.count(CustomerTodoLink, { ...entityScope, todoId: { $nin: adapterIds } }),
    em.count(CustomerInteraction, { ...adapterScope, deletedAt: null }),
  ])
  return legacyCount + adapterCount
}

export type CustomerTodoRow = {
  id: string
  todoId: string
  todoSource: string
  todoTitle: string | null
  todoIsDone: boolean | null
  todoStatus?: string | null
  todoPriority?: number | null
  todoSeverity?: string | null
  todoDescription?: string | null
  todoDueAt?: string | null
  todoTimezone?: string | null
  todoCustomValues?: Record<string, unknown> | null
  todoOrganizationId: string | null
  todoUpdatedAt?: string | null
  todoOwnerUserId?: string | null
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
  updatedAt: string | null
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

function emptyCanonicalTodoList(): CanonicalTodoListResult {
  return { items: [], bridgeIds: new Set(), total: 0 }
}

function isCollapsedRestrictedOrganizationScope(
  organizationIds: string[] | null | undefined,
  isUnrestricted: boolean | undefined,
): boolean {
  return isUnrestricted !== true && (!organizationIds || organizationIds.length === 0)
}

export type ListTodosPagination = { page: number; pageSize: number }

function resolveLegacyTodoSource(source: string | null | undefined): string {
  return typeof source === 'string' && source.trim().length > 0
    ? source
    : EXAMPLE_TODO_SOURCE
}

function extractTodoTitle(record: Record<string, unknown>): string | null {
  // `task_name` / `taskName` carry a workflow user task's name; the query engine
  // returns the raw column on the ORM path and the camelCase property on the
  // indexed one, so both spellings are read.
  const candidates = ['title', 'subject', 'name', 'task_name', 'taskName', 'summary', 'text', 'description']
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

export type TodoStatusFilter = 'open' | 'done'

export type TodoListFilters = {
  status?: TodoStatusFilter | null
  dueFrom?: Date | null
  dueBefore?: Date | null
  priorityMin?: number | null
  priorityMax?: number | null
  ownerUserId?: string | null
}

export type TodoSortField = 'createdAt' | 'dueAt' | 'priority'

export type TodoListSort = { field: TodoSortField; dir: 'asc' | 'desc' }

const DEFAULT_TODO_SORT: TodoListSort = { field: 'createdAt', dir: 'desc' }

const COMPLETED_TODO_STATUSES: readonly string[] = [INTERACTION_STATUS_COMPLETED, 'completed']

export function hasActiveTodoListFilters(filters: TodoListFilters | null | undefined): filters is TodoListFilters {
  if (!filters) return false
  return Boolean(
    filters.status ||
      filters.dueFrom ||
      filters.dueBefore ||
      filters.ownerUserId ||
      typeof filters.priorityMin === 'number' ||
      typeof filters.priorityMax === 'number',
  )
}

function readTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

function compareNullableNumbers(left: number | null, right: number | null, dir: 'asc' | 'desc'): number {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return dir === 'asc' ? left - right : right - left
}

type TodoSortKey = { id: string; createdAt: number; dueAt: number | null; priority: number | null }

function todoRowSortKey(row: CustomerTodoRow): TodoSortKey {
  return {
    id: row.id,
    createdAt: new Date(row.createdAt).getTime(),
    dueAt: readTimestamp(row.todoDueAt),
    priority: row.todoPriority ?? null,
  }
}

function compareTodoSortKeys(left: TodoSortKey, right: TodoSortKey, sort: TodoListSort): number {
  if (sort.field === 'dueAt') {
    const byDue = compareNullableNumbers(left.dueAt, right.dueAt, sort.dir)
    if (byDue !== 0) return byDue
  } else if (sort.field === 'priority') {
    const byPriority = compareNullableNumbers(left.priority, right.priority, sort.dir)
    if (byPriority !== 0) return byPriority
  }
  const createdDir = sort.field === 'createdAt' ? sort.dir : 'desc'
  if (left.createdAt === right.createdAt) {
    return createdDir === 'asc' ? left.id.localeCompare(right.id) : right.id.localeCompare(left.id)
  }
  return createdDir === 'asc' ? left.createdAt - right.createdAt : right.createdAt - left.createdAt
}

export function sortTodoRows(rows: CustomerTodoRow[], sort: TodoListSort = DEFAULT_TODO_SORT): CustomerTodoRow[] {
  return [...rows].sort((left, right) => compareTodoSortKeys(todoRowSortKey(left), todoRowSortKey(right), sort))
}

function matchesTodoStatus(row: CustomerTodoRow, status: TodoStatusFilter): boolean {
  const isCanonical = typeof row.todoStatus === 'string' && row.todoStatus.length > 0
  if (status === 'done') {
    return isCanonical ? COMPLETED_TODO_STATUSES.includes(row.todoStatus as string) : row.todoIsDone === true
  }
  return isCanonical ? isOpenInteractionStatus(row.todoStatus) : row.todoIsDone !== true
}

export function filterTodoRowsByCriteria(
  rows: CustomerTodoRow[],
  filters: TodoListFilters | null | undefined,
): CustomerTodoRow[] {
  if (!hasActiveTodoListFilters(filters)) return rows
  const dueFrom = filters.dueFrom ? filters.dueFrom.getTime() : null
  const dueBefore = filters.dueBefore ? filters.dueBefore.getTime() : null
  const hasPriorityRange = typeof filters.priorityMin === 'number' || typeof filters.priorityMax === 'number'
  return rows.filter((row) => {
    if (filters.status && !matchesTodoStatus(row, filters.status)) return false
    if (dueFrom !== null || dueBefore !== null) {
      const due = readTimestamp(row.todoDueAt)
      if (due === null) return false
      if (dueFrom !== null && due < dueFrom) return false
      if (dueBefore !== null && due >= dueBefore) return false
    }
    if (hasPriorityRange) {
      const priority = row.todoPriority ?? null
      if (priority === null) return false
      if (typeof filters.priorityMin === 'number' && priority < filters.priorityMin) return false
      if (typeof filters.priorityMax === 'number' && priority > filters.priorityMax) return false
    }
    if (filters.ownerUserId && row.todoOwnerUserId !== filters.ownerUserId) return false
    return true
  })
}

function buildCanonicalTodoFilterConditions(filters: TodoListFilters | null | undefined): Record<string, unknown>[] {
  if (!hasActiveTodoListFilters(filters)) return []
  const conditions: Record<string, unknown>[] = []
  if (filters.status === 'done') {
    conditions.push({ status: { $in: [...COMPLETED_TODO_STATUSES] } })
  } else if (filters.status === 'open') {
    conditions.push({ $or: [{ status: null }, { status: { $nin: [...TERMINAL_INTERACTION_STATUS_LIST] } }] })
  }
  if (filters.dueFrom) conditions.push({ scheduledAt: { $gte: filters.dueFrom } })
  if (filters.dueBefore) conditions.push({ scheduledAt: { $lt: filters.dueBefore } })
  if (typeof filters.priorityMin === 'number') conditions.push({ priority: { $gte: filters.priorityMin } })
  if (typeof filters.priorityMax === 'number') conditions.push({ priority: { $lte: filters.priorityMax } })
  if (filters.ownerUserId) conditions.push({ ownerUserId: filters.ownerUserId })
  return conditions
}

function buildCanonicalTodoOrderBy(sort: TodoListSort | null | undefined): Record<string, string> {
  const resolved = sort ?? DEFAULT_TODO_SORT
  const direction = resolved.dir === 'asc' ? 'ASC' : 'DESC'
  if (resolved.field === 'dueAt') {
    return { scheduledAt: `${direction} NULLS LAST`, createdAt: 'DESC', id: 'DESC' }
  }
  if (resolved.field === 'priority') {
    return { priority: `${direction} NULLS LAST`, createdAt: 'DESC', id: 'DESC' }
  }
  return { createdAt: resolved.dir }
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
    if (!isValidEntityIdShape(source)) {
      // A legacy/malformed `todoSource` (e.g. a bare module name written before
      // the value was required to be a `module:entity` id) does not resolve to
      // any real table. Querying it anyway surfaces a raw DB error ("relation
      // ... does not exist") as a dashboard-wide schema-mismatch banner instead
      // of just leaving that row's details unresolved.
      logger.warn('Skipping malformed legacy todo source', { component: 'todoCompatibility', source })
      continue
    }
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

        const updatedAt = (() => {
          const candidates = [record.updated_at, record.updatedAt]
          for (const candidate of candidates) {
            const parsed = parseDateValue(candidate)
            if (parsed) return parsed
          }
          return null
        })()

        details.set(`${source}:${rawId}`, {
          title: extractTodoTitle(record),
          isDone,
          priority,
          severity,
          description,
          dueAt,
          organizationId,
          updatedAt,
          customValues: Object.keys(customValues).length > 0 ? customValues : null,
        })
      }
    } catch (err) {
      logger.warn('Failed to resolve todo details', { component: 'todoCompatibility', source, err })
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
  options?: { limit?: number | null; isUnrestricted?: boolean; excludeBridged?: boolean },
): Promise<CustomerTodoRow[]> {
  if (isCollapsedRestrictedOrganizationScope(organizationIds, options?.isUnrestricted)) {
    return []
  }
  const where: Record<string, unknown> = { tenantId }
  if (organizationIds && organizationIds.length > 0) {
    where.organizationId = { $in: organizationIds }
  }
  if (entityId) {
    where.entity = entityId
  }
  if (options?.excludeBridged) {
    where.todoId = {
      $nin: em
        .createQueryBuilder(CustomerInteraction)
        .select('id')
        .where({ tenantId, interactionType: 'task' }),
    }
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

type CanonicalTodoQueryOptions = {
  entityId?: string
  includeDeleted?: boolean
  source?: string | string[] | null
  searchText?: string | null
  filters?: TodoListFilters | null
}

function buildCanonicalTodoWhere(
  tenantId: string | null,
  organizationIds: string[] | null,
  options?: CanonicalTodoQueryOptions,
): Record<string, unknown> {
  const where: Record<string, unknown> = {
    tenantId,
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
  const filterConditions = buildCanonicalTodoFilterConditions(options?.filters)
  if (filterConditions.length > 0) {
    where.$and = filterConditions
  }
  return where
}

async function hydrateCanonicalTodoRows(
  em: EntityManager,
  container: CustomersContainerLike,
  auth: CustomersAuthLike,
  selectedOrganizationId: string | null,
  interactions: CustomerInteraction[],
): Promise<Map<string, CustomerTodoRow>> {
  const groups = new Map<string, CustomerInteraction[]>()

  for (const interaction of interactions) {
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

  return rowByInteractionId
}

export async function listCanonicalTodoRows(
  em: EntityManager,
  container: CustomersContainerLike,
  auth: CustomersAuthLike,
  selectedOrganizationId: string | null,
  organizationIds: string[] | null,
  options?: CanonicalTodoQueryOptions & {
    pagination?: ListTodosPagination | null
    limit?: number | null
    isUnrestricted?: boolean
    sort?: TodoListSort | null
  },
): Promise<CanonicalTodoListResult> {
  if (isCollapsedRestrictedOrganizationScope(organizationIds, options?.isUnrestricted)) {
    return emptyCanonicalTodoList()
  }
  const where = buildCanonicalTodoWhere(auth.tenantId, organizationIds, options)

  const findOptions: Record<string, unknown> = {
    orderBy: buildCanonicalTodoOrderBy(options?.sort),
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
  const rowByInteractionId = await hydrateCanonicalTodoRows(
    em,
    container,
    auth,
    selectedOrganizationId,
    activeInteractions,
  )

  return {
    items: activeInteractions
      .map((interaction) => rowByInteractionId.get(interaction.id) ?? null)
      .filter((row): row is CustomerTodoRow => !!row),
    bridgeIds: new Set(interactions.map((interaction) => interaction.id)),
    total,
  }
}

export const MERGED_TODO_FETCH_CAP = 2000

export type MergedTodoListOptions = {
  entityId?: string
  filters?: TodoListFilters | null
  sort?: TodoListSort | null
  search?: string | null
  pagination: ListTodosPagination | null
  isUnrestricted?: boolean
  fetchCap?: number
  includeLegacy?: boolean
}

export type MergedTodoListResult = {
  items: CustomerTodoRow[]
  total: number
  totalIsCapped: boolean
}

type MergeCandidate =
  | { kind: 'legacy'; key: TodoSortKey; row: CustomerTodoRow }
  | { kind: 'canonical'; key: TodoSortKey; interaction: CustomerInteraction }

function interactionSortKey(interaction: CustomerInteraction): TodoSortKey {
  return {
    id: interaction.id,
    createdAt: interaction.createdAt instanceof Date ? interaction.createdAt.getTime() : new Date(interaction.createdAt).getTime(),
    dueAt: interaction.scheduledAt ? new Date(interaction.scheduledAt).getTime() : null,
    priority: typeof interaction.priority === 'number' ? interaction.priority : null,
  }
}

/**
 * Task list over native CRM tasks plus, in compatibility mode, the legacy todo
 * links that no canonical interaction bridges (`includeLegacy: false` skips them). Criteria and ordering are applied before the
 * page window so a matching row is never lost to a recency window. Canonical
 * filters and sort run in SQL; free-text search stays in memory because task
 * titles and bodies may be encrypted at rest, and reads at most `fetchCap`
 * candidates per source (reported through `totalIsCapped`).
 */
export async function listMergedTodoRows(
  em: EntityManager,
  queryEngine: QueryEngine,
  container: CustomersContainerLike,
  auth: CustomersAuthLike,
  selectedOrganizationId: string | null,
  organizationIds: string[] | null,
  options: MergedTodoListOptions,
): Promise<MergedTodoListResult> {
  if (isCollapsedRestrictedOrganizationScope(organizationIds, options.isUnrestricted)) {
    return { items: [], total: 0, totalIsCapped: false }
  }
  const fetchCap = options.fetchCap ?? MERGED_TODO_FETCH_CAP
  const sort = options.sort ?? DEFAULT_TODO_SORT
  const search = options.search ?? null
  const pagination = options.pagination
  const offset = pagination ? Math.max(0, (pagination.page - 1) * pagination.pageSize) : 0

  const legacyRows = options.includeLegacy === false
    ? []
    : await listLegacyTodoRows(em, queryEngine, auth.tenantId ?? '', organizationIds, options.entityId, {
        limit: fetchCap,
        isUnrestricted: options.isUnrestricted,
        excludeBridged: true,
      })
  const legacyMatches = filterTodoRowsByCriteria(filterTodoRows(legacyRows, search), options.filters)
  const legacyCapped = legacyRows.length >= fetchCap

  const where = buildCanonicalTodoWhere(auth.tenantId, organizationIds, {
    entityId: options.entityId,
    filters: options.filters,
  })
  const orderBy = buildCanonicalTodoOrderBy(sort)

  if (search) {
    const candidates = await em.find(CustomerInteraction, where, { orderBy, limit: fetchCap } as any)
    const rowById = await hydrateCanonicalTodoRows(em, container, auth, selectedOrganizationId, candidates)
    const canonicalMatches = filterTodoRows(
      candidates
        .map((interaction) => rowById.get(interaction.id) ?? null)
        .filter((row): row is CustomerTodoRow => !!row),
      search,
    )
    const ordered = sortTodoRows([...legacyMatches, ...canonicalMatches], sort)
    return {
      items: pagination ? ordered.slice(offset, offset + pagination.pageSize) : ordered,
      total: ordered.length,
      totalIsCapped: legacyCapped || candidates.length >= fetchCap,
    }
  }

  let canonicalCandidates: CustomerInteraction[]
  let canonicalTotal: number
  if (pagination) {
    const [rows, count] = await em.findAndCount(
      CustomerInteraction,
      where,
      { orderBy, limit: offset + pagination.pageSize } as any,
    )
    canonicalCandidates = rows
    canonicalTotal = count
  } else {
    canonicalCandidates = await em.find(CustomerInteraction, where, { orderBy } as any)
    canonicalTotal = canonicalCandidates.length
  }

  const merged: MergeCandidate[] = [
    ...legacyMatches.map((row): MergeCandidate => ({ kind: 'legacy', key: todoRowSortKey(row), row })),
    ...canonicalCandidates.map((interaction): MergeCandidate => ({
      kind: 'canonical',
      key: interactionSortKey(interaction),
      interaction,
    })),
  ].sort((left, right) => compareTodoSortKeys(left.key, right.key, sort))
  const window = pagination ? merged.slice(offset, offset + pagination.pageSize) : merged

  const pageInteractions = window
    .filter((candidate): candidate is Extract<MergeCandidate, { kind: 'canonical' }> => candidate.kind === 'canonical')
    .map((candidate) => candidate.interaction)
  const rowById = await hydrateCanonicalTodoRows(em, container, auth, selectedOrganizationId, pageInteractions)

  return {
    items: window
      .map((candidate) => (candidate.kind === 'legacy' ? candidate.row : rowById.get(candidate.interaction.id) ?? null))
      .filter((row): row is CustomerTodoRow => !!row),
    total: canonicalTotal + legacyMatches.length,
    totalIsCapped: legacyCapped,
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
    todoUpdatedAt: detail?.updatedAt ?? null,
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
    todoStatus: interaction.status,
    todoPriority: interaction.priority ?? null,
    todoSeverity:
      typeof customValues.severity === 'string' && customValues.severity.trim().length > 0
        ? customValues.severity.trim()
        : null,
    todoDescription: interaction.body ?? null,
    todoDueAt: interaction.scheduledAt ?? null,
    todoTimezone: interaction.timezone ?? null,
    todoCustomValues: Object.keys(customValues).length > 0 ? customValues : null,
    todoOrganizationId: interaction.organizationId ?? null,
    todoUpdatedAt: interaction.updatedAt ?? null,
    todoOwnerUserId: interaction.ownerUserId ?? null,
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
