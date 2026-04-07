import { resolveTodoHref } from '../utils'

describe('resolveTodoHref', () => {
  it('uses the Example module editor path for legacy example todos', () => {
    expect(resolveTodoHref('example:todo', '11111111-1111-1111-1111-111111111111')).toBe(
      '/backend/todos/11111111-1111-1111-1111-111111111111/edit',
    )
  })

  it('keeps canonical interaction tasks non-linkable without an external integration href', () => {
    expect(resolveTodoHref('customers:interaction', '11111111-1111-1111-1111-111111111111')).toBeNull()
  })
})
