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
    name: 'availability rule sets',
    load: () => require('../api/availability-rule-sets'),
    expected: { name: 'name', timezone: 'timezone', updatedAt: 'updated_at' },
  },
]

describe('planner list routes accept every sort key their DataTables send (#9548)', () => {
  it.each(cases)('$name sortFieldMap covers the UI column ids', ({ load, expected }) => {
    const sortFieldMap = loadSortFieldMap(load)
    for (const [key, column] of Object.entries(expected)) {
      expect(Object.hasOwn(sortFieldMap, key)).toBe(true)
      expect(sortFieldMap[key]).toBe(column)
    }
  })
})
