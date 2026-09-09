/** @jest-environment node */
/**
 * Regression coverage for per-request custom-field projection on the Todo CRUD route.
 *
 * `beforeList` discovers custom-field keys from tenant- and organization-scoped
 * `CustomFieldDef` rows. Those keys used to be written into module-scoped variables
 * (`dynamicCfKeys`, `sortFieldMapRef`) that `transformItem`, `sortFieldMap` and the CSV
 * export read back on *later* requests, so whichever tenant issued the previous request
 * decided the next tenant's projection, sort map and export columns.
 *
 * The canonical example module is the standalone reference implementation, so this file
 * is also the reference for "per-request discovery never lands in module scope".
 */
const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const ORG_A = '00000000-0000-4000-8000-0000000000a1'
const TENANT_B = '00000000-0000-4000-8000-00000000000b'
const ORG_B = '00000000-0000-4000-8000-0000000000b1'

type CustomFieldDefRow = {
  key: string
  tenantId: string | null
  organizationId: string | null
  isActive: boolean
  deletedAt: Date | null
  configJson: Record<string, unknown> | null
}

type MongoLikeFilter = Record<string, unknown> & { $and?: Array<Record<string, unknown>> }

const definitionsByTenant = new Map<string | null, CustomFieldDefRow[]>()
const valueKeysByTenant = new Map<string | null, string[]>()
const capturedDefinitionFilters: MongoLikeFilter[] = []

function createKyselyStub(tenantId: string | null) {
  const chain = {
    selectFrom: () => chain,
    select: () => chain,
    distinct: () => chain,
    where: () => chain,
    execute: async () => (valueKeysByTenant.get(tenantId) ?? []).map((key) => ({ field_key: key })),
  }
  return chain
}

function createEm(tenantId: string | null) {
  return {
    find: async (_entity: unknown, filter: MongoLikeFilter) => {
      capturedDefinitionFilters.push(filter)
      return definitionsByTenant.get(tenantId) ?? []
    },
    getKysely: () => createKyselyStub(tenantId),
  }
}

type TestCtx = {
  container: { resolve: (token: string) => unknown }
  auth: { tenantId: string | null; orgId: string | null }
  organizationScope: null
  selectedOrganizationId: string | null
  organizationIds: string[] | null
}

function createCtx(tenantId: string, orgId: string): TestCtx {
  const em = createEm(tenantId)
  return {
    container: { resolve: (token: string) => (token === 'em' ? em : null) },
    auth: { tenantId, orgId },
    organizationScope: null,
    selectedOrganizationId: orgId,
    organizationIds: [orgId],
  }
}

function definition(key: string, tenantId: string, organizationId: string): CustomFieldDefRow {
  return { key, tenantId, organizationId, isActive: true, deletedAt: null, configJson: null }
}

type CapturedRouteOptions = {
  hooks: { beforeList: (query: unknown, ctx: unknown) => Promise<void> }
  list: {
    fields: (query: unknown, ctx: unknown) => string[]
    sortFieldMap: Record<string, string>
    transformItem: (item: Record<string, unknown>) => Record<string, unknown>
    csv: {
      headers: (query: unknown, ctx: unknown) => string[]
      row: (item: Record<string, unknown>, ctx: unknown) => unknown[]
    }
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

describe('example todos route request scoping', () => {
  beforeEach(() => {
    definitionsByTenant.clear()
    valueKeysByTenant.clear()
    capturedDefinitionFilters.length = 0
  })

  it('scopes the custom field definition lookup by tenant and organization', async () => {
    const ctx = createCtx(TENANT_A, ORG_A)
    await routeOptions().hooks.beforeList({}, ctx)

    expect(capturedDefinitionFilters).toHaveLength(1)
    const filter = capturedDefinitionFilters[0]
    const branches = (filter.$and ?? []).flatMap((clause) => (clause as { $or?: Array<Record<string, unknown>> }).$or ?? [])
    expect(branches).toContainEqual({ tenantId: TENANT_A })
    expect(branches).toContainEqual({ organizationId: { $in: [ORG_A] } })
  })

  it('keeps one tenant discovered keys out of another tenant projection', async () => {
    definitionsByTenant.set(TENANT_A, [definition('alpha', TENANT_A, ORG_A)])
    definitionsByTenant.set(TENANT_B, [definition('beta', TENANT_B, ORG_B)])

    const ctxA = createCtx(TENANT_A, ORG_A)
    const ctxB = createCtx(TENANT_B, ORG_B)
    const options = routeOptions()

    await options.hooks.beforeList({}, ctxA)
    await options.hooks.beforeList({}, ctxB)

    // Tenant A's projection must survive tenant B's request landing in between.
    expect(options.list.fields({}, ctxA)).toContain('cf:alpha')
    expect(options.list.fields({}, ctxA)).not.toContain('cf:beta')
    expect(options.list.fields({}, ctxB)).toContain('cf:beta')
    expect(options.list.fields({}, ctxB)).not.toContain('cf:alpha')
  })

  it('keeps CSV export columns per request', async () => {
    definitionsByTenant.set(TENANT_A, [definition('alpha', TENANT_A, ORG_A)])
    definitionsByTenant.set(TENANT_B, [definition('beta', TENANT_B, ORG_B)])

    const ctxA = createCtx(TENANT_A, ORG_A)
    const ctxB = createCtx(TENANT_B, ORG_B)
    const options = routeOptions()

    await options.hooks.beforeList({}, ctxA)
    await options.hooks.beforeList({}, ctxB)

    const headersA = options.list.csv.headers({}, ctxA)
    expect(headersA).toContain('cf_alpha')
    expect(headersA).not.toContain('cf_beta')

    const rowA = options.list.csv.row(
      { id: 'todo-1', title: 'Alpha', is_done: false, organization_id: ORG_A, tenant_id: TENANT_A, cf_alpha: 'value-a' },
      ctxA,
    )
    expect(rowA[headersA.indexOf('cf_alpha')]).toBe('value-a')
  })

  it('falls back to code-declared keys for a context that never ran discovery', () => {
    const ctx = createCtx(TENANT_A, ORG_A)
    const fields = routeOptions().list.fields({}, ctx)

    expect(fields).toContain('id')
    expect(fields).toContain('created_at')
    expect(fields.some((field) => field.startsWith('cf:'))).toBe(true)
  })

  it('leaves no dynamic custom field entries in the module-level sort map', async () => {
    definitionsByTenant.set(TENANT_A, [definition('alpha', TENANT_A, ORG_A)])
    const ctx = createCtx(TENANT_A, ORG_A)
    const options = routeOptions()

    await options.hooks.beforeList({}, ctx)

    expect(Object.keys(options.list.sortFieldMap)).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/^cf_/)]),
    )
    expect(options.list.sortFieldMap.created_at).toBe('created_at')
  })

  it('reads custom field values off the row instead of a shared key list', () => {
    const transformed = routeOptions().list.transformItem({
      id: 'todo-1',
      title: 'Alpha',
      is_done: true,
      tenant_id: TENANT_A,
      organization_id: ORG_A,
      'cf:alpha': 'value-a',
    })

    expect(transformed).toMatchObject({ id: 'todo-1', is_done: true, cf_alpha: 'value-a' })
  })
})
