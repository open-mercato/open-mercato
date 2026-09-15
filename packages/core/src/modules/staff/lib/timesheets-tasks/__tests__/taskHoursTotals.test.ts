import { sumTaskLoggedMinutes, type TaskHoursRow } from '../taskHoursTotals'

const parent: TaskHoursRow = { id: 'parent', parentTaskId: null, loggedMinutes: 165 }
const childA: TaskHoursRow = { id: 'child-a', parentTaskId: 'parent', loggedMinutes: 45 }
const otherCard: TaskHoursRow = { id: 'other', parentTaskId: null, loggedMinutes: 30 }

describe('sumTaskLoggedMinutes', () => {
  it('sums the cards of a board column', () => {
    expect(sumTaskLoggedMinutes([parent, otherCard])).toBe(195)
  })

  it('documents R10: naively summing loggedMinutes over a parent and its child double-counts', () => {
    const naive = [parent, childA].reduce((total, row) => total + (row.loggedMinutes ?? 0), 0)

    // 165 already contains the child's 45, so the naive total inflates by exactly that.
    expect(naive).toBe(210)
    expect(sumTaskLoggedMinutes([parent, childA])).toBe(165)
    expect(naive - sumTaskLoggedMinutes([parent, childA])).toBe(childA.loggedMinutes)
  })

  it('keeps a child whose parent is not in the set', () => {
    expect(sumTaskLoggedMinutes([childA, otherCard])).toBe(75)
  })

  it('treats missing minutes as zero', () => {
    expect(sumTaskLoggedMinutes([{ id: 'a' }, { id: 'b', loggedMinutes: null }, otherCard])).toBe(30)
  })

  it('returns zero for an empty column', () => {
    expect(sumTaskLoggedMinutes([])).toBe(0)
  })
})
