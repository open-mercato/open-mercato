/** @jest-environment node */
/**
 * Coverage for the two encrypted-column read decisions on the todos list route.
 *
 * 1. `notes` is projected only for single-record requests. The edit form loads a
 *    todo through the list route (`ids=<id>&pageSize=1`), so dropping the column
 *    from that projection empties the field in the UI without any error, while
 *    adding it to the grid projection buys a per-row decrypt nobody renders.
 * 2. Text search over `notes` is answered from the hashed `search_tokens` index,
 *    never from `$ilike` — the stored value is ciphertext, so an `$ilike` would
 *    match nothing and return an empty page indistinguishable from a real result.
 *    `matched: false` means the index was NOT consulted, which for an encrypted
 *    column has no fallback predicate and must therefore not widen the result.
 */
import type { SearchTokenLookupResult } from '@open-mercato/shared/lib/search/tokenLookup'

type CapturedRouteOptions = {
  list: {
    fields: (query: unknown, ctx: unknown) => string[]
    sortFieldMap: Record<string, string>
    transformItem: (item: Record<string, unknown>) => Record<string, unknown>
    csv: { headers: (query: unknown, ctx: unknown) => string[] }
  }
}

const captured: { options: CapturedRouteOptions | null } = { options: null }

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: (options: CapturedRouteOptions) => {
    captured.options = options
    return { metadata: {}, GET: jest.fn(), POST: jest.fn(), PUT: jest.fn(), DELETE: jest.fn() }
  },
}))

import { buildEncryptedSearchIdNarrowing } from '../todos/route'

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

describe('encrypted-column search narrowing', () => {
  const matched = (ids: string[]): SearchTokenLookupResult => ({ matched: true, ids })

  it('narrows to the ids the token index matched', () => {
    expect(buildEncryptedSearchIdNarrowing(matched(['a', 'b']), null)).toEqual(['a', 'b'])
  })

  it('returns no ids when the index matched nothing', () => {
    expect(buildEncryptedSearchIdNarrowing(matched([]), null)).toEqual([])
  })

  it.each([
    ['search-disabled'],
    ['no-tokens'],
    ['empty-query'],
  ])('returns no ids when the index was not consulted (%s)', (reason) => {
    const lookup = { matched: false, reason } as SearchTokenLookupResult
    expect(buildEncryptedSearchIdNarrowing(lookup, null)).toEqual([])
    expect(buildEncryptedSearchIdNarrowing(lookup, ['a', 'b'])).toEqual([])
  })

  it('intersects with an id filter the caller already applied', () => {
    expect(buildEncryptedSearchIdNarrowing(matched(['a', 'b', 'c']), ['b', 'c', 'd'])).toEqual(['b', 'c'])
  })

  it('never widens an existing id filter', () => {
    expect(buildEncryptedSearchIdNarrowing(matched(['x']), ['a'])).toEqual([])
  })
})
