import type { SortingState } from '@tanstack/react-table'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'

/**
 * Every freight list route falls back to `id asc` when no sort is sent, which
 * reads as a random order to an operator. The builders below therefore always
 * emit an explicit `sortField`/`sortDir` on the first render — the one thing
 * that keeps the grids deterministic. Filter keys are the camelCase query
 * parameters the routes accept (the server maps them to columns).
 */

export type FreightListParams = Record<string, string | number>

export function textFilter(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length ? value.trim() : undefined
}

export function readDateRange(value: unknown): { from?: string; to?: string } {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const from = textFilter(record.from)
  const to = textFilter(record.to)
  return { from, to }
}

export function sortParam(sorting: SortingState | undefined, fallbackField: string, fallbackDesc = true): { sortField: string; sortDir: 'asc' | 'desc' } {
  const first = sorting?.[0]
  return {
    sortField: first?.id ?? fallbackField,
    sortDir: first ? (first.desc ? 'desc' : 'asc') : (fallbackDesc ? 'desc' : 'asc'),
  }
}

export function buildContractListParams(values: FilterValues, page: number, sorting: SortingState, pageSize = 50): FreightListParams {
  const out: FreightListParams = { page, pageSize, ...sortParam(sorting, 'created_at') }
  const status = textFilter(values.status)
  if (status) out.status = status
  const customerId = textFilter(values.customerId)
  if (customerId) out.customerId = customerId
  const requiresApproval = textFilter(values.requiresCustomerApproval)
  if (requiresApproval) out.requiresCustomerApproval = requiresApproval
  const search = textFilter(values.q)
  if (search) out.search = search
  return out
}

export function buildContractRouteListParams(contractId: string, page = 1, pageSize = 100): FreightListParams {
  return { page, pageSize, contractId, sortField: 'line_number', sortDir: 'asc' }
}

export function buildTripListParams(values: FilterValues, page: number, sorting: SortingState, pageSize = 50): FreightListParams {
  const out: FreightListParams = { page, pageSize, ...sortParam(sorting, 'execution_date') }
  const contractId = textFilter(values.contractId)
  if (contractId) out.contractId = contractId
  const customerId = textFilter(values.customerId)
  if (customerId) out.customerId = customerId
  const executionStatus = textFilter(values.executionStatus)
  if (executionStatus) out.executionStatus = executionStatus
  const billingStatus = textFilter(values.billingStatus)
  if (billingStatus) out.billingStatus = billingStatus
  const range = readDateRange(values.executionRange)
  if (range.from) out.executionFrom = range.from
  if (range.to) out.executionTo = range.to
  const search = textFilter(values.q)
  if (search) out.search = search
  return out
}

export function buildAbstractListParams(values: FilterValues, page: number, sorting: SortingState, pageSize = 50): FreightListParams {
  const out: FreightListParams = { page, pageSize, ...sortParam(sorting, 'created_at') }
  const status = textFilter(values.status)
  if (status) out.status = status
  const approvalMode = textFilter(values.approvalMode)
  if (approvalMode) out.approvalMode = approvalMode
  const contractId = textFilter(values.contractId)
  if (contractId) out.contractId = contractId
  const customerId = textFilter(values.customerId)
  if (customerId) out.customerId = customerId
  const range = readDateRange(values.periodRange)
  if (range.from) out.periodFrom = range.from
  if (range.to) out.periodTo = range.to
  const search = textFilter(values.q)
  if (search) out.search = search
  return out
}

/**
 * The payments route has no `sortField` parameter and orders by `received_at
 * desc` server-side; sending a sort would be silently ignored, so the builder
 * deliberately emits none.
 */
export function buildPaymentListParams(values: FilterValues, page: number, pageSize = 50): FreightListParams {
  const out: FreightListParams = { page, pageSize }
  const status = textFilter(values.status)
  if (status) out.status = status
  const method = textFilter(values.method)
  if (method) out.method = method
  const customerId = textFilter(values.customerId)
  if (customerId) out.customerId = customerId
  const orderId = textFilter(values.orderId)
  if (orderId) out.orderId = orderId
  const abstractId = textFilter(values.abstractId)
  if (abstractId) out.abstractId = abstractId
  return out
}
