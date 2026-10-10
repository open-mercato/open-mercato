import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'
import type { CacheStrategy } from '@open-mercato/cache'
import { emitEcommerceEvent } from '../../events'
import {
  DEV_STORE_SLUG_ENV,
  STORE_RESOLUTION_TTL_MS,
  StorefrontResolutionError,
  isStorefrontResolutionError,
  normalizeRequestHost,
  pathPrefixMatches,
  resolveStoreBySlug,
  resolveStoreFromRequest,
  type StoreContextContainer,
} from '../storeContext'

jest.mock('../../events', () => ({
  emitEcommerceEvent: jest.fn(async () => undefined),
}))

const mockedEmit = emitEcommerceEvent as jest.Mock

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const MAPPING_ID = '33333333-3333-4333-8333-333333333333'
const HOST = 'shop.example.com'

type Row = Record<string, unknown>

function storeRow(overrides: Row = {}): Row {
  const storeId = typeof overrides.store_id === 'string' ? overrides.store_id : 'store-root'
  return {
    store_id: storeId,
    store_tenant_id: TENANT_ID,
    store_organization_id: ORG_ID,
    store_code: storeId,
    store_name: `Store ${storeId}`,
    store_slug: storeId,
    store_status: 'active',
    store_default_locale: 'en',
    store_supported_locales: ['en', 'de', 'pl'],
    store_default_currency_code: 'EUR',
    store_settings: {},
    channel_binding_id: `channel-binding-${storeId}`,
    channel_sales_channel_id: `sales-channel-${storeId}`,
    channel_price_kind_id: null,
    channel_assortment_scope: null,
    channel_price_sort_fallback: 'approximate',
    channel_require_authentication: false,
    binding_id: `domain-binding-${storeId}`,
    binding_path_prefix: null,
    binding_is_primary: true,
    ...overrides,
  }
}

type Harness = {
  container: StoreContextContainer
  queries: CompiledQuery[]
  cacheSets: Array<{ key: string; ttl?: number; tags?: string[] }>
  resolveByHostname: jest.Mock
}

function createHarness(options: {
  domainRows?: Row[]
  slugRows?: Row[]
  mapping?: Row | null
  withDomainService?: boolean
} = {}): Harness {
  const queries: CompiledQuery[] = []
  const db = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<Record<string, never>>) => new PostgresIntrospector(instance),
    },
  })
  const executor = db.getExecutor() as unknown as { executeQuery: (query: CompiledQuery) => Promise<{ rows: Row[] }> }
  executor.executeQuery = async (query: CompiledQuery) => {
    queries.push(query)
    const fromDomainBindings = query.sql.includes('from "ecommerce_store_domain_bindings"')
    return { rows: fromDomainBindings ? options.domainRows ?? [] : options.slugRows ?? [] }
  }
  const em = { getKysely: () => db }

  const entries = new Map<string, unknown>()
  const cacheSets: Harness['cacheSets'] = []
  const cache = {
    async get(key: string) {
      return entries.has(key) ? entries.get(key) : null
    },
    async set(key: string, value: unknown, setOptions?: { ttl?: number; tags?: string[] }) {
      cacheSets.push({ key, ttl: setOptions?.ttl, tags: setOptions?.tags })
      entries.set(key, JSON.parse(JSON.stringify(value)))
    },
    async deleteByTags() {
      return 0
    },
  } as unknown as CacheStrategy

  const mapping =
    options.mapping === undefined
      ? { domainMappingId: MAPPING_ID, hostname: HOST, tenantId: TENANT_ID, organizationId: ORG_ID, status: 'active' }
      : options.mapping
  const resolveByHostname = jest.fn(async () => mapping)
  const services: Record<string, unknown> = { em, cache }
  if (options.withDomainService !== false) services.domainMappingService = { resolveByHostname }

  const container: StoreContextContainer = {
    resolve: (name: string) => {
      if (!(name in services)) throw new Error(`[internal] unregistered ${name}`)
      return services[name]
    },
  }
  return { container, queries, cacheSets, resolveByHostname }
}

