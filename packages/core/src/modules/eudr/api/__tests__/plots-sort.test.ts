/** @jest-environment node */

// Regression coverage for #5509: sorting EUDR plots by `plotType` (and the
// camelCase `originCountry`) must resolve to the underlying snake_case column so
// the query engine actually orders the result. Before the fix the route's
// `sortFieldMap` omitted these, so the shared factory fell through to the raw
// camelCase name, `resolveBaseColumn` returned null, and the sort was silently
// dropped (asc/desc returned the same unordered rows).

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'
const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const queryEngine = {
  query: jest.fn(async () => ({ items: [], total: 0 })),
}

const accessLogService = { log: jest.fn(async () => {}) }

const em = {
  find: jest.fn(async () => []),
  findOne: jest.fn(async () => null),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) =>
      (({
        em,
        queryEngine,
        accessLogService,
      }) as Record<string, unknown>)[name],
  })),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => {
  const auth = { sub: 'user-1', orgId: ORG_ID, tenantId: TENANT_ID, roles: ['admin'] }
  return {
    getAuthFromRequest: jest.fn(async () => auth),
    getAuthFromCookies: jest.fn(async () => auth),
  }
})

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    selectedId: ORG_ID,
    filterIds: [ORG_ID],
    allowedIds: [ORG_ID],
    tenantId: TENANT_ID,
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
}))

import { GET } from '../plots/route'

type SortArg = Array<{ field: string; dir: string }>

async function resolvedSort(query: string): Promise<SortArg | undefined> {
  const response = await GET(new Request(`http://localhost/api/eudr/plots?${query}`))
  expect(response.status).toBe(200)
  const lastCall = queryEngine.query.mock.calls.at(-1)
  return (lastCall?.[1] as { sort?: SortArg } | undefined)?.sort
}

describe('eudr plots list sorting (#5509)', () => {
  beforeEach(() => {
    queryEngine.query.mockClear()
  })

  it('orders by the plot_type column when sorting by plotType, honoring direction', async () => {
    expect(await resolvedSort('sortField=plotType&sortDir=asc')).toEqual([{ field: 'plot_type', dir: 'asc' }])
    expect(await resolvedSort('sortField=plotType&sortDir=desc')).toEqual([{ field: 'plot_type', dir: 'desc' }])
  })

  it('accepts the snake_case plot_type alias', async () => {
    expect(await resolvedSort('sortField=plot_type&sortDir=asc')).toEqual([{ field: 'plot_type', dir: 'asc' }])
  })

  it('orders by the origin_country column when sorting by originCountry', async () => {
    expect(await resolvedSort('sortField=originCountry&sortDir=asc')).toEqual([{ field: 'origin_country', dir: 'asc' }])
    expect(await resolvedSort('sortField=origin_country&sortDir=desc')).toEqual([{ field: 'origin_country', dir: 'desc' }])
  })

  it('keeps the previously working columns mapped', async () => {
    expect(await resolvedSort('sortField=name&sortDir=asc')).toEqual([{ field: 'name', dir: 'asc' }])
    expect(await resolvedSort('sortField=areaHa&sortDir=desc')).toEqual([{ field: 'area_ha', dir: 'desc' }])
    expect(await resolvedSort('sortField=updatedAt&sortDir=asc')).toEqual([{ field: 'updated_at', dir: 'asc' }])
  })
})
