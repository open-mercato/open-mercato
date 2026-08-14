import {
  EMPTY_BOARD_FILTERS,
  boardServerFilterKey,
  boardServerFilterParams,
  countActiveBoardFilters,
  matchesBoardTagFilter,
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

  it('keeps the tag filter out of the request and out of the cache key', () => {
    const filters = withTagFilter(withAssigneeFilter(EMPTY_BOARD_FILTERS, STAFF_ID), 'tag-a')
    // A tag chip changes nothing the server was asked, so it must not evict a cached page.
    expect(boardServerFilterKey(filters)).toBe(boardServerFilterKey(withoutTagFilter(filters, 'tag-a')))
    expect(boardServerFilterParams(filters)).toBe(`&assigneeStaffMemberId=${STAFF_ID}`)
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

  it('requires every selected tag on a task', () => {
    const filters = withTagFilter(withTagFilter(EMPTY_BOARD_FILTERS, 'a'), 'b')
    expect(matchesBoardTagFilter(['a', 'b', 'c'], filters)).toBe(true)
    expect(matchesBoardTagFilter(['a'], filters)).toBe(false)
    expect(matchesBoardTagFilter([], EMPTY_BOARD_FILTERS)).toBe(true)
  })
})
