/** @jest-environment node */
/**
 * Coverage for the two encrypted-column read decisions on the todos list route.
 *
 * 1. `notes` is projected only for single-record requests. The edit form loads a
 *    todo through the list route (`ids=<id>&pageSize=1`), so dropping the column
 *    from that projection empties the field in the UI without any error, while
 *    adding it to the grid projection buys a per-row decrypt nobody renders.
 * 2. Text search over `notes` uses a PLAIN `$ilike`, exactly like the plaintext
 *    `title` filter. The query engine rewrites like/ilike into a `search_tokens`
 *    lookup when the column is encrypted and search is active, so the module does
 *    not — and must not — hand-roll an id narrowing of its own.
 */

type CapturedRouteOptions = {
  list: {
    fields: (query: unknown, ctx: unknown) => string[]
    sortFieldMap: Record<string, string>
    transformItem: (item: Record<string, unknown>) => Record<string, unknown>
    csv: { headers: (query: unknown, ctx: unknown) => string[] }
    schema: { parse: (value: unknown) => Record<string, unknown> }
    buildFilters: (query: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown>>
  }
}

const captured: { options: CapturedRouteOptions | null } = { options: null }

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (options: CapturedRouteOptions) => {
    captured.options = options
    return { metadata: {}, GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }
  },
}))

import '../todos/route'

function routeOptions(): CapturedRouteOptions {
  if (!captured.options) throw new Error('[internal] makeCrudRoute was not called by the todos route')
  return captured.options
}

const TENANT = '00000000-0000-4000-8000-00000000000a'
const ORG = '00000000-0000-4000-8000-0000000000a1'

function createCtx() {
  return {
    container: { resolve: () => null },
    auth: { tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

describe('todos list projection for the encrypted notes column', () => {
  it('projects notes when the request targets one record by ids', () => {
    const fields = routeOptions().list.fields({ ids: '11111111-1111-4111-8111-111111111111' }, createCtx())
    expect(fields).toContain('notes')
  })

  it('projects notes when the request targets one record by id', () => {
    const fields = routeOptions().list.fields({ id: '11111111-1111-4111-8111-111111111111' }, createCtx())
    expect(fields).toContain('notes')
  })

  it('does not project notes for a grid listing', () => {
    expect(routeOptions().list.fields({}, createCtx())).not.toContain('notes')
    expect(routeOptions().list.fields({ ids: '   ' }, createCtx())).not.toContain('notes')
  })

  it('never offers notes as a sort field', () => {
    expect(Object.keys(routeOptions().list.sortFieldMap)).not.toContain('notes')
    expect(Object.values(routeOptions().list.sortFieldMap)).not.toContain('notes')
  })

  it('never exports notes to CSV', () => {
    expect(routeOptions().list.csv.headers({}, createCtx())).not.toContain('notes')
    expect(
      routeOptions().list.csv.headers({ ids: '11111111-1111-4111-8111-111111111111' }, createCtx()),
    ).not.toContain('notes')
  })

  it('serializes notes as null when the column was not projected', () => {
    const transformed = routeOptions().list.transformItem({
      id: 'todo-1',
      title: 'Alpha',
      is_done: false,
      tenant_id: TENANT,
      organization_id: ORG,
    })
    expect(transformed.notes).toBeNull()
  })

  it('passes the decrypted notes value through on a single-record read', () => {
    const transformed = routeOptions().list.transformItem({
      id: 'todo-1',
      title: 'Alpha',
      is_done: false,
      notes: 'decrypted text',
      tenant_id: TENANT,
      organization_id: ORG,
    })
    expect(transformed.notes).toBe('decrypted text')
  })
})

const makeCtx = createCtx

async function buildFilters(rawQuery: Record<string, unknown>, ctx: unknown): Promise<Record<string, unknown>> {
  const options = routeOptions()
  // Parse through the route's own schema so a term must survive validation, and so a
  // removed/renamed param shows up as an undefined filter rather than a silent pass.
  const parsed = options.list.schema.parse({ page: 1, pageSize: 50, sortField: 'id', sortDir: 'asc', ...rawQuery })
  return options.list.buildFilters(parsed, ctx)
}

describe('encrypted-column text search goes through the platform', () => {
  // This suite replaced one that covered a hand-rolled id-narrowing helper. The query
  // engine already rewrites like/ilike into a `search_tokens` lookup for an encrypted
  // column (`packages/shared/src/lib/query/engine.ts` → `applyFilterOp`), and
  // `applySearchTokens` applies the tenant/organization scope itself. Reimplementing
  // that in the module meant duplicating platform behaviour AND re-deriving the scope
  // by hand — the opposite of what a canonical reference should teach.

  it('filters notes with a plain $ilike, the same shape as the plaintext title filter', async () => {
    const filters = await buildFilters({ notes: 'quarterly' }, makeCtx())

    expect(filters.notes).toEqual({ $ilike: '%quarterly%' })
  })

  it('escapes like wildcards in the notes term so they cannot alter the pattern', async () => {
    const filters = await buildFilters({ notes: '100%_raise' }, makeCtx())

    expect(filters.notes).toEqual({ $ilike: '%100\\%\\_raise%' })
  })

  it('does not narrow by id, so it never collides with an ids= filter', async () => {
    const filters = await buildFilters({ notes: 'quarterly', ids: 'aaa,bbb' }, makeCtx())

    expect(filters.notes).toEqual({ $ilike: '%quarterly%' })
    expect(filters.id).toEqual({ $in: ['aaa', 'bbb'] })
  })

  it('omits the notes filter entirely when no term is supplied', async () => {
    const filters = await buildFilters({}, makeCtx())

    expect(filters.notes).toBeUndefined()
  })
})
