import type { QueryKey } from '@tanstack/react-query'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { DealTimelineItem, DealTimelineResponse } from '../../../../../../lib/dealsTimelineTypes'
import { buildTimelineColumns } from '../../../../../../lib/dealsTimeline'
import { findTimelineDeal, moveDealInTimeline, runReschedule, type RescheduleDeps } from '../useRescheduleDeal'
import { buildTimelineCardAriaLabel } from '../TimelineDealCard'

jest.mock('@dnd-kit/core', () => ({ useDraggable: jest.fn() }))

function item(id: string, expectedCloseAt: string, overrides: Partial<DealTimelineItem> = {}): DealTimelineItem {
  return {
    id,
    title: `Deal ${id}`,
    status: 'open',
    valueAmount: 1000,
    valueCurrency: 'EUR',
    probability: 50,
    expectedCloseAt,
    pipelineId: 'p1',
    pipelineStageId: 's1',
    pipelineStage: 'Qualified',
    ownerUserId: 'owner-1',
    updatedAt: '2026-11-01T10:00:00.000Z',
    primaryCompany: { id: 'c1', label: 'Acme' },
    primaryPerson: null,
    ...overrides,
  }
}

function fixture(): DealTimelineResponse {
  const columns = buildTimelineColumns('week', '2026-10-26', 3, '2026-11-05').map((column) => ({
    ...column,
    total: 0,
    truncated: false,
  }))
  columns[0].total = 2
  columns[1].total = 1
  return {
    bucket: 'week',
    groupBy: 'owner',
    weekStartsOn: 1,
    from: '2026-10-26',
    to: '2026-11-16',
    columns,
    lanes: [
      {
        key: 'owner-1',
        kind: 'owner',
        owner: { id: 'owner-1' },
        stage: null,
        total: 3,
        partial: false,
        cells: [
          { column: 0, total: 2, partial: false, items: [item('a', '2026-10-27'), item('b', '2026-10-29')] },
          { column: 1, total: 1, partial: false, items: [item('c', '2026-11-04')] },
        ],
      },
    ],
    overdueBefore: { count: 0, latestExpectedCloseAt: null },
    undatedCount: 0,
    adjacent: { previous: null, next: null },
    scopeHasDeals: true,
    truncated: false,
    cardsTruncated: false,
  }
}

describe('moveDealInTimeline', () => {
  it('moves a card to the target cell, re-sorts it and adjusts the totals', () => {
    const next = moveDealInTimeline(fixture(), 'a', '2026-11-03')
    const lane = next.lanes[0]
    expect(lane.cells.find((cell) => cell.column === 0)).toMatchObject({ total: 1 })
    expect(lane.cells.find((cell) => cell.column === 1)?.items.map((entry) => entry.id)).toEqual(['a', 'c'])
    expect(lane.cells.find((cell) => cell.column === 1)?.total).toBe(2)
    expect(next.columns.map((column) => column.total)).toEqual([1, 2, 0])
    expect(findTimelineDeal(next, 'a')?.item.expectedCloseAt).toBe('2026-11-03')
    expect(lane.total).toBe(3)
  })

  it('creates the target cell when it was empty', () => {
    const next = moveDealInTimeline(fixture(), 'c', '2026-11-10')
    expect(next.lanes[0].cells.find((cell) => cell.column === 2)?.items.map((entry) => entry.id)).toEqual(['c'])
  })

  it('removes the card from the window when the new date falls outside it', () => {
    const next = moveDealInTimeline(fixture(), 'b', '2027-01-04')
    expect(findTimelineDeal(next, 'b')).toBeNull()
    expect(next.lanes[0].total).toBe(2)
  })

  it('only re-sorts when the date stays in the same column', () => {
    const next = moveDealInTimeline(fixture(), 'b', '2026-10-26')
    expect(next.lanes[0].cells[0].items.map((entry) => entry.id)).toEqual(['b', 'a'])
    expect(next.lanes[0].cells[0].total).toBe(2)
  })
})

