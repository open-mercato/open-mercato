/** @jest-environment node */
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

type CapturedListConfig = {
  entityId?: string
  omitAutomaticTenantOrgScope?: boolean
  buildFilters?: (query: Record<string, unknown>, ctx: CrudCtx) => Promise<Record<string, unknown>>
}

const captured: CapturedListConfig[] = []
const permitted: { value: string[] | null } = { value: ['building-a'] }

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((config: { list?: CapturedListConfig }) => {
    if (config.list) captured.push(config.list)
    const handler = jest.fn()
    return { GET: handler, POST: handler, PUT: handler, DELETE: handler }
  }),
}))

jest.mock('../lib/buildingAccess', () => {
  const actual = jest.requireActual('../lib/buildingAccess')
  return { ...actual, permittedBuildingIds: jest.fn(async () => permitted.value) }
})

import { mergeAdvancedFilters } from '@open-mercato/shared/lib/crud/advanced-filter-integration'
import { isIdsParamProvided, mergeIdFilter, parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import { normalizeFilters, type NormalizedFilter } from '@open-mercato/shared/lib/query/join-utils'
import { NO_MATCH_ID } from '../lib/buildingAccess'
import { crudScopeFilters, sealListScope } from '../api/crudShared'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG = '33333333-3333-4333-8333-333333333333'
const OTHER_TENANT = '44444444-4444-4444-8444-444444444444'
const BUILDING_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BUILDING_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ROW_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function ctxOf(overrides: Partial<CrudCtx> = {}): CrudCtx {
  return {
    container: { resolve: () => ({ fork: () => ({}) }) } as never,
    auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG } as CrudCtx['auth'],
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
    ...overrides,
  }
}

const ROUTES = ['buildings', 'units', 'leases', 'bookings', 'floors', 'spaces', 'common-areas'] as const

function sealedScope(filters: Record<string, unknown>): Record<string, unknown> {
  const clauses = filters.$and
  expect(Array.isArray(clauses)).toBe(true)
  return (clauses as Record<string, unknown>[])[0]
}

function advancedFilter(
  conditions: Array<{ field: string; op: string; value: string }>,
  logic: 'and' | 'or' = 'and',
): Record<string, string> {
  const query: Record<string, string> = { 'filter[logic]': logic }
  conditions.forEach((condition, index) => {
    query[`filter[conditions][${index}][field]`] = condition.field
    query[`filter[conditions][${index}][op]`] = condition.op
    query[`filter[conditions][${index}][value]`] = condition.value
    if (index > 0) query[`filter[conditions][${index}][join]`] = logic
  })
  return query
}

function mergedListFilter(built: Record<string, unknown>, query: Record<string, unknown>): Record<string, unknown> {
  const advanced = mergeAdvancedFilters(built, query)
  return mergeIdFilter(advanced, parseIdsParam(query.ids), { idsParamProvided: isIdsParamProvided(query.ids) }) as Record<string, unknown>
}

function unconditional(filters: Record<string, unknown>): NormalizedFilter[] {
  return normalizeFilters(filters).filter((leaf) => !leaf.orGroup)
}

function expectEveryRowScoped(filters: Record<string, unknown>, buildingField: 'building_id' | 'id', buildings: string[]): void {
  const leaves = unconditional(filters)
  expect(leaves).toEqual(
    expect.arrayContaining([
      { field: 'tenant_id', op: 'eq', value: TENANT },
      { field: 'organization_id', op: 'eq', value: ORG },
      { field: buildingField, op: 'in', value: buildings },
    ]),
  )
}

const ATTACKS: Array<[string, Record<string, string>]> = [
  ['building_id is_not', advancedFilter([{ field: 'building_id', op: 'is_not', value: BUILDING_A }])],
  ['building_id is', advancedFilter([{ field: 'building_id', op: 'is', value: BUILDING_B }])],
  ['tenant_id is', advancedFilter([{ field: 'tenant_id', op: 'is', value: OTHER_TENANT }])],
  ['tenant_id is_not', advancedFilter([{ field: 'tenant_id', op: 'is_not', value: TENANT }])],
  ['organization_id is', advancedFilter([{ field: 'organization_id', op: 'is', value: OTHER_ORG }])],
  ['id is', advancedFilter([{ field: 'id', op: 'is', value: ROW_B }])],
  ['id is_not with ?ids=', { ...advancedFilter([{ field: 'id', op: 'is_not', value: BUILDING_A }]), ids: ROW_B }],
  [
    'OR across building_id, tenant_id and organization_id',
    advancedFilter(
      [
        { field: 'building_id', op: 'is', value: BUILDING_B },
        { field: 'tenant_id', op: 'is', value: OTHER_TENANT },
        { field: 'organization_id', op: 'is', value: OTHER_ORG },
      ],
      'or',
    ),
  ],
]

