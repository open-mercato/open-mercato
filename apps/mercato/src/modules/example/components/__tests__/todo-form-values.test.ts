/** @jest-environment node */
/**
 * Pins the optimistic-lock wiring of the Todo edit form.
 *
 * `CrudForm` auto-derives the expected-version header from `initialValues.updatedAt`
 * (packages/ui/src/backend/CrudForm.tsx — `resolvedOptimisticLockUpdatedAt`), and that
 * header covers update AND delete. So dropping `updatedAt` from this mapping silently
 * turns optimistic locking off for the whole edit surface.
 *
 * That failure was invisible before this file existed: neutering the mapping left all 76
 * app-module tests and all 201 core optimistic-lock tests green, because the API-projection
 * test only covers the route and the workspace enforcement scan only greps for the presence
 * of the helper primitives, not for a real version being threaded.
 */
import { toTodoFormValues } from '../TodoForm'
import type { TodoListItem } from '../../types'

const UPDATED_AT = '2026-08-04T06:00:00.000Z'

function todo(overrides: Partial<TodoListItem> = {}): TodoListItem {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Review onboarding checklist',
    is_done: false,
    tenant_id: null,
    organization_id: null,
    updatedAt: UPDATED_AT,
    ...overrides,
  } as TodoListItem
}

describe('todo form initial values', () => {
  it('threads the record version into initialValues so CrudForm can derive the lock header', () => {
    expect(toTodoFormValues(todo()).updatedAt).toBe(UPDATED_AT)
  })

  it('keeps a version that CrudForm would actually accept', () => {
    // CrudForm only derives a header from a NON-EMPTY string; null/'' disable the lock.
    const derived = toTodoFormValues(todo()).updatedAt
    expect(typeof derived).toBe('string')
    expect((derived ?? '').length).toBeGreaterThan(0)
  })

  it('degrades to null rather than undefined when the API omits the version', () => {
    // `undefined` would make CrudForm fall through to its `updated_at` probe and then to
    // null anyway, but an explicit null keeps the "no version available" case unambiguous.
    expect(toTodoFormValues(todo({ updatedAt: undefined })).updatedAt).toBeNull()
  })

  it('carries the base fields and custom-field values alongside the version', () => {
    const values = toTodoFormValues(todo({ is_done: true, cf_priority: 4 } as Partial<TodoListItem>))

    expect(values).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      title: 'Review onboarding checklist',
      is_done: true,
      updatedAt: UPDATED_AT,
      cf_priority: 4,
    })
  })
})
