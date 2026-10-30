import type { AssortmentScope, EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { normalizeFilters, type NormalizedFilter } from '@open-mercato/shared/lib/query/join-utils'
import type { QueryOptions, Where } from '@open-mercato/shared/lib/query/types'
import { categoryScopeKey, tagScopeKey } from '@open-mercato/core/modules/catalog/lib/productScopeKeys'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999'
const BINDING_ID = '33333333-3333-4333-8333-333333333333'
const CAT_A = '0b8f3f0e-1d2a-4c5b-8e6f-000000000001'
const CAT_B = '0b8f3f0e-1d2a-4c5b-8e6f-000000000002'
const TAG_T = '0b8f3f0e-1d2a-4c5b-8e6f-000000000011'

type BindingState = {
  id: string
  tenantId: string
  organizationId: string
  deletedAt: Date | null
  assortmentScope: AssortmentScope | null
  requireAuthentication: boolean
}

type IndexRow = Record<string, unknown> & { id: string }

function product(
  id: string,
  overrides: { scopeKeys?: string[] | null; active?: boolean; organizationId?: string; deleted?: boolean } = {},
): IndexRow {
  return {
    id,
    tenant_id: TENANT_ID,
    organization_id: overrides.organizationId ?? ORG_ID,
    deleted_at: overrides.deleted ? new Date('2026-01-01T00:00:00Z') : null,
    is_active: overrides.active ?? true,
    ...(overrides.scopeKeys === null ? {} : { scope_keys: overrides.scopeKeys ?? [] }),
  }
}

const PRODUCTS: IndexRow[] = [
  product('p1', { scopeKeys: [categoryScopeKey(CAT_A)] }),
  product('p2', { scopeKeys: [categoryScopeKey(CAT_A), tagScopeKey(TAG_T)] }),
  product('p3', { scopeKeys: [categoryScopeKey(CAT_B)] }),
  product('p4', { scopeKeys: null }),
  product('p5', { scopeKeys: [categoryScopeKey(CAT_A)], active: false }),
  product('p6', { scopeKeys: [categoryScopeKey(CAT_A)], organizationId: OTHER_ORG_ID }),
  product('p7', { scopeKeys: [categoryScopeKey(CAT_A)], deleted: true }),
]

function evaluateLeaf(row: IndexRow, filter: NormalizedFilter): boolean {
  const actual = row[filter.field]
  const list = Array.isArray(filter.value) ? filter.value.map(String) : [String(filter.value)]
  switch (filter.op) {
    case 'eq':
      return filter.value === null ? actual === null || actual === undefined : actual === filter.value
    case 'nin':
      return !list.includes(String(actual))
    case 'exists':
      return filter.value ? actual !== undefined && actual !== null : actual === undefined || actual === null
    case 'overlap':
      return Array.isArray(actual) && actual.some((entry) => list.includes(String(entry)))
    case 'noverlap':
      return Array.isArray(actual) && !actual.some((entry) => list.includes(String(entry)))
    default:
      throw new Error(`[internal] fake query engine does not support ${filter.op}`)
  }
}

function rowMatches(row: IndexRow, filters: Where): boolean {
  const normalized = normalizeFilters(filters)
  const regular = normalized.filter((filter) => !filter.orGroup)
  if (!regular.every((filter) => evaluateLeaf(row, filter))) return false
  const groups = new Map<string, NormalizedFilter[]>()
  for (const filter of normalized) {
    if (!filter.orGroup) continue
    const group = groups.get(filter.orGroup) ?? []
    group.push(filter)
    groups.set(filter.orGroup, group)
  }
  if (groups.size === 0) return true
  return Array.from(groups.values()).some((group) => group.every((filter) => evaluateLeaf(row, filter)))
}

let binding: BindingState
let defaultGroupScope: EffectiveAssortmentScope = null
let authValue: Record<string, unknown> | null = null
const queryCalls: QueryOptions[] = []

const queryEngine = {
  async query(_entity: string, options: QueryOptions = {}) {
    queryCalls.push(options)
    const rows = PRODUCTS.filter(
      (row) =>
        row.tenant_id === options.tenantId &&
        row.organization_id === options.organizationId &&
        rowMatches(row, (options.filters ?? {}) as Where),
    )
    return { items: rows.slice(0, options.page?.pageSize ?? 20).map((row) => ({ id: row.id })), total: rows.length, page: 1, pageSize: 1 }
  },
}

const em = {
  findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
    const matches =
      where.id === binding.id &&
      where.tenantId === binding.tenantId &&
      where.organizationId === binding.organizationId &&
      where.deletedAt === null &&
      binding.deletedAt === null
    return matches ? binding : null
  }),
  getKysely: () => {
    throw new Error('[internal] the anonymous buyer path must not read the customer overlay')
  },
  fork: (): unknown => em,
}