beforeAll(async () => {
  for (const route of ROUTES) await import(`../api/${route}/route`)
})

describe('crudScopeFilters', () => {
  it('pins the tenant and the single visible organization', () => {
    expect(crudScopeFilters(ctxOf())).toEqual({ tenant_id: { $eq: TENANT }, organization_id: { $eq: ORG } })
  })

  it('lists only the selected organization even when the scope also spans its child organizations', () => {
    expect(crudScopeFilters(ctxOf({ organizationIds: [ORG, OTHER_ORG, ORG] }))).toEqual({
      tenant_id: { $eq: TENANT },
      organization_id: { $eq: ORG },
    })
  })

  it('matches nothing when the selected organization is outside the visible scope', () => {
    expect(crudScopeFilters(ctxOf({ organizationIds: [OTHER_ORG] }))).toEqual({
      tenant_id: { $eq: TENANT },
      organization_id: { $eq: NO_MATCH_ID },
    })
  })

  it('matches nothing in an all-organizations view without a single selected organization', () => {
    expect(crudScopeFilters(ctxOf({ organizationIds: [ORG, OTHER_ORG], selectedOrganizationId: null, auth: { sub: 'user-1', tenantId: TENANT, orgId: null } as CrudCtx['auth'] }))).toEqual({
      tenant_id: { $eq: TENANT },
      organization_id: { $eq: NO_MATCH_ID },
    })
  })

  it('falls back to the selected organization when the scope has no list', () => {
    expect(crudScopeFilters(ctxOf({ organizationIds: null, selectedOrganizationId: OTHER_ORG }))).toEqual({
      tenant_id: { $eq: TENANT },
      organization_id: { $eq: OTHER_ORG },
    })
  })

  it('fails closed without a tenant or a visible organization', () => {
    expect(crudScopeFilters(ctxOf({ organizationIds: [] }))).toEqual({
      tenant_id: { $eq: TENANT },
      organization_id: { $eq: NO_MATCH_ID },
    })
    expect(crudScopeFilters(ctxOf({ auth: null, organizationIds: null, selectedOrganizationId: null }))).toEqual({
      tenant_id: { $eq: NO_MATCH_ID },
      organization_id: { $eq: NO_MATCH_ID },
    })
  })
})

describe('CRUD list routes own their tenant, organization and building scope', () => {
  it('registers every building-scoped list', () => {
    expect(captured).toHaveLength(ROUTES.length)
  })

  it.each(ROUTES.map((route, index) => [route, index] as const))(
    '%s re-applies its scope when a full export calls buildFilters with an empty query',
    async (_route, index) => {
      const list = captured[index]
      expect(list.omitAutomaticTenantOrgScope).toBe(true)
      permitted.value = [BUILDING_A]
      const scope = sealedScope(await list.buildFilters!({}, ctxOf()))
      expect(scope.tenant_id).toEqual({ $eq: TENANT })
      expect(scope.organization_id).toEqual({ $eq: ORG })
      expect(scope.building_id ?? scope.id).toEqual({ $in: [BUILDING_A] })
    },
  )

  it.each(ROUTES.map((route, index) => [route, index] as const))(
    '%s matches nothing for a manager without assigned buildings',
    async (_route, index) => {
      permitted.value = []
      const scope = sealedScope(await captured[index].buildFilters!({}, ctxOf()))
      expect(scope.building_id ?? scope.id).toEqual({ $in: [NO_MATCH_ID] })
    },
  )

  it.each(ROUTES.map((route, index) => [route, index] as const))(
    '%s keeps the tenant and organization predicate for manage_all holders',
    async (_route, index) => {
      permitted.value = null
      const scope = sealedScope(await captured[index].buildFilters!({}, ctxOf()))
      expect(scope).toEqual({ tenant_id: { $eq: TENANT }, organization_id: { $eq: ORG } })
    },
  )
})

describe('a client advanced filter cannot widen a list beyond its sealed scope', () => {
  const cases = ROUTES.flatMap((route, index) => ATTACKS.map(([name, query]) => [route, name, index, query] as const))

  it.each(cases)('%s: %s', async (route, _name, index, query) => {
    permitted.value = [BUILDING_A]
    const buildingField = route === 'buildings' ? 'id' : 'building_id'
    const built = await captured[index].buildFilters!({ ...query }, ctxOf())
    const merged = mergedListFilter(built, query)
    expectEveryRowScoped(merged, buildingField, [BUILDING_A])
  })

  it.each(ROUTES.map((route, index) => [route, index] as const))(
    '%s keeps tenant and organization for manage_all holders under a hostile filter',
    async (_route, index) => {
      permitted.value = null
      const query = advancedFilter([
        { field: 'tenant_id', op: 'is', value: OTHER_TENANT },
        { field: 'organization_id', op: 'is_not', value: ORG },
      ], 'or')
      const merged = mergedListFilter(await captured[index].buildFilters!({ ...query }, ctxOf()), query)
      expect(unconditional(merged)).toEqual(
        expect.arrayContaining([
          { field: 'tenant_id', op: 'eq', value: TENANT },
          { field: 'organization_id', op: 'eq', value: ORG },
        ]),
      )
    },
  )
})

