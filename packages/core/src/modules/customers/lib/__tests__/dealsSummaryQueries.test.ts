import type { EntityManager as CoreEntityManager } from '@mikro-orm/core'

const fetchStuckDealIdsMock = jest.fn()

jest.mock('../stuckDeals', () => ({
  fetchStuckDealIds: (...args: unknown[]) => fetchStuckDealIdsMock(...args),
}))

import { buildOpenDealPredicate, loadDealsSummaryQueryRows } from '../dealsSummaryQueries'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const stuckDealId = '33333333-3333-4333-8333-333333333333'

const currentQuarter = {
  start: new Date('2026-01-01T00:00:00.000Z'),
  end: new Date('2026-04-01T00:00:00.000Z'),
}
const previousQuarter = {
  start: new Date('2025-10-01T00:00:00.000Z'),
  end: new Date('2026-01-01T00:00:00.000Z'),
}

function normalizedSql(call: unknown[]): string {
  return String(call[0]).replace(/\s+/g, ' ')
}

describe('buildOpenDealPredicate', () => {
  it('requires a null closure outcome for every allowed open status', () => {
    expect(buildOpenDealPredicate(['open', 'in_progress'])).toEqual({
      clause: 'status IN (?,?) AND closure_outcome IS NULL',
      values: ['open', 'in_progress'],
    })
    expect(buildOpenDealPredicate(['open'])).toEqual({
      clause: 'status IN (?) AND closure_outcome IS NULL',
      values: ['open'],
    })
  })

  it('rejects an empty status list', () => {
    expect(() => buildOpenDealPredicate([])).toThrow('[internal] Open-deal predicate requires at least one status')
  })
})

describe('loadDealsSummaryQueryRows', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps summary queries tenant-scoped and excludes closed deals from open metrics', async () => {
    const executeMock = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          current_won: '0',
          current_lost: '0',
          previous_won: '0',
          previous_lost: '0',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: stuckDealId }])
    const em = {
      getConnection: () => ({ execute: executeMock }),
    } as unknown as CoreEntityManager
    fetchStuckDealIdsMock.mockResolvedValue([stuckDealId])

    const result = await loadDealsSummaryQueryRows({
      em,
      tenantId,
      organizationIds: [organizationId],
      currentQuarter,
      previousQuarter,
      seriesStart: new Date('2025-09-01T00:00:00.000Z'),
    })

    expect(executeMock).toHaveBeenCalledTimes(7)
    for (const queryIndex of [0, 1, 6]) {
      expect(normalizedSql(executeMock.mock.calls[queryIndex])).toContain('status IN (?,?) AND closure_outcome IS NULL')
    }
    expect(normalizedSql(executeMock.mock.calls[5])).toContain('status IN (?) AND closure_outcome IS NULL')
    expect(normalizedSql(executeMock.mock.calls[2])).toContain("status = 'win' OR closure_outcome = 'won'")
    for (const queryCall of executeMock.mock.calls) {
      expect(normalizedSql(queryCall)).toContain('tenant_id = ? AND organization_id IN (?) AND deleted_at IS NULL')
    }
    expect(executeMock.mock.calls[0][1]).toEqual([tenantId, organizationId, 'open', 'in_progress'])
    expect(executeMock.mock.calls[5][1]).toEqual([tenantId, organizationId, 'open'])
    expect(fetchStuckDealIdsMock).toHaveBeenCalledWith(em, organizationId, tenantId)
    expect(result.openStuckIds).toEqual([stuckDealId])
  })

  it('rejects an empty organization scope before querying', async () => {
    const executeMock = jest.fn()
    const em = {
      getConnection: () => ({ execute: executeMock }),
    } as unknown as CoreEntityManager

    await expect(
      loadDealsSummaryQueryRows({
        em,
        tenantId,
        organizationIds: [],
        currentQuarter,
        previousQuarter,
        seriesStart: new Date('2025-09-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow('[internal] Deals summary query requires an organization scope')
    expect(executeMock).not.toHaveBeenCalled()
  })
})
