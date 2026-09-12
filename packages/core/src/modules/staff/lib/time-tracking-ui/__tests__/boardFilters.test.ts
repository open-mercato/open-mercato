import {
  EMPTY_BOARD_FILTERS,
  boardServerFilterKey,
  boardServerFilterParams,
  countActiveBoardFilters,
  normalizeBoardFilters,
  visibleBoardStatusIds,
  withAssigneeFilter,
  withStatusFilter,
  withTagFilter,
  withoutTagFilter,
} from '../boardFilters'

const STAFF_ID = '11111111-1111-4111-8111-111111111111'
const STATUS_ID = '22222222-2222-4222-8222-222222222222'

describe('boardFilters', () => {
  it('reads a stored payload defensively so a stale entry cannot wedge the board', () => {
    expect(normalizeBoardFilters(null)).toEqual(EMPTY_BOARD_FILTERS)
    expect(normalizeBoardFilters('nonsense')).toEqual(EMPTY_BOARD_FILTERS)
    expect(
      normalizeBoardFilters({
        assigneeStaffMemberId: '  ',
        taskStatusId: STATUS_ID,
        tagIds: ['tag-a', 'tag-a', 42, ''],
      }),
    ).toEqual({ assigneeStaffMemberId: null, taskStatusId: STATUS_ID, tagIds: ['tag-a'] })
  })

  it('counts every active filter, tags included', () => {
    const filters = withTagFilter(
      withStatusFilter(withAssigneeFilter(EMPTY_BOARD_FILTERS, STAFF_ID), STATUS_ID),
      'tag-a',
    )
    expect(countActiveBoardFilters(filters)).toBe(3)
    expect(countActiveBoardFilters(withoutTagFilter(filters, 'tag-a'))).toBe(2)
  })

  it('sends the tag filter to the server and keys the cache on it (W9)', () => {
    const filters = withTagFilter(withAssigneeFilter(EMPTY_BOARD_FILTERS, STAFF_ID), 'tag-a')
    expect(boardServerFilterParams(filters)).toBe(`&assigneeStaffMemberId=${STAFF_ID}&tagIds=tag-a`)
    expect(boardServerFilterKey(filters)).not.toBe(
      boardServerFilterKey(withoutTagFilter(filters, 'tag-a')),
    )
    expect(boardServerFilterParams(withoutTagFilter(filters, 'tag-a'))).toBe(
      `&assigneeStaffMemberId=${STAFF_ID}`,
    )
  })

  it('shares one cache entry however the same two chips were picked', () => {
    const first = withTagFilter(withTagFilter(EMPTY_BOARD_FILTERS, 'tag-b'), 'tag-a')
    const second = withTagFilter(withTagFilter(EMPTY_BOARD_FILTERS, 'tag-a'), 'tag-b')
    expect(boardServerFilterKey(first)).toBe(boardServerFilterKey(second))
    expect(boardServerFilterParams(first)).toBe(boardServerFilterParams(second))
  })

  it('sends the status as a parameter only for the flat list view', () => {
    const filters = withStatusFilter(EMPTY_BOARD_FILTERS, STATUS_ID)
    // The board renders one column instead of narrowing the request.
    expect(boardServerFilterParams(filters)).toBe('')
    expect(boardServerFilterParams(filters, { includeStatus: true })).toBe(
      `&taskStatusId=${STATUS_ID}`,
    )
  })

  it('picks the columns a status filter leaves standing', () => {
    const statuses = [{ id: STATUS_ID }, { id: 'other' }]
    expect(visibleBoardStatusIds(statuses, EMPTY_BOARD_FILTERS)).toHaveLength(2)
    expect(visibleBoardStatusIds(statuses, withStatusFilter(EMPTY_BOARD_FILTERS, STATUS_ID))).toEqual([
      { id: STATUS_ID },
    ])
  })

  it('asks for every selected tag, which is what the route filter means', () => {
    const filters = withTagFilter(withTagFilter(EMPTY_BOARD_FILTERS, 'a'), 'b')
    expect(boardServerFilterParams(filters)).toBe('&tagIds=a%2Cb')
  })
})