describe('sealed list scope keeps legitimate filtering working', () => {
  const buildingsIndex = ROUTES.indexOf('buildings')
  const unitsIndex = ROUTES.indexOf('units')

  it('ANDs a client advanced filter onto the scope', async () => {
    permitted.value = [BUILDING_A]
    const query = advancedFilter([{ field: 'name', op: 'contains', value: 'Desk' }])
    const merged = mergedListFilter(await captured[unitsIndex].buildFilters!({ ...query }, ctxOf()), query)
    expect(merged.name).toEqual({ $ilike: '%Desk%' })
    expectEveryRowScoped(merged, 'building_id', [BUILDING_A])
  })

  it('keeps a client OR filter as alternatives inside the scope', async () => {
    permitted.value = [BUILDING_A]
    const query = advancedFilter([
      { field: 'name', op: 'is', value: 'North' },
      { field: 'name', op: 'is', value: 'South' },
    ], 'or')
    const merged = mergedListFilter(await captured[unitsIndex].buildFilters!({ ...query }, ctxOf()), query)
    const grouped = normalizeFilters(merged).filter((leaf) => leaf.orGroup)
    expect(grouped.map((leaf) => leaf.value).sort()).toEqual(['North', 'South'])
    expectEveryRowScoped(merged, 'building_id', [BUILDING_A])
  })

  it('searches buildings by name or address within the scope', async () => {
    permitted.value = [BUILDING_A]
    const merged = mergedListFilter(await captured[buildingsIndex].buildFilters!({ search: 'Harbour' }, ctxOf()), {})
    expect(merged.$or).toEqual([{ name: { $ilike: '%Harbour%' } }, { address: { $ilike: '%Harbour%' } }])
    expectEveryRowScoped(merged, 'id', [BUILDING_A])
    const disjuncts = new Set(normalizeFilters(merged).map((leaf) => leaf.orGroup).filter(Boolean))
    expect(disjuncts.size).toBe(2)
  })

  it('combines a search with a client OR filter without dropping the scope', async () => {
    permitted.value = [BUILDING_A]
    const query = advancedFilter([
      { field: 'status', op: 'is', value: 'active' },
      { field: 'building_id', op: 'is', value: BUILDING_B },
    ], 'or')
    const merged = mergedListFilter(await captured[buildingsIndex].buildFilters!({ ...query, search: 'Harbour' }, ctxOf()), query)
    expectEveryRowScoped(merged, 'id', [BUILDING_A])
  })

  it('narrows a list to ?ids= on top of the scope', async () => {
    permitted.value = [BUILDING_A]
    const query = { ids: `${ROW_B},not-a-uuid` }
    const merged = mergedListFilter(await captured[unitsIndex].buildFilters!({ ...query }, ctxOf()), query)
    expect(merged.id).toEqual({ $in: [ROW_B] })
    expectEveryRowScoped(merged, 'building_id', [BUILDING_A])
  })

  it('intersects ?ids= with a requested id', async () => {
    permitted.value = [BUILDING_A]
    const query = { id: BUILDING_A, ids: `${BUILDING_A},${BUILDING_B}` }
    const merged = mergedListFilter(await captured[unitsIndex].buildFilters!({ ...query }, ctxOf()), query)
    expect(merged.id).toEqual({ $in: [BUILDING_A] })
  })

  it('pins a requested building only when it is permitted', async () => {
    permitted.value = [BUILDING_A]
    expect(sealedScope(await captured[unitsIndex].buildFilters!({ buildingId: BUILDING_A }, ctxOf())).building_id).toEqual({ $eq: BUILDING_A })
    expect(sealedScope(await captured[unitsIndex].buildFilters!({ buildingId: BUILDING_B }, ctxOf())).building_id).toEqual({ $in: [NO_MATCH_ID] })
  })
})

describe('sealListScope', () => {
  it('appends the scope to existing $and clauses', () => {
    const scope = { tenant_id: { $eq: TENANT } }
    expect(sealListScope(scope, { $and: [{ status: { $eq: 'active' } }], name: { $eq: 'A' } })).toEqual({
      name: { $eq: 'A' },
      $and: [{ status: { $eq: 'active' } }, scope],
    })
  })
})