describe('runReschedule', () => {
  const key: QueryKey = ['timeline']

  function deps(overrides: Partial<RescheduleDeps>): { deps: RescheduleDeps; store: { data: DealTimelineResponse | undefined } } {
    const store: { data: DealTimelineResponse | undefined } = { data: fixture() }
    return {
      store,
      deps: {
        queryKey: key,
        getData: () => store.data,
        setData: (_key, data) => {
          store.data = data
        },
        send: jest.fn().mockResolvedValue(undefined),
        isConflict: () => false,
        onError: jest.fn(),
        ...overrides,
      },
    }
  }

  it('applies the move optimistically and sends the lock version', async () => {
    const send = jest.fn().mockResolvedValue(undefined)
    const { deps: config, store } = deps({ send })
    const request = { item: fixture().lanes[0].cells[0].items[0], expectedCloseAt: '2026-11-03' }
    await expect(runReschedule(config, request)).resolves.toBe('success')
    expect(send).toHaveBeenCalledWith(request)
    expect(findTimelineDeal(store.data, 'a')?.column).toBe(1)
  })

  it('rolls back and routes a 409 to the conflict bar without an error flash', async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 409, code: 'optimistic_lock_conflict' })
    const onError = jest.fn()
    const { deps: config, store } = deps({
      send: jest.fn().mockRejectedValue(conflict),
      isConflict: (error) => error === conflict,
      onError,
    })
    const outcome = await runReschedule(config, { item: { id: 'a', updatedAt: 'v1' }, expectedCloseAt: '2026-11-03' })
    expect(outcome).toBe('conflict')
    expect(onError).not.toHaveBeenCalled()
    expect(findTimelineDeal(store.data, 'a')?.column).toBe(0)
  })

  it('rolls back and flashes any other failure', async () => {
    const failure = new Error('blocked by guard')
    const onError = jest.fn()
    const { deps: config, store } = deps({ send: jest.fn().mockRejectedValue(failure), onError })
    const outcome = await runReschedule(config, { item: { id: 'a', updatedAt: 'v1' }, expectedCloseAt: '2026-11-03' })
    expect(outcome).toBe('error')
    expect(onError).toHaveBeenCalledWith(failure)
    expect(findTimelineDeal(store.data, 'a')?.item.expectedCloseAt).toBe('2026-10-27')
  })
})

describe('card aria-label', () => {
  const t = createTranslator({})

  it('names the title, company, value and close date, and follows a move and a rollback', () => {
    const original = fixture()
    const before = buildTimelineCardAriaLabel(t, findTimelineDeal(original, 'a')!.item, '2026-10-01')
    expect(before).toContain('Deal a')
    expect(before).toContain('Acme')
    expect(before).toMatch(/closes .*27/)
    const moved = moveDealInTimeline(original, 'a', '2026-11-03')
    const after = buildTimelineCardAriaLabel(t, findTimelineDeal(moved, 'a')!.item, '2026-10-01')
    expect(after).toMatch(/closes .*3/)
    expect(after).not.toEqual(before)
    expect(buildTimelineCardAriaLabel(t, findTimelineDeal(original, 'a')!.item, '2026-10-01')).toEqual(before)
  })

  it('marks open overdue deals and closed deals, never both', () => {
    const overdue = buildTimelineCardAriaLabel(t, item('x', '2026-10-01'), '2026-11-05')
    expect(overdue).toContain('overdue')
    const won = buildTimelineCardAriaLabel(t, item('y', '2026-10-01', { status: 'win' }), '2026-11-05')
    expect(won).toContain('Won')
    expect(won).not.toContain('overdue')
    const lostAlias = buildTimelineCardAriaLabel(t, item('z', '2026-10-01', { status: 'loose' }), '2026-11-05')
    expect(lostAlias).toContain('Lost')
  })
})