const customerGroupsService = {
  resolveGroups: jest.fn(async () => ({ groupIds: ['group-default'], groups: [] })),
  resolveTerms: jest.fn(async () => ({
    priceKindId: null,
    paymentTermsDays: null,
    allowPurchaseOnAccount: false,
    approvalRequiredAbove: null,
    minOrderValue: null,
    sources: {},
  })),
  resolveAssortmentScope: jest.fn(async () => ({
    scope: defaultGroupScope,
    sourceGroupIds: ['group-default'],
    sourceCustomerOverrideId: null,
  })),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'queryEngine') return queryEngine
    if (name === 'customerGroupsService') return customerGroupsService
    throw new Error(`[internal] ${name} is not registered`)
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => authValue),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => null),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (
    manager: { findOne: (entity: unknown, where: unknown) => Promise<unknown> },
    entity: unknown,
    where: unknown,
  ) => manager.findOne(entity, where),
}))
jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: jest.fn(async () => null),
}))
jest.mock('../../../../../events', () => ({
  emitEcommerceEvent: jest.fn(async () => undefined),
}))

import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { ecommerceStoreSettingsSchema } from '../../../../../data/validators'
import { composeStoreContext, resolveBuyerContext } from '../../../../../lib/buyerContext'
import type { ResolvedStore } from '../../../../../lib/storeContext'
import {
  buildStorefrontProductScope,
  composeStorefrontProductFilters,
} from '../../../../../lib/storefrontProductScope'
import { GET, metadata, openApi } from '../route'

function request(query: Record<string, string> = {}): Request {
  const search = new URLSearchParams(query).toString()
  return new Request(`http://localhost/api/ecommerce/store-channel-bindings/${BINDING_ID}/assortment-count${search ? `?${search}` : ''}`)
}

const params = (id: string = BINDING_ID) => ({ params: Promise.resolve({ id }) })

function resolvedStoreFor(source: BindingState): ResolvedStore {
  return {
    source: 'host',
    store: {
      id: 'store-1',
      code: 'main',
      name: 'Main',
      slug: 'main',
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      defaultCurrencyCode: 'EUR',
      settings: ecommerceStoreSettingsSchema.parse({}),
    },
    tenantId: source.tenantId,
    organizationId: source.organizationId,
    channel: {
      channelBindingId: source.id,
      salesChannelId: 'sales-channel-1',
      priceKindId: null,
      priceSortFallback: 'approximate',
      assortmentScope: source.assortmentScope,
      requireAuthentication: source.requireAuthentication,
    },
    domain: null,
    effectiveLocale: 'en',
    requestedLocale: null,
    currencyCode: 'EUR',
  }
}

async function storefrontListingTotal(source: BindingState): Promise<{ total: number; filters: Where }> {
  const store = resolvedStoreFor(source)
  const buyer = await resolveBuyerContext({ resolve: (name: string) => container.resolve(name) }, store, null)
  const ctx = composeStoreContext(store, buyer)
  const productScope = buildStorefrontProductScope(ctx)
  const filters = composeStorefrontProductFilters(productScope)
  const result = await queryEngine.query('catalog:catalog_product', {
    tenantId: productScope.tenantId,
    organizationId: productScope.organizationId,
    withDeleted: productScope.withDeleted,
    filters,
    page: { page: 1, pageSize: 1 },
  })
  return { total: result.total, filters }
}

