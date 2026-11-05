import type { AdvancedFilterTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { createEmptyTree, makeMultiRuleTree } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import {
  deserializeAdvancedFilter,
  deserializeTree,
  flatToTree,
  serializeTree,
  type FilterOperator,
} from '@open-mercato/shared/lib/query/advanced-filter'
import { CLOSED_DEAL_STATUS_LIST, expandDealStatusAliases } from './dealStatus'
import type { DealTimelineFilters } from './dealsTimelineTypes'

export const DEALS_LIST_PATH = '/backend/customers/deals'

export type DealsListHrefFilters = Partial<DealTimelineFilters> & {
  hasExpectedCloseAt?: boolean
  closeDateRange?: { from: string; to: string }
}

export type DealsListUrlState = {
  search: string
  personIds: string[]
  companyIds: string[]
  needsAttention: boolean
  hasExpectedCloseAt: boolean | null
  filterTree: AdvancedFilterTree
}

type FilterRuleInput = { field: string; operator: FilterOperator; value: unknown }

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string | null | undefined): value is string {
  if (!value) return false
  return UUID_REGEX.test(value.trim())
}

function normalizeIdCandidates(raw: Array<string>): string[] {
  const set = new Set<string>()
  raw.forEach((candidate) => {
    candidate
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .forEach((part) => {
        if (isUuid(part)) set.add(part)
      })
  })
  return Array.from(set)
}

export function extractDealListIdsFromParams(params: URLSearchParams | null | undefined, key: string): string[] {
  if (!params) return []
  return normalizeIdCandidates(params.getAll(key))
}

export function readDealListFilterTreeFromParams(params: URLSearchParams | null | undefined): AdvancedFilterTree {
  if (!params) return createEmptyTree()
  const record: Record<string, string> = {}
  params.forEach((value, key) => {
    if (key.startsWith('filter[')) record[key] = value
  })
  const tree = deserializeTree(record)
  if (tree) return tree
  const flat = deserializeAdvancedFilter(record)
  if (flat) return flatToTree(flat)
  return createEmptyTree()
}

export function readHasExpectedCloseAtParam(params: URLSearchParams | null | undefined): boolean | null {
  const raw = params?.get('hasExpectedCloseAt')
  if (raw === 'true') return true
  if (raw === 'false') return false
  return null
}

export function readDealsListUrlState(params: URLSearchParams | null | undefined): DealsListUrlState {
  return {
    search: params?.get('search')?.trim() ?? '',
    personIds: extractDealListIdsFromParams(params, 'personId'),
    companyIds: extractDealListIdsFromParams(params, 'companyId'),
    needsAttention: params?.get('needsAttention') === 'true',
    hasExpectedCloseAt: readHasExpectedCloseAtParam(params),
    filterTree: readDealListFilterTreeFromParams(params),
  }
}

export function closedDealStatusFilterValues(): string[] {
  return expandDealStatusAliases([...CLOSED_DEAL_STATUS_LIST])
}

function uniqueNonEmpty(values: readonly string[] | null | undefined): string[] {
  if (!values) return []
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)))
}

export function buildDealsListFilterRules(filters: DealsListHrefFilters): FilterRuleInput[] {
  const rules: FilterRuleInput[] = []
  const statuses = uniqueNonEmpty(filters.status)
  if (statuses.length) {
    rules.push({ field: 'status', operator: 'is_any_of', value: expandDealStatusAliases(statuses) })
  } else if (filters.excludeClosed !== false) {
    rules.push({ field: 'status', operator: 'is_none_of', value: closedDealStatusFilterValues() })
  }
  const owners = uniqueNonEmpty(filters.ownerUserId)
  if (owners.length) rules.push({ field: 'owner_user_id', operator: 'is_any_of', value: owners })
  const pipelineId = typeof filters.pipelineId === 'string' ? filters.pipelineId.trim() : ''
  if (pipelineId) rules.push({ field: 'pipeline_id', operator: 'is_any_of', value: [pipelineId] })
  if (filters.closeDateRange) {
    const { from, to } = filters.closeDateRange
    rules.push({ field: 'expected_close_at', operator: 'between', value: [from, to] })
    rules.push({ field: 'expected_close_at', operator: 'is_before', value: to })
  }
  return rules
}

export function buildDealsListHref(filters: DealsListHrefFilters): string {
  const params = new URLSearchParams()
  const search = filters.search?.trim()
  if (search) params.set('search', search)
  uniqueNonEmpty(filters.personId).forEach((id) => params.append('personId', id))
  uniqueNonEmpty(filters.companyId).forEach((id) => params.append('companyId', id))
  if (typeof filters.hasExpectedCloseAt === 'boolean') {
    params.set('hasExpectedCloseAt', filters.hasExpectedCloseAt ? 'true' : 'false')
  }
  const rules = buildDealsListFilterRules(filters)
  if (rules.length) {
    for (const [key, value] of Object.entries(serializeTree(makeMultiRuleTree(rules)))) {
      params.set(key, value)
    }
  }
  const query = params.toString()
  return query ? `${DEALS_LIST_PATH}?${query}` : DEALS_LIST_PATH
}