function request(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://${HOST}${path}`, { headers: { host: HOST, ...headers } })
}

async function expectResolutionError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<StorefrontResolutionError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(StorefrontResolutionError)
  const resolutionError = error as StorefrontResolutionError
  expect(resolutionError.status).toBe(status)
  expect(resolutionError.code).toBe(code)
  return resolutionError
}

describe('resolveStoreFromRequest — host resolution', () => {
  const originalFlag = process.env[DEV_STORE_SLUG_ENV]

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env[DEV_STORE_SLUG_ENV]
  })

  afterAll(() => {
    if (originalFlag === undefined) delete process.env[DEV_STORE_SLUG_ENV]
    else process.env[DEV_STORE_SLUG_ENV] = originalFlag
  })

  it('resolves an active host to its store, channel binding, tenant and organization with one query', async () => {
    const harness = createHarness({ domainRows: [storeRow({ channel_price_kind_id: 'price-kind-1' })] })

    const resolved = await resolveStoreFromRequest(harness.container, request('/products/red-dress'))

    expect(resolved.source).toBe('host')
    expect(resolved.store.id).toBe('store-root')
    expect(resolved.store.status).toBe('active')
    expect(resolved.store.settings.display.priceDisplayModeDefault).toBe('gross')
    expect(resolved.tenantId).toBe(TENANT_ID)
    expect(resolved.organizationId).toBe(ORG_ID)
    expect(resolved.channel).toEqual({
      channelBindingId: 'channel-binding-store-root',
      salesChannelId: 'sales-channel-store-root',
      priceKindId: 'price-kind-1',
      priceSortFallback: 'approximate',
      assortmentScope: null,
      requireAuthentication: false,
    })
    expect(resolved.domain).toEqual({
      domainMappingId: MAPPING_ID,
      hostname: HOST,
      bindingId: 'domain-binding-store-root',
      pathPrefix: null,
      isPrimary: true,
    })
    expect(resolved.currencyCode).toBe('EUR')
    expect(harness.queries).toHaveLength(1)
    const [query] = harness.queries
    expect(query.sql).toContain('inner join "ecommerce_stores"')
    expect(query.sql).toContain('left join "ecommerce_store_channel_bindings"')
    expect(query.parameters).toEqual(expect.arrayContaining([MAPPING_ID, TENANT_ID, ORG_ID]))
  })

  it('carries the channel binding requireAuthentication flag through store resolution', async () => {
    const harness = createHarness({ domainRows: [storeRow({ channel_require_authentication: true })] })

    const resolved = await resolveStoreFromRequest(harness.container, request('/'))

    expect(resolved.channel.requireAuthentication).toBe(true)
    expect(harness.queries[0].sql).toContain('"c"."require_authentication" as "channel_require_authentication"')
  })

  it('normalizes the Host header before asking domainMappingService', async () => {
    const harness = createHarness({ domainRows: [storeRow()] })

    await resolveStoreFromRequest(harness.container, request('/', { host: 'Shop.Example.COM.:8443' }))

    expect(harness.resolveByHostname).toHaveBeenCalledWith('shop.example.com')
    expect(normalizeRequestHost('[::1]:3000')).toBe('[::1]')
    expect(normalizeRequestHost('  ')).toBeNull()
  })

  it('answers 404 for an unknown host without querying ecommerce tables', async () => {
    const harness = createHarness({ mapping: null, domainRows: [storeRow()] })

    await expectResolutionError(resolveStoreFromRequest(harness.container, request('/')), 404, 'store_not_found')
    expect(harness.queries).toHaveLength(0)
  })

  it('answers 404 for a verified-but-not-active host (the service returns only active mappings)', async () => {
    const harness = createHarness({ mapping: null, domainRows: [storeRow()] })
    await expectResolutionError(resolveStoreFromRequest(harness.container, request('/')), 404, 'store_not_found')

    const leaky = createHarness({
      mapping: { domainMappingId: MAPPING_ID, hostname: HOST, tenantId: TENANT_ID, organizationId: ORG_ID, status: 'verified' },
      domainRows: [storeRow()],
    })
    await expectResolutionError(resolveStoreFromRequest(leaky.container, request('/')), 404, 'store_not_found')
    expect(leaky.queries).toHaveLength(0)
  })

  it('degrades to 404 when domainMappingService is not registered', async () => {
    const harness = createHarness({ withDomainService: false, domainRows: [storeRow()] })

    await expectResolutionError(resolveStoreFromRequest(harness.container, request('/')), 404, 'store_not_found')
  })

  it('answers 404 when an active mapping has no store binding, without disclosing details', async () => {
    const harness = createHarness({ domainRows: [] })

    const error = await expectResolutionError(
      resolveStoreFromRequest(harness.container, request('/')),
      404,
      'store_not_found',
    )
    expect(error.message).not.toContain(HOST)
    expect(error.message).not.toContain(MAPPING_ID)
  })

  it('selects the longest matching path prefix on a path-segment boundary', async () => {
    const rows = [
      storeRow({ store_id: 'store-root', binding_path_prefix: null }),
      storeRow({ store_id: 'store-shop', binding_path_prefix: '/shop' }),
    ]

    const shop = await resolveStoreFromRequest(createHarness({ domainRows: rows }).container, request('/shop/products/x'))
    expect(shop.store.id).toBe('store-shop')
    expect(shop.domain?.pathPrefix).toBe('/shop')

    const shopRoot = await resolveStoreFromRequest(createHarness({ domainRows: rows }).container, request('/Shop/'))
    expect(shopRoot.store.id).toBe('store-shop')

    const root = await resolveStoreFromRequest(createHarness({ domainRows: rows }).container, request('/'))
    expect(root.store.id).toBe('store-root')

    const shopping = await resolveStoreFromRequest(createHarness({ domainRows: rows }).container, request('/shopping'))
    expect(shopping.store.id).toBe('store-root')

    const explicit = await resolveStoreFromRequest(
      createHarness({ domainRows: rows }).container,
      request('/api/ecommerce/storefront/context'),
      { pathname: '/shop/cart' },
    )
    expect(explicit.store.id).toBe('store-shop')
  })

  it('does not let /shopping match a /shop-only binding', async () => {
    const rows = [storeRow({ store_id: 'store-shop', binding_path_prefix: '/shop' })]

    await expectResolutionError(
      resolveStoreFromRequest(createHarness({ domainRows: rows }).container, request('/shopping')),
      404,
      'store_not_found',
    )
    expect(pathPrefixMatches('/shop', '/shop')).toBe(true)
    expect(pathPrefixMatches('/shop', '/shop/a')).toBe(true)
    expect(pathPrefixMatches('/shop', '/shopping')).toBe(false)
    expect(pathPrefixMatches(null, '/anything')).toBe(true)
  })

  it('hides a draft store as 404 by default and answers 403 with the dev flag', async () => {
    const rows = [storeRow({ store_status: 'draft' })]

    await expectResolutionError(
      resolveStoreFromRequest(createHarness({ domainRows: rows }).container, request('/')),
      404,
      'store_not_found',
    )

    process.env[DEV_STORE_SLUG_ENV] = 'true'
    await expectResolutionError(
      resolveStoreFromRequest(createHarness({ domainRows: rows }).container, request('/')),
      403,
      'store_draft',
    )
  })

  it('answers 410 for an archived store', async () => {
    const rows = [storeRow({ store_status: 'archived' })]

    await expectResolutionError(
      resolveStoreFromRequest(createHarness({ domainRows: rows }).container, request('/')),
      410,
      'store_archived',
    )
  })

  it('answers 503 without a default channel binding and emits the misconfiguration event once per hour', async () => {
    const rows = [
      storeRow({
        channel_binding_id: null,
        channel_sales_channel_id: null,
        channel_price_sort_fallback: null,
      }),
    ]
    const harness = createHarness({ domainRows: rows })

    await expectResolutionError(resolveStoreFromRequest(harness.container, request('/')), 503, 'store_misconfigured')
    await expectResolutionError(resolveStoreFromRequest(harness.container, request('/')), 503, 'store_misconfigured')

    expect(mockedEmit).toHaveBeenCalledTimes(1)
    expect(mockedEmit).toHaveBeenCalledWith(
      'ecommerce.store.misconfigured',
      expect.objectContaining({
        id: 'store-root',
        storeId: 'store-root',
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        reason: 'channel_binding_missing',
      }),
      expect.objectContaining({ persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID }),
    )
    const throttle = harness.cacheSets.find((entry) => entry.key.includes('misconfigured'))
    expect(throttle?.ttl).toBe(3_600_000)
  })

  it('serves the second resolution from the resolution cache with store, domain and mapping tags', async () => {
    const harness = createHarness({ domainRows: [storeRow()] })

    await resolveStoreFromRequest(harness.container, request('/'))
    const second = await resolveStoreFromRequest(harness.container, request('/'))

    expect(second.store.id).toBe('store-root')
    expect(harness.queries).toHaveLength(1)
    const resolutionSet = harness.cacheSets.find((entry) => entry.key.includes('domain-mapping'))
    expect(resolutionSet?.ttl).toBe(STORE_RESOLUTION_TTL_MS)
    expect(resolutionSet?.tags).toEqual(
      expect.arrayContaining([
        'ecommerce-store:store-root',
        `ecommerce-domain:${HOST}`,
        `ecommerce-domain-mapping:${MAPPING_ID}`,
      ]),
    )
  })
})

