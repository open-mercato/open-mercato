/** @jest-environment node */
const mockApiCall = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: (...args: unknown[]) => mockApiCall(...args) }))

import { formatUsageBlocker } from '../components/usageBlockers'
import { formatMetres } from '../components/floor/types'
import { formatSize } from '../components/floorPlan/floorPlanModel'
import { leaseNeedsBillingCancel, type LeaseDetail, type LeaseVersionRow } from '../components/leases/leaseModel'
import { browserToday, leaseToday, readLeaseSettings } from '../components/leases/useLeaseSettings'
import { BUILDING_OPTIONS_MAX_PAGES, fetchBuildingOptions } from '../components/buildingOptions'

const translate = (_key: string, fallback?: string, params?: Record<string, string | number>) =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), fallback ?? '')

describe('formatUsageBlocker', () => {
  const booking = { kind: 'booking' as const, id: 'b1', unitId: 'u1', label: 'Desk hour · 2026-11-20T09:00', until: '2026-11-20T11:00' }

  it('formats structured booking times in the reader locale and drops the raw wall clock', () => {
    const text = formatUsageBlocker({ ...booking, startsAt: '2026-11-20T09:00', endsAt: '2026-11-20T11:00' }, 'en-US')
    expect(text).toBe('Desk hour · Nov 20, 2026 9:00 AM–11:00 AM')
    expect(text).not.toContain('2026-11-20T')
  })

  it('falls back to the label when the booking has no structured times', () => {
    expect(formatUsageBlocker(booking, 'en-US')).toBe(booking.label)
  })

  it('formats a lease term or its end date', () => {
    const lease = { kind: 'lease' as const, id: 'l1', unitId: 'u1', label: 'L-0001', until: '2027-01-31' }
    expect(formatUsageBlocker({ ...lease, startsOn: '2026-02-01', endsOn: '2027-01-31' }, 'en-US')).toBe('L-0001 · Feb 1, 2026 — Jan 31, 2027')
    expect(formatUsageBlocker(lease, 'de-DE')).toBe('L-0001 · 31. Jan. 2027')
  })
})

describe('metre formatting', () => {
  it('uses the reader locale decimal separator', () => {
    expect(formatMetres(2.5, 'en-US')).toBe('2.5')
    expect(formatMetres(2.5, 'pl-PL')).toBe('2,5')
    expect(formatMetres(3.456, 'de-DE')).toBe('3,46')
  })

  it('formats a unit size and area', () => {
    expect(formatSize(translate, { width: 2.5, depth: 2 }, 'pl-PL')).toBe('2,5 × 2 m, 5 m²')
  })
})

describe('leaseNeedsBillingCancel', () => {
  const version = (overrides: Partial<LeaseVersionRow>): LeaseVersionRow => ({
    id: 'v1', versionNo: 1, event: 'activated', state: 'in_force', productName: 'Office', monthlyRate: '100', currencyCode: 'EUR',
    startsOn: '2026-01-01', endsOn: '2026-12-31', months: 12, salesOrderId: 'order-1', salesOrderNumber: 'SO-1',
    recurrence: null, invoices: [], createdAt: '2026-01-01T00:00:00Z', ...overrides,
  })
  const detail = (versions: LeaseVersionRow[], operations: LeaseDetail['operations'] = [], salesOrderId: string | null = null) => ({
    lease: { salesOrderId } as LeaseDetail['lease'],
    versions,
    operations,
  })

  it('needs a cancel for a billed version whose order is not cut', () => {
    expect(leaseNeedsBillingCancel(detail([version({})]))).toBe(true)
  })

  it('needs none when every order is already cut at its start, or nothing was ordered', () => {
    const cut = version({ recurrence: { status: 'cancelled', nextInvoiceOn: null, cancelEffectiveOn: '2026-01-01', invoicesAvailable: false } })
    expect(leaseNeedsBillingCancel(detail([cut]))).toBe(false)
    expect(leaseNeedsBillingCancel(detail([version({ salesOrderId: null })]))).toBe(false)
  })

  it('needs one while an order operation is still pending', () => {
    const pending = [{ id: 'op', kind: 'lease_order', status: 'pending', attempts: 0, lastError: null }]
    expect(leaseNeedsBillingCancel(detail([], pending))).toBe(true)
  })
})

describe('readLeaseSettings', () => {
  it('reads the read-only subset and the full settings alike', () => {
    expect(readLeaseSettings({ readOnly: true, proposalExpiryDays: 21, billingChannelConfigured: false, today: '2026-11-17' } as never))
      .toEqual({ proposalExpiryDays: 21, billingChannelConfigured: false, today: '2026-11-17' })
    expect(readLeaseSettings({ proposalExpiryDays: 7, billingChannelId: 'channel' })).toEqual({ proposalExpiryDays: 7, billingChannelConfigured: true, today: null })
    expect(readLeaseSettings({})).toEqual({ proposalExpiryDays: null, billingChannelConfigured: false, today: null })
  })

  it('ignores a malformed server date', () => {
    expect(readLeaseSettings({ today: '2026-11-17T00:00:00Z' }).today).toBeNull()
    expect(readLeaseSettings({ today: 20261117 }).today).toBeNull()
  })
})

describe('leaseToday', () => {
  it('prefers the deployment date from the settings over the browser clock', () => {
    const browserNow = new Date(2026, 10, 18, 0, 30)
    expect(leaseToday({ today: '2026-11-17' }, browserNow)).toBe('2026-11-17')
    expect(leaseToday(null, browserNow)).toBe('2026-11-18')
    expect(leaseToday({ today: null }, browserNow)).toBe(browserToday(browserNow))
  })
})

describe('fetchBuildingOptions', () => {
  beforeEach(() => mockApiCall.mockReset())

  it('pages through every building', async () => {
    const page = (n: number, size: number) => Array.from({ length: size }, (_, i) => ({ id: `b-${n}-${i}`, name: `B ${n}-${i}` }))
    mockApiCall
      .mockResolvedValueOnce({ ok: true, status: 200, result: { items: page(1, 100), totalPages: 2, canManageAll: true } })
      .mockResolvedValueOnce({ ok: true, status: 200, result: { items: page(2, 5), totalPages: 2, canManageAll: true } })
    const result = await fetchBuildingOptions({ status: 'all' })
    expect(result).toMatchObject({ ok: true, canManageAll: true, truncated: false })
    expect(result.ok && result.items).toHaveLength(105)
    expect(mockApiCall.mock.calls[1][0]).toContain('page=2')
    expect(mockApiCall.mock.calls[1][0]).toContain('pageSize=100')
    expect(mockApiCall.mock.calls[1][0]).toContain('status=all')
  })

  it('stops at the page cap and reports a failure status', async () => {
    mockApiCall.mockResolvedValue({ ok: true, status: 200, result: { items: Array.from({ length: 100 }, (_, i) => ({ id: String(i) })), totalPages: 50 } })
    const capped = await fetchBuildingOptions()
    expect(capped).toMatchObject({ ok: true, truncated: true })
    expect(mockApiCall).toHaveBeenCalledTimes(BUILDING_OPTIONS_MAX_PAGES)
    mockApiCall.mockReset()
    mockApiCall.mockResolvedValue({ ok: false, status: 403, result: {} })
    expect(await fetchBuildingOptions()).toEqual({ ok: false, status: 403 })
  })
})
