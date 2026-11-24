import { kanbanPropsSchema } from '../kanban'

const columns = [
  { id: 'lead', title: 'Lead', count: 1, cards: [{ id: 'd-1', amount: 1200 }] },
  { id: 'won', title: 'Won', cards: [] },
]
const handlers = {
  onMove: async () => undefined,
  renderCard: () => null,
}

describe('Kanban contract', () => {
  it('accepts columns with module-specific card data', () => {
    const result = kanbanPropsSchema.safeParse({ columns, ...handlers })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.columns[0].cards[0]).toEqual({ id: 'd-1', amount: 1200 })
  })

  it('accepts canMove, column paging and card open handlers', () => {
    const result = kanbanPropsSchema.safeParse({
      columns: [{ ...columns[0], hasMore: true }, columns[1]],
      ...handlers,
      canMove: () => ({ reason: 'Missing close date' }),
      onLoadMoreColumn: async () => undefined,
      onCardOpen: () => undefined,
      columnHeader: () => null,
    })
    expect(result.success).toBe(true)
  })

  it('requires renderCard and onMove', () => {
    expect(kanbanPropsSchema.safeParse({ columns, onMove: async () => undefined }).success).toBe(false)
    expect(kanbanPropsSchema.safeParse({ columns, renderCard: () => null }).success).toBe(false)
  })

  it('accepts an empty board with empty status', () => {
    expect(kanbanPropsSchema.safeParse({ columns: [], status: 'empty', ...handlers }).success).toBe(true)
  })

  it('rejects duplicate column ids', () => {
    const result = kanbanPropsSchema.safeParse({
      columns: [columns[0], { id: 'lead', title: 'Lead 2', cards: [] }],
      ...handlers,
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.map((issue) => issue.message)).toContain('Column ids must be unique')
  })

  it('rejects duplicate card ids across the board', () => {
    const result = kanbanPropsSchema.safeParse({
      columns: [columns[0], { id: 'won', title: 'Won', cards: [{ id: 'd-1' }] }],
      ...handlers,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain('Card ids must be unique across the board')
    }
  })

  it('rejects hasMore without onLoadMoreColumn', () => {
    expect(
      kanbanPropsSchema.safeParse({ columns: [{ ...columns[0], hasMore: true }], ...handlers }).success,
    ).toBe(false)
  })
})