describe('resolveStoreFromRequest — dev store slug', () => {
  const originalFlag = process.env[DEV_STORE_SLUG_ENV]

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env[DEV_STORE_SLUG_ENV]
  })

  afterAll(() => {
    if (originalFlag === undefined) delete process.env[DEV_STORE_SLUG_ENV]
    else process.env[DEV_STORE_SLUG_ENV] = originalFlag
  })

  it('rejects ?storeSlug= with 400 when the flag is unset, regardless of NODE_ENV', async () => {
    const harness = createHarness({ slugRows: [storeRow({ binding_id: undefined })] })

    await expectResolutionError(
      resolveStoreFromRequest(harness.container, request('/?storeSlug=store-root')),
      400,
      'store_slug_not_allowed',
    )
    await expectResolutionError(resolveStoreBySlug(harness.container, 'store-root'), 400, 'store_slug_not_allowed')
    expect(harness.queries).toHaveLength(0)
    expect(harness.resolveByHostname).not.toHaveBeenCalled()
  })

  it('accepts ?storeSlug= with the flag, bypassing DomainMapping', async () => {
    process.env[DEV_STORE_SLUG_ENV] = 'true'
    const slugRow = storeRow({ binding_id: undefined, binding_path_prefix: undefined, binding_is_primary: undefined })
    const harness = createHarness({ slugRows: [slugRow] })

    const resolved = await resolveStoreFromRequest(harness.container, request('/?storeSlug=Store-Root'))

    expect(resolved.source).toBe('slug')
    expect(resolved.store.id).toBe('store-root')
    expect(resolved.domain).toBeNull()
    expect(resolved.tenantId).toBe(TENANT_ID)
    expect(harness.resolveByHostname).not.toHaveBeenCalled()
    expect(harness.queries).toHaveLength(1)
    expect(harness.queries[0].parameters).toContain('store-root')
  })

  it('scopes slug resolution by tenant when one is supplied and 404s an ambiguous cross-tenant slug', async () => {
    process.env[DEV_STORE_SLUG_ENV] = '1'
    const scoped = createHarness({ slugRows: [storeRow({ binding_id: undefined })] })
    await resolveStoreBySlug(scoped.container, 'store-root', { tenantId: TENANT_ID })
    expect(scoped.queries[0].parameters).toEqual(expect.arrayContaining(['store-root', TENANT_ID]))

    const ambiguous = createHarness({
      slugRows: [
        storeRow({ binding_id: undefined }),
        storeRow({ binding_id: undefined, store_tenant_id: '44444444-4444-4444-8444-444444444444' }),
      ],
    })
    await expectResolutionError(resolveStoreBySlug(ambiguous.container, 'store-root'), 404, 'store_not_found')
  })

  it('answers 404 for an unknown or malformed slug with the flag on', async () => {
    process.env[DEV_STORE_SLUG_ENV] = 'true'
    const harness = createHarness({ slugRows: [] })

    await expectResolutionError(resolveStoreBySlug(harness.container, 'missing'), 404, 'store_not_found')
    await expectResolutionError(resolveStoreBySlug(harness.container, '../etc'), 404, 'store_not_found')
  })
})

