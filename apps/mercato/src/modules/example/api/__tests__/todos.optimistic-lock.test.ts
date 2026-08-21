/** @jest-environment node */
/**
 * Optimistic-lock wire coverage for the Todo CRUD route.
 *
 * The module README advertises `updated_at` + optimistic locking as one of the
 * non-negotiables the canonical example demonstrates. That claim only holds if
 * the list projection actually selects `updated_at` and the response carries an
 * ISO `updatedAt`: `CrudForm` auto-derives the expected-version header from
 * `initialValues.updatedAt` (covering update AND delete), and the list-row
 * delete builds the same header from the row. Drop either and every Todo
 * mutation silently ships with no version header while the server-side guard
 * stays happy — the exact failure mode this file pins.
 *
 * The route module is imported for real; `makeCrudRoute` is intercepted only to
 * capture the options the route passes it, so the assertions run against the
 * shipped `list.fields` / `list.transformItem` implementations.
 */
const TENANT = '00000000-0000-4000-8000-00000000000a'
const ORG = '00000000-0000-4000-8000-0000000000a1'

type CapturedRouteOptions = {
  list: {
    fields: (query: unknown, ctx: unknown) => string[]
    sortFieldMap: Record<string, string>
    transformItem: (item: Record<string, unknown>) => Record<string, unknown>
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
import { todoListItemSchema } from '../openapi'

function routeOptions(): CapturedRouteOptions {
  if (!captured.options) throw new Error('[internal] makeCrudRoute was not called by the todos route')
  return captured.options
}

function emptyCtx() {
  return {
    container: { resolve: () => null },
    auth: { tenantId: TENANT, orgId: ORG },
    organizationScope: null,
    selectedOrganizationId: ORG,
    organizationIds: [ORG],
  }
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'todo-1',
    title: 'Ship the lock',
    is_done: false,
    tenant_id: TENANT,
    organization_id: ORG,
    created_at: new Date('2026-05-01T10:00:00.000Z'),
    updated_at: new Date('2026-05-02T11:22:33.444Z'),
    ...overrides,
  }
}

describe('example todos route — optimistic-lock version round-trip', () => {
  it('selects updated_at in the list projection', () => {
    expect(routeOptions().list.fields({}, emptyCtx())).toContain('updated_at')
  })

  it('returns updatedAt as an ISO string so CrudForm can auto-derive the header', () => {
    const transformed = routeOptions().list.transformItem(baseRow())

    expect(transformed.updatedAt).toBe('2026-05-02T11:22:33.444Z')
  })

  it('normalizes a string timestamp from the query engine to the same ISO form', () => {
    const transformed = routeOptions().list.transformItem(
      baseRow({ updated_at: '2026-05-02T11:22:33.444Z' }),
    )

    expect(transformed.updatedAt).toBe('2026-05-02T11:22:33.444Z')
  })

  it('emits null rather than an unusable token when updated_at is missing or invalid', () => {
    expect(routeOptions().list.transformItem(baseRow({ updated_at: null })).updatedAt).toBeNull()
    expect(routeOptions().list.transformItem(baseRow({ updated_at: 'not-a-date' })).updatedAt).toBeNull()
  })

  it('keeps updatedAt sortable through the sort field map', () => {
    expect(routeOptions().list.sortFieldMap.updatedAt).toBe('updated_at')
    expect(routeOptions().list.sortFieldMap.updated_at).toBe('updated_at')
  })

  it('documents updatedAt on the published list item schema', () => {
    const parsed = todoListItemSchema.parse(routeOptions().list.transformItem(baseRow()))

    expect(parsed.updatedAt).toBe('2026-05-02T11:22:33.444Z')
  })
})