describe('GET /store-channel-bindings/:id/assortment-count', () => {
  beforeEach(() => {
    binding = {
      id: BINDING_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      deletedAt: null,
      assortmentScope: { categoryIds: [CAT_A] },
      requireAuthentication: false,
    }
    defaultGroupScope = null
    authValue = { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID }
    queryCalls.length = 0
    jest.clearAllMocks()
  })

  describe('contract', () => {
    it('is gated behind ecommerce.stores.view only', () => {
      expect(metadata).toEqual({ GET: { requireAuth: true, requireFeatures: ['ecommerce.stores.view'] } })
      const required = metadata.GET.requireFeatures
      expect(authorizeFeatures(required, { grantedFeatures: ['ecommerce.channels.manage'], unrestricted: false, scopeAllowed: true })).toBe(false)
      expect(authorizeFeatures(required, { grantedFeatures: ['ecommerce.stores.view'], unrestricted: false, scopeAllowed: true })).toBe(true)
    })

    it('documents the draft parameters, the response and the error statuses', () => {
      const get = openApi.methods.GET
      expect(get?.query).toBeDefined()
      expect(get?.responses?.[0]?.status).toBe(200)
      expect(get?.errors?.map((error) => error.status)).toEqual(expect.arrayContaining([400, 401, 403, 404]))
    })

    it('answers 401 without an authenticated tenant', async () => {
      authValue = null
      const response = await GET(request(), params())
      expect(response.status).toBe(401)
      expect(queryCalls).toHaveLength(0)
    })
  })

  describe('saved scope', () => {
    it('counts the active in-scope products of the binding organization for an anonymous buyer', async () => {
      const response = await GET(request(), params())
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        count: 2,
        scopeSource: 'saved',
        requireAuthentication: false,
        reducedByAuthentication: false,
        countWithoutAuthentication: 2,
        unindexedCount: 1,
      })
      for (const call of queryCalls) {
        expect(call.tenantId).toBe(TENANT_ID)
        expect(call.organizationId).toBe(ORG_ID)
        expect(call.withDeleted).toBe(false)
      }
    })

    it('counts every active product of an unrestricted channel and reports no unindexed products', async () => {
      binding.assortmentScope = null
      const body = await (await GET(request(), params())).json()
      expect(body.count).toBe(4)
      expect(body.unindexedCount).toBe(0)
    })

    it('intersects the channel scope with the default customer group scope like the storefront does', async () => {
      defaultGroupScope = [{ tagIds: [TAG_T] }]
      const body = await (await GET(request(), params())).json()
      expect(body.count).toBe(1)
      expect(customerGroupsService.resolveAssortmentScope).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: null, customerIds: [], tenantId: TENANT_ID }),
      )
    })

    it('counts 0 when the default customer group grants nothing', async () => {
      defaultGroupScope = []
      const body = await (await GET(request(), params())).json()
      expect(body.count).toBe(0)
      expect(body.countWithoutAuthentication).toBe(0)
      expect(body.reducedByAuthentication).toBe(false)
    })
  })

  describe('draft scope', () => {
    it('counts the unsaved scope instead of the stored one and labels it draft', async () => {
      const response = await GET(request({ draftScope: JSON.stringify({ categoryIds: [CAT_B] }) }), params())
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({ count: 1, scopeSource: 'draft' })
      expect(binding.assortmentScope).toEqual({ categoryIds: [CAT_A] })
    })

    it('applies draft excludes', async () => {
      const draft = { categoryIds: [CAT_A], excludeTagIds: [TAG_T] }
      const body = await (await GET(request({ draftScope: JSON.stringify(draft) }), params())).json()
      expect(body.count).toBe(1)
    })

    it('treats draftScope=null as an unrestricted channel', async () => {
      const body = await (await GET(request({ draftScope: 'null' }), params())).json()
      expect(body).toMatchObject({ count: 4, scopeSource: 'draft', unindexedCount: 0 })
    })

    it('rejects allOf, which no admin-authored scope may carry', async () => {
      const draft = { categoryIds: [CAT_A], allOf: [{ tagIds: [TAG_T] }] }
      const response = await GET(request({ draftScope: JSON.stringify(draft) }), params())
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(Object.keys(body.fieldErrors)).toEqual(['draftScope'])
      expect(queryCalls).toHaveLength(0)
    })

    it.each([
      ['malformed JSON', '{"categoryIds":'],
      ['an unknown key', JSON.stringify({ categoryIds: [CAT_A], brandIds: [CAT_B] })],
      ['a non-uuid id', JSON.stringify({ categoryIds: ['not-a-uuid'] })],
      ['a non-object value', JSON.stringify([CAT_A])],
      ['an empty value', ''],
    ])('rejects %s with a draftScope field error', async (_label, value) => {
      const response = await GET(request({ draftScope: value }), params())
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.fieldErrors.draftScope).toEqual(expect.any(String))
      expect(body.error).toBe(body.fieldErrors.draftScope)
    })

    it('rejects a draftScope given twice', async () => {
      const search = new URLSearchParams()
      search.append('draftScope', 'null')
      search.append('draftScope', 'null')
      const response = await GET(
        new Request(`http://localhost/api/ecommerce/store-channel-bindings/${BINDING_ID}/assortment-count?${search.toString()}`),
        params(),
      )
      expect(response.status).toBe(400)
    })
  })

  describe('require_authentication', () => {
    it('counts 0 for an anonymous buyer and reports how many products the gate hides', async () => {
      binding.requireAuthentication = true
      const body = await (await GET(request(), params())).json()
      expect(body).toEqual({
        count: 0,
        scopeSource: 'saved',
        requireAuthentication: true,
        reducedByAuthentication: true,
        countWithoutAuthentication: 2,
        unindexedCount: 1,
      })
    })

    it('does not flag the reduction when the scope matches nothing anyway', async () => {
      binding.requireAuthentication = true
      binding.assortmentScope = { categoryIds: ['0b8f3f0e-1d2a-4c5b-8e6f-0000000000ff'] }
      const body = await (await GET(request(), params())).json()
      expect(body).toMatchObject({ count: 0, countWithoutAuthentication: 0, reducedByAuthentication: false })
    })

    it('lets draftRequireAuthentication override the stored switch in both directions', async () => {
      const gated = await (await GET(request({ draftRequireAuthentication: 'true' }), params())).json()
      expect(gated).toMatchObject({ count: 0, requireAuthentication: true, reducedByAuthentication: true, scopeSource: 'saved' })

      binding.requireAuthentication = true
      const open = await (await GET(request({ draftRequireAuthentication: 'false' }), params())).json()
      expect(open).toMatchObject({ count: 2, requireAuthentication: false, reducedByAuthentication: false })
    })

    it('combines a draft scope with a draft switch', async () => {
      const body = await (
        await GET(request({ draftScope: JSON.stringify({ categoryIds: [CAT_B] }), draftRequireAuthentication: '1' }), params())
      ).json()
      expect(body).toMatchObject({ count: 0, countWithoutAuthentication: 1, reducedByAuthentication: true, scopeSource: 'draft' })
    })

    it('rejects a draftRequireAuthentication that is not a boolean', async () => {
      const response = await GET(request({ draftRequireAuthentication: 'maybe' }), params())
      expect(response.status).toBe(400)
      expect((await response.json()).fieldErrors.draftRequireAuthentication).toEqual(expect.any(String))
    })
  })

  describe('equality with the storefront listing', () => {
    it.each([
      ['a category scope', { categoryIds: [CAT_A] } as AssortmentScope | null, null as EffectiveAssortmentScope, false],
      ['an unrestricted channel', null, null, false],
      ['excludes', { categoryIds: [CAT_A], excludeTagIds: [TAG_T] }, null, false],
      ['a channel and group intersection', { categoryIds: [CAT_A] }, [{ tagIds: [TAG_T] }], false],
      ['a deny-all default group', { categoryIds: [CAT_A] }, [], false],
      ['an authentication-gated channel', { categoryIds: [CAT_A] }, null, true],
    ])('returns the listing total and runs the same filters for %s', async (_label, channelScope, groupScope, gated) => {
      binding.assortmentScope = channelScope
      binding.requireAuthentication = gated
      defaultGroupScope = groupScope
      const listing = await storefrontListingTotal(binding)
      queryCalls.length = 0

      const body = await (await GET(request(), params())).json()

      expect(body.count).toBe(listing.total)
      if (!gated && groupScope?.length !== 0) expect(queryCalls[0].filters).toEqual(listing.filters)
    })

    it('matches the listing for a draft scope once it is saved', async () => {
      const draft: AssortmentScope = { categoryIds: [CAT_B] }
      const draftBody = await (await GET(request({ draftScope: JSON.stringify(draft) }), params())).json()
      binding.assortmentScope = draft
      const listing = await storefrontListingTotal(binding)
      expect(draftBody.count).toBe(listing.total)
    })
  })

  describe('scoping', () => {
    it('answers 404 for a binding in another organization of the same tenant', async () => {
      binding.organizationId = OTHER_ORG_ID
      const response = await GET(request(), params())
      expect(response.status).toBe(404)
      expect(queryCalls).toHaveLength(0)
    })

    it('answers 404 for a binding of another tenant', async () => {
      binding.tenantId = '88888888-8888-4888-8888-888888888888'
      expect((await GET(request(), params())).status).toBe(404)
    })

    it('answers 404 for a soft-deleted binding and for a malformed id', async () => {
      binding.deletedAt = new Date('2026-01-01T00:00:00Z')
      expect((await GET(request(), params())).status).toBe(404)
      binding.deletedAt = null
      expect((await GET(request(), params('not-a-uuid'))).status).toBe(404)
    })

    it('validates the binding before it looks at the draft parameters', async () => {
      binding.organizationId = OTHER_ORG_ID
      const response = await GET(request({ draftScope: '{' }), params())
      expect(response.status).toBe(404)
    })

    it('asks for an organization when none is selected', async () => {
      authValue = { sub: 'user-1', tenantId: TENANT_ID }
      const response = await GET(request(), params())
      expect(response.status).toBe(400)
      expect(queryCalls).toHaveLength(0)
    })
  })
})
