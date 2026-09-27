/** @jest-environment node */
/**
 * Pins the department form's mapping, its payload shape, and the ancestry guard.
 *
 * Three failures are invisible without this file:
 *
 * 1. `CrudForm` derives the expected-version header from `initialValues.updatedAt` (covering update
 *    AND delete), so dropping it silently disables optimistic locking for the whole edit surface —
 *    and the list answers in snake_case, so the camelCase key is not even guaranteed to be present.
 * 2. The mapper converts the snake_case row into the camelCase payload the create/update schemas
 *    accept; getting that wrong discards field values on save rather than failing.
 * 3. `excludedParentIds` is what stops a department from being re-parented under itself or under one
 *    of its own descendants. A cycle makes the tree unrenderable and every ancestor walk
 *    non-terminating, and `parent_department_id` is a plain FK, so nothing in the database refuses
 *    it. The walk is iterative for the same reason: a cycle that already exists must not hang the UI.
 */
import {
  buildDepartmentFormDefaults,
  excludedParentIds,
  toDepartmentFormValues,
  toDepartmentPayload,
} from '../DepartmentForm'
import type { DepartmentRow } from '../DepartmentsTable'

const UPDATED_AT = '2026-09-27T06:00:00.000Z'

function department(overrides: Partial<DepartmentRow> = {}): DepartmentRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Operations',
    code: 'OPS',
    description: 'Field operations',
    parent_department_id: null,
    manager_employee_id: null,
    is_active: true,
    updated_at: UPDATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

describe('department form initial values', () => {
  it('threads the record version into initialValues so CrudForm can derive the lock header', () => {
    expect(toDepartmentFormValues(department()).updatedAt).toBe(UPDATED_AT)
  })

  it('falls back to the snake_case version the list API actually returns', () => {
    const row = department({ updatedAt: undefined, updated_at: UPDATED_AT })
    expect(toDepartmentFormValues(row).updatedAt).toBe(UPDATED_AT)
  })

  it('degrades to null rather than undefined when the API omits the version', () => {
    const row = department({ updatedAt: undefined, updated_at: undefined })
    expect(toDepartmentFormValues(row).updatedAt).toBeNull()
  })

  it('converts the snake_case row into the camelCase form values', () => {
    const values = toDepartmentFormValues(department({
      parent_department_id: '00000000-0000-4000-8000-0000000000aa',
      manager_employee_id: '00000000-0000-4000-8000-0000000000bb',
    }))

    expect(values).toMatchObject({
      name: 'Operations',
      code: 'OPS',
      parentDepartmentId: '00000000-0000-4000-8000-0000000000aa',
      managerEmployeeId: '00000000-0000-4000-8000-0000000000bb',
      isActive: true,
    })
    expect(values).not.toHaveProperty('parent_department_id')
  })

  it('renders absent optional text as empty strings and an absent parent as no selection', () => {
    const values = toDepartmentFormValues(department({ code: null, description: null, parent_department_id: null }))

    expect(values.code).toBe('')
    expect(values.description).toBe('')
    expect(values.parentDepartmentId).toBe('')
  })

  it('treats a missing is_active as active, because that is the column default', () => {
    const row = department({ is_active: undefined as unknown as boolean })
    expect(toDepartmentFormValues(row).isActive).toBe(true)
  })

  it('starts a new department on defaults that satisfy the create schema', () => {
    expect(buildDepartmentFormDefaults()).toMatchObject({
      name: '',
      code: '',
      parentDepartmentId: '',
      managerEmployeeId: '',
      isActive: true,
      updatedAt: null,
    })
  })
})

describe('department form payload', () => {
  it('sends an emptied optional field as null so the update can clear it', () => {
    const payload = toDepartmentPayload({
      ...buildDepartmentFormDefaults('00000000-0000-4000-8000-000000000001'),
      name: '  Operations  ',
      code: '',
      description: '',
      parentDepartmentId: '',
      managerEmployeeId: '',
    })

    expect(payload).toEqual({
      name: 'Operations',
      code: null,
      description: null,
      parentDepartmentId: null,
      managerEmployeeId: null,
      isActive: true,
    })
  })

  it('keeps the chosen parent and manager, and carries isActive as chosen', () => {
    const payload = toDepartmentPayload({
      ...buildDepartmentFormDefaults(),
      name: 'Warehouse',
      parentDepartmentId: '00000000-0000-4000-8000-0000000000aa',
      managerEmployeeId: '00000000-0000-4000-8000-0000000000bb',
      isActive: false,
    })

    expect(payload).toMatchObject({
      parentDepartmentId: '00000000-0000-4000-8000-0000000000aa',
      managerEmployeeId: '00000000-0000-4000-8000-0000000000bb',
      isActive: false,
    })
  })

  it('never sends the record id, which belongs to the URL-bearing update call', () => {
    const payload = toDepartmentPayload(buildDepartmentFormDefaults('00000000-0000-4000-8000-000000000001'))
    expect(payload).not.toHaveProperty('id')
  })
})

describe('excludedParentIds', () => {
  const company = { id: 'company', parent_department_id: null }
  const operations = { id: 'operations', parent_department_id: 'company' }
  const warehouse = { id: 'warehouse', parent_department_id: 'operations' }
  const fleet = { id: 'fleet', parent_department_id: 'company' }
  const tree = [company, operations, warehouse, fleet]

  it('excludes the department itself', () => {
    expect(excludedParentIds(tree, 'operations').has('operations')).toBe(true)
  })

  it('excludes every descendant, at any depth', () => {
    const excluded = excludedParentIds(tree, 'company')
    expect([...excluded].sort()).toEqual(['company', 'fleet', 'operations', 'warehouse'])
  })

  it('leaves siblings and their subtrees choosable', () => {
    const excluded = excludedParentIds(tree, 'operations')
    expect(excluded.has('fleet')).toBe(false)
    expect(excluded.has('company')).toBe(false)
  })

  it('excludes nothing for a department that does not exist yet', () => {
    expect(excludedParentIds(tree, '').size).toBe(0)
  })

  it('terminates on a cycle that is already stored', () => {
    // A previously saved cycle must not hang the form: the walk is iterative and only ever adds.
    const cycled = [
      { id: 'a', parent_department_id: 'b' },
      { id: 'b', parent_department_id: 'a' },
      { id: 'c', parent_department_id: null },
    ]
    expect([...excludedParentIds(cycled, 'a')].sort()).toEqual(['a', 'b'])
  })
})
