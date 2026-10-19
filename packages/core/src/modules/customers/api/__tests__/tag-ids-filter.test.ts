/** @jest-environment node */

const capturedCrudOptions: Array<Record<string, any>> = []

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: Record<string, any>) => {
    capturedCrudOptions.push(opts)
    return {
      GET: jest.fn(),
      POST: jest.fn(),
      PUT: jest.fn(),
      DELETE: jest.fn(),
    }
  }),
}))

const tagA = '11111111-1111-4111-8111-111111111111'
const tagB = '22222222-2222-4222-8222-222222222222'

async function loadListOptions(routePath: '../people/route' | '../companies/route') {
  capturedCrudOptions.length = 0
  await jest.isolateModulesAsync(async () => {
    await import(routePath)
  })
  const options = capturedCrudOptions[0]
  if (!options) throw new Error(`[internal] makeCrudRoute was not called for ${routePath}`)
  return options.list as {
    schema: { safeParse: (input: unknown) => { success: boolean } }
    buildFilters: (query: Record<string, unknown>, ctx?: unknown) => Promise<Record<string, unknown>>
  }
}

describe.each([
  ['people', '../people/route', 'person'],
  ['companies', '../companies/route', 'company'],
] as const)('customers %s list tagIds filter (#7265)', (_label, routePath, kind) => {
  it.each([
    ['a malformed tag id', 'not-a-uuid'],
    ['a mixed valid and malformed list', `${tagA},not-a-uuid`],
  ])('rejects %s in the list query schema', async (_case, tagIds) => {
    const list = await loadListOptions(routePath)

    expect(list.schema.safeParse({ tagIds }).success).toBe(false)
  })

  it.each([
    ['an absent tagIds', {}],
    ['a valid but unknown tag id', { tagIds: tagA }],
    ['a valid comma-separated list', { tagIds: ` ${tagA} , ${tagB} ,` }],
  ])('accepts %s in the list query schema', async (_case, query) => {
    const list = await loadListOptions(routePath)

    expect(list.schema.safeParse(query).success).toBe(true)
  })

  it('filters by the trimmed tag ids while keeping the entity kind filter', async () => {
    const list = await loadListOptions(routePath)
    const filters = await list.buildFilters({ tagIds: ` ${tagA} , ${tagB} ` })

    expect(filters.kind).toEqual({ $eq: kind })
    expect(filters['tag_assignments.tag_id']).toEqual({ $in: [tagA, tagB] })
  })
})