describe('resolveStoreFromRequest — locale', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env[DEV_STORE_SLUG_ENV]
  })

  async function resolveLocale(path: string, headers: Record<string, string> = {}) {
    const harness = createHarness({ domainRows: [storeRow()] })
    const resolved = await resolveStoreFromRequest(harness.container, request(path, headers))
    return { effectiveLocale: resolved.effectiveLocale, requestedLocale: resolved.requestedLocale }
  }

  it('prefers ?locale over X-Locale over Accept-Language', async () => {
    expect(await resolveLocale('/?locale=pl', { 'x-locale': 'de', 'accept-language': 'en' })).toEqual({
      effectiveLocale: 'pl',
      requestedLocale: 'pl',
    })
    expect(await resolveLocale('/', { 'x-locale': 'de', 'accept-language': 'pl' })).toEqual({
      effectiveLocale: 'de',
      requestedLocale: 'de',
    })
  })

  it('honors Accept-Language q-values and picks the first supported language', async () => {
    expect(await resolveLocale('/', { 'accept-language': 'fr-FR;q=0.9, de-AT;q=0.8, pl;q=0.85, *;q=0.1' })).toEqual({
      effectiveLocale: 'pl',
      requestedLocale: null,
    })
  })

  it('falls back to the store default for an unsupported request and preserves requestedLocale', async () => {
    expect(await resolveLocale('/?locale=fr')).toEqual({ effectiveLocale: 'en', requestedLocale: 'fr' })
    expect(await resolveLocale('/', { 'accept-language': 'ja, zh;q=0.5' })).toEqual({
      effectiveLocale: 'en',
      requestedLocale: null,
    })
  })

  it('falls through an unsupported explicit locale to a supported Accept-Language entry', async () => {
    expect(await resolveLocale('/?locale=fr', { 'accept-language': 'de' })).toEqual({
      effectiveLocale: 'de',
      requestedLocale: 'fr',
    })
  })
})

describe('isStorefrontResolutionError', () => {
  it('recognizes an error thrown by another loaded copy of the module', () => {
    let foreignError: unknown = null
    jest.isolateModules(() => {
      const foreign = jest.requireActual<typeof import('../storeContext')>('../storeContext')
      foreignError = new foreign.StorefrontResolutionError(404, 'store_not_found')
    })
    expect(foreignError).not.toBeInstanceOf(StorefrontResolutionError)
    expect(isStorefrontResolutionError(foreignError)).toBe(true)
    expect(isStorefrontResolutionError(new StorefrontResolutionError(410, 'store_archived'))).toBe(true)
  })

  it('rejects errors that only look alike', () => {
    const lookalike = Object.assign(new Error('nope'), { name: 'StorefrontResolutionError', status: 404, code: 'store_not_found' })
    expect(isStorefrontResolutionError(lookalike)).toBe(false)
    expect(isStorefrontResolutionError(null)).toBe(false)
    expect(isStorefrontResolutionError('store_not_found')).toBe(false)
  })
})
