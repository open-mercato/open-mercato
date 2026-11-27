/** @jest-environment node */

type CapturedListOptions = { sortFieldMap?: Record<string, unknown> }

const capturedListOptions: CapturedListOptions[] = []

jest.mock('@open-mercato/shared/lib/crud/factory', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/factory')
  return {
    ...actual,
    makeCrudRoute: (options: { list?: CapturedListOptions }) => {
      capturedListOptions.push(options.list ?? {})
      return actual.makeCrudRoute(options)
    },
  }
})

function loadSortFieldMap(load: () => unknown): Record<string, unknown> {
  const before = capturedListOptions.length
  load()
  const list = capturedListOptions[before]
  expect(list).toBeDefined()
  return list?.sortFieldMap ?? {}
}

const cases: Array<{ name: string; load: () => unknown; expected: Record<string, string> }> = [
  {
    name: 'leave requests',
    load: () => require('../api/leave-requests'),
    expected: { startDate: 'start_date', status: 'status', reason: 'unavailability_reason_value', updatedAt: 'updated_at' },
  },
  {
    name: 'teams',
    load: () => require('../api/teams'),
    expected: { name: 'name', description: 'description', isActive: 'is_active', updatedAt: 'updated_at' },
  },
  {
    name: 'team members',
    load: () => require('../api/team-members'),
    expected: { displayName: 'display_name', isActive: 'is_active', updatedAt: 'updated_at' },
  },
  {
    name: 'time projects',
    load: () => require('../api/timesheets/time-projects/route'),
    expected: { name: 'name', status: 'status', projectType: 'project_type', updatedAt: 'updated_at' },
  },
]

describe('staff list routes accept every sort key their DataTables send (#9548)', () => {
  it.each(cases)('$name sortFieldMap covers the UI column ids', ({ load, expected }) => {
    const sortFieldMap = loadSortFieldMap(load)
    for (const [key, column] of Object.entries(expected)) {
      expect(Object.hasOwn(sortFieldMap, key)).toBe(true)
      expect(sortFieldMap[key]).toBe(column)
    }
  })
})
