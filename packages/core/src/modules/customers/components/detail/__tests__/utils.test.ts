import { resolveTodoHref } from '../utils'
import { WORKFLOW_TASK_TODO_SOURCE } from '../../../lib/workflowTaskLink'

describe('resolveTodoHref', () => {
  it('uses the Example module editor path for legacy example todos', () => {
    expect(resolveTodoHref('example:todo', '11111111-1111-1111-1111-111111111111')).toBe(
      '/backend/todos/11111111-1111-1111-1111-111111111111/edit',
    )
  })

  it('keeps canonical interaction tasks non-linkable without an external integration href', () => {
    expect(resolveTodoHref('customers:interaction', '11111111-1111-1111-1111-111111111111')).toBeNull()
  })

  // #6062: the generic `/backend/<module>/todos/<id>/edit` convention has no page
  // behind it in workflows, so every workflow-created customer task linked to a
  // 404 until this case was split out.
  it('opens a workflow user task on the workflow task screen, not the todo editor', () => {
    expect(resolveTodoHref(WORKFLOW_TASK_TODO_SOURCE, '11111111-1111-1111-1111-111111111111')).toBe(
      '/backend/workflows/tasks/11111111-1111-1111-1111-111111111111',
    )
  })

  it('still uses the todo editor convention for other module sources', () => {
    expect(resolveTodoHref('projects:todo', '11111111-1111-1111-1111-111111111111')).toBe(
      '/backend/projects/todos/11111111-1111-1111-1111-111111111111/edit',
    )
  })
})
