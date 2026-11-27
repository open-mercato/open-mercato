/** @jest-environment node */

const capturedOptions: Array<Record<string, any>> = []

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: Record<string, any>) => {
    capturedOptions.push(opts)
    return { GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }
  }),
}))

async function loadSortFieldMap(path: '../people/route' | '../companies/route'): Promise<Record<string, string>> {
  const before = capturedOptions.length
  await jest.isolateModulesAsync(async () => {
    await import(path)
  })
  const opts = capturedOptions[capturedOptions.length - 1]
  expect(capturedOptions.length).toBeGreaterThan(before)
  return opts.list.sortFieldMap as Record<string, string>
}

const listPageKeys: Record<string, string> = {
  name: 'display_name',
  primaryEmail: 'primary_email',
  status: 'status',
  lifecycleStage: 'lifecycle_stage',
  source: 'source',
  nextInteractionAt: 'next_interaction_at',
  createdAt: 'created_at',
}

const pickerKeys: Record<string, string> = {
  displayName: 'display_name',
  display_name: 'display_name',
}

describe('customers people/companies sortFieldMap covers keys sent by the UI', () => {
  it.each(['../people/route', '../companies/route'] as const)('%s maps list-page and picker sort keys', async (path) => {
    const map = await loadSortFieldMap(path)
    for (const [key, column] of Object.entries({ ...listPageKeys, ...pickerKeys })) {
      expect(Object.hasOwn(map, key)).toBe(true)
      expect(map[key]).toBe(column)
    }
  })
})
