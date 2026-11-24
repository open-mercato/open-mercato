/** @jest-environment node */
import {
  filterTodoRowsByCriteria,
  sortTodoRows,
  type CustomerTodoRow,
} from '../todoCompatibility'

function makeRow(overrides: Partial<CustomerTodoRow> & { id: string }): CustomerTodoRow {
  return {
    todoId: overrides.id,
    todoSource: 'customers:interaction',
    todoTitle: overrides.id,
    todoIsDone: false,
    todoOrganizationId: 'org-1',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
    createdAt: '2026-11-01T10:00:00.000Z',
    customer: { id: 'customer-1', displayName: 'Acme', kind: 'company' },
    ...overrides,
  }
}

describe('filterTodoRowsByCriteria', () => {
  const rows = [
    makeRow({ id: 'crm-planned', todoStatus: 'planned', todoPriority: 80, todoDueAt: '2026-11-10T09:00:00.000Z', todoOwnerUserId: 'user-1' }),
    makeRow({ id: 'crm-waiting', todoStatus: 'waiting', todoPriority: 20, todoDueAt: '2026-11-20T09:00:00.000Z', todoOwnerUserId: 'user-2' }),
    makeRow({ id: 'crm-done', todoStatus: 'done', todoIsDone: true, todoPriority: 50 }),
    makeRow({ id: 'crm-canceled', todoStatus: 'canceled' }),
    makeRow({ id: 'legacy-open', todoSource: 'example:todo', todoIsDone: false, todoPriority: 60, todoDueAt: '2026-11-15T09:00:00.000Z' }),
    makeRow({ id: 'legacy-done', todoSource: 'example:todo', todoIsDone: true }),
  ]

  const ids = (result: CustomerTodoRow[]) => result.map((row) => row.id)

  it('returns the rows untouched when no filter is active', () => {
    expect(filterTodoRowsByCriteria(rows, {})).toBe(rows)
    expect(filterTodoRowsByCriteria(rows, null)).toBe(rows)
  })

  it('keeps non-terminal CRM statuses and unfinished legacy todos for status=open', () => {
    expect(ids(filterTodoRowsByCriteria(rows, { status: 'open' }))).toEqual(['crm-planned', 'crm-waiting', 'legacy-open'])
  })

  it('keeps completed CRM tasks and finished legacy todos for status=done', () => {
    expect(ids(filterTodoRowsByCriteria(rows, { status: 'done' }))).toEqual(['crm-done', 'legacy-done'])
  })

  it('applies an inclusive due-date lower bound and an exclusive upper bound, dropping rows without a due date', () => {
    const result = filterTodoRowsByCriteria(rows, {
      dueFrom: new Date('2026-11-10T09:00:00.000Z'),
      dueBefore: new Date('2026-11-20T09:00:00.000Z'),
    })
    expect(ids(result)).toEqual(['crm-planned', 'legacy-open'])
  })

  it('applies an inclusive priority range and drops rows without a priority', () => {
    expect(ids(filterTodoRowsByCriteria(rows, { priorityMin: 50, priorityMax: 80 }))).toEqual([
      'crm-planned',
      'crm-done',
      'legacy-open',
    ])
  })

  it('matches the owner exactly, so legacy rows without an owner drop out', () => {
    expect(ids(filterTodoRowsByCriteria(rows, { ownerUserId: 'user-2' }))).toEqual(['crm-waiting'])
  })
})

describe('sortTodoRows', () => {
  const rows = [
    makeRow({ id: 'no-due', createdAt: '2026-11-03T10:00:00.000Z', todoPriority: null }),
    makeRow({ id: 'due-late', createdAt: '2026-11-01T10:00:00.000Z', todoDueAt: '2026-11-30T10:00:00.000Z', todoPriority: 10 }),
    makeRow({ id: 'due-early', createdAt: '2026-11-02T10:00:00.000Z', todoDueAt: '2026-11-05T10:00:00.000Z', todoPriority: 90 }),
  ]

  const ids = (result: CustomerTodoRow[]) => result.map((row) => row.id)

  it('keeps newest-first ordering by default', () => {
    expect(ids(sortTodoRows(rows))).toEqual(['no-due', 'due-early', 'due-late'])
  })

  it('orders by due date with undated rows last in both directions', () => {
    expect(ids(sortTodoRows(rows, { field: 'dueAt', dir: 'asc' }))).toEqual(['due-early', 'due-late', 'no-due'])
    expect(ids(sortTodoRows(rows, { field: 'dueAt', dir: 'desc' }))).toEqual(['due-late', 'due-early', 'no-due'])
  })

  it('orders by priority with rows without a priority last', () => {
    expect(ids(sortTodoRows(rows, { field: 'priority', dir: 'desc' }))).toEqual(['due-early', 'due-late', 'no-due'])
  })
})
