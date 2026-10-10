/** @jest-environment node */
import type { SortingState } from '@tanstack/react-table'
import {
  buildAbstractListParams,
  buildContractListParams,
  buildContractRouteListParams,
  buildPaymentListParams,
  buildTripListParams,
  readDateRange,
} from '../listParams'

const NO_SORT: SortingState = []

describe('freight list params', () => {
  // The routes fall back to `id asc` without an explicit sort, which reads as a
  // random order — a builder that forgets it produces a grid nobody can scan.
  it('always sends an explicit sort for the sortable lists', () => {
    expect(buildContractListParams({}, 1, NO_SORT)).toMatchObject({ sortField: 'created_at', sortDir: 'desc' })
    expect(buildTripListParams({}, 1, NO_SORT)).toMatchObject({ sortField: 'execution_date', sortDir: 'desc' })
    expect(buildAbstractListParams({}, 1, NO_SORT)).toMatchObject({ sortField: 'created_at', sortDir: 'desc' })
    expect(buildContractRouteListParams('contract-1')).toMatchObject({ sortField: 'line_number', sortDir: 'asc' })
  })

  it('follows the operator sorting and resets the direction default', () => {
    const sorting: SortingState = [{ id: 'valid_from', desc: true }]
    expect(buildContractListParams({}, 2, sorting)).toMatchObject({ page: 2, sortField: 'valid_from', sortDir: 'desc' })
    expect(buildContractListParams({}, 1, [{ id: 'valid_from', desc: false }])).toMatchObject({ sortField: 'valid_from', sortDir: 'asc' })
  })

  it('maps only the filters that carry a value and trims the search term', () => {
    const params = buildContractListParams(
      { status: 'active', customerId: '', requiresCustomerApproval: 'true', q: '  north corridor ' },
      3,
      NO_SORT,
    )
    expect(params).toEqual({
      page: 3,
      pageSize: 50,
      sortField: 'created_at',
      sortDir: 'desc',
      status: 'active',
      requiresCustomerApproval: 'true',
      search: 'north corridor',
    })
  })

  it('splits the trip execution window into the route date bounds', () => {
    const params = buildTripListParams({ executionRange: { from: '2026-10-01', to: '2026-10-31' } }, 1, NO_SORT)
    expect(params.executionFrom).toBe('2026-10-01')
    expect(params.executionTo).toBe('2026-10-31')
  })

  it('splits the abstract period window into the overlapping-period bounds', () => {
    const params = buildAbstractListParams({ periodRange: { from: '2026-09-01' } }, 1, NO_SORT)
    expect(params.periodFrom).toBe('2026-09-01')
    expect(params.periodTo).toBeUndefined()
  })

  // The payments route has no sort parameters and orders by received_at desc
  // server-side; a sent sort would be dropped silently, so none is sent.
  it('never sends a sort for payments', () => {
    const params = buildPaymentListParams({ status: 'recorded', method: 'bank_transfer' }, 2)
    expect(params).toEqual({ page: 2, pageSize: 50, status: 'recorded', method: 'bank_transfer' })
    expect(params).not.toHaveProperty('sortField')
    expect(params).not.toHaveProperty('sortDir')
  })

  it('reads a date range defensively', () => {
    expect(readDateRange(undefined)).toEqual({})
    expect(readDateRange('2026-10-01')).toEqual({})
    expect(readDateRange({ from: '  ', to: '2026-10-31' })).toEqual({ to: '2026-10-31' })
  })
})
