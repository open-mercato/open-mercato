import type { EntityManager } from '@mikro-orm/postgresql'
import type { AssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { secretEqual } from '@open-mercato/core/modules/customer_accounts/lib/secretCompare'
import {
  ECOMMERCE_STORE_SLUG_PATTERN,
  ecommercePriceSortFallbackSchema,
  ecommerceStoreSettingsSchema,
  ecommerceStoreStatusSchema,
  type EcommercePriceSortFallback,
  type EcommerceStoreSettings,
  type EcommerceStoreStatus,
} from '../data/validators'
import { emitEcommerceEvent } from '../events'
import {
  ecommerceDomainMappingTag,
  ecommerceDomainTag,
  ecommerceResolutionCache,
  ecommerceStoreTag,
  type CacheContainer,
} from './cacheKeys'
import { resolveStoreLocale, type StoreLocaleCandidates } from './storeLocale'
import type { StoreContextChannel, StoreContextStore } from './types'

/**
 * Store layer of storefront resolution (SPEC-029 §4.1 steps 1–5 and 7, §6.2, §8, §8.1).
 *
 * Host flow: normalized Host → `customer_accounts` `domainMappingService.resolveByHostname`
 * (returns `active` mappings only, D1) → ONE ecommerce query returning every binding of that
 * mapping joined with its store and the store's default channel binding (D6) → longest
 * `path_prefix` match on a path-segment boundary (R6). The candidate list is cached per mapping.
 *
 * Dev slug flow (D18): `?storeSlug=` only when `OM_ECOMMERCE_DEV_STORE_SLUG` is true, otherwise
 * `400`. A slug is unique within a tenant (§5.1), so slug resolution is tenant-scoped when the
 * caller supplies a tenant and otherwise requires the slug to be unique across tenants — an
 * ambiguous slug answers `404`.
 *
 * The buyer layer (Step 2.7) composes `ResolvedStore` into a full `StoreContext`.
 */

export const DEV_STORE_SLUG_ENV = 'OM_ECOMMERCE_DEV_STORE_SLUG'
export const STORE_RESOLUTION_TTL_MS = 300_000
export const STORE_MISCONFIGURED_THROTTLE_MS = 3_600_000

export type StorefrontResolutionErrorCode =
  | 'store_slug_not_allowed'
  | 'store_not_found'
  | 'store_draft'
  | 'store_archived'
  | 'store_misconfigured'
  | 'portal_session_scope_mismatch'
  | 'portal_session_invalid'

export type StorefrontResolutionStatus = 400 | 401 | 403 | 404 | 410 | 503

export class StorefrontResolutionError extends Error {
  readonly status: StorefrontResolutionStatus
  readonly code: StorefrontResolutionErrorCode

  constructor(status: StorefrontResolutionStatus, code: StorefrontResolutionErrorCode) {
    super(`[internal] storefront store resolution failed: ${code}`)
    this.name = 'StorefrontResolutionError'
    this.status = status
    this.code = code
  }
}

export function isStorefrontResolutionError(error: unknown): error is StorefrontResolutionError {
  return error instanceof StorefrontResolutionError
}

export type ResolvedStoreChannel = StoreContextChannel & {
  assortmentScope: AssortmentScope | null
  requireAuthentication: boolean
}

export type ResolvedStoreDomain = {
  domainMappingId: string
  hostname: string
  bindingId: string
  pathPrefix: string | null
  isPrimary: boolean
}

export type ResolvedStore = {
  source: 'host' | 'slug'
  store: StoreContextStore
  tenantId: string
  organizationId: string
  channel: ResolvedStoreChannel
  domain: ResolvedStoreDomain | null
  effectiveLocale: string
  requestedLocale: string | null
  currencyCode: string
}

export type StoreContextContainer = CacheContainer

export type ResolveStoreFromRequestOptions = {
  pathname?: string | null
}

export type ResolveStoreBySlugOptions = {
  tenantId?: string | null
  locale?: string | null
  headerLocale?: string | null
  acceptLanguage?: string | null
}

type DomainMappingResolution = {
  domainMappingId: string
  hostname: string
  tenantId: string
  organizationId: string
  status: string
}

type DomainMappingResolver = {
  resolveByHostname(hostname: string): Promise<DomainMappingResolution | null>
}

type CandidateStore = Omit<StoreContextStore, 'status'> & {
  status: EcommerceStoreStatus
  tenantId: string
  organizationId: string
}

type CandidateBinding = { id: string; pathPrefix: string | null; isPrimary: boolean }

type StoreCandidate = {
  store: CandidateStore
  channel: ResolvedStoreChannel | null
  binding: CandidateBinding | null
}

type CachedStoreCandidates = { candidates: StoreCandidate[] }

type StoreResolutionDatabase = {
  ecommerce_stores: {
    id: string
    tenant_id: string
    organization_id: string
    code: string
    name: string
    slug: string
    status: string
    default_locale: string
    supported_locales: unknown
    default_currency_code: string
    settings: unknown
    deleted_at: Date | null
  }
  ecommerce_store_domain_bindings: {
    id: string
    tenant_id: string
    organization_id: string
    store_id: string
    domain_mapping_id: string
    path_prefix: string | null
    is_primary: boolean
    deleted_at: Date | null
  }
  ecommerce_store_channel_bindings: {
    id: string
    tenant_id: string
    organization_id: string
    store_id: string
    sales_channel_id: string
    price_kind_id: string | null
    assortment_scope: unknown
    price_sort_fallback: string
    is_default: boolean
    require_authentication: boolean
    deleted_at: Date | null
  }
}

type StoreResolutionRow = {
  store_id: string
  store_tenant_id: string
  store_organization_id: string
  store_code: string
  store_name: string
  store_slug: string
  store_status: string
  store_default_locale: string
  store_supported_locales: unknown
  store_default_currency_code: string
  store_settings: unknown
  channel_binding_id: string | null
  channel_sales_channel_id: string | null
  channel_price_kind_id: string | null
  channel_assortment_scope: unknown
  channel_price_sort_fallback: string | null
  channel_require_authentication?: boolean | null
  binding_id?: string | null
  binding_path_prefix?: string | null
  binding_is_primary?: boolean | null
}

const STORE_COLUMNS = [
  's.id as store_id',
  's.tenant_id as store_tenant_id',
  's.organization_id as store_organization_id',
  's.code as store_code',
  's.name as store_name',
  's.slug as store_slug',
  's.status as store_status',
  's.default_locale as store_default_locale',
  's.supported_locales as store_supported_locales',
  's.default_currency_code as store_default_currency_code',
  's.settings as store_settings',
  'c.id as channel_binding_id',
  'c.sales_channel_id as channel_sales_channel_id',
  'c.price_kind_id as channel_price_kind_id',
  'c.assortment_scope as channel_assortment_scope',
  'c.price_sort_fallback as channel_price_sort_fallback',
  'c.require_authentication as channel_require_authentication',
] as const

const FORCE_HOST_HEADER = 'x-force-host'
const FORCE_HOST_SECRET_HEADER = 'x-force-host-secret'
const SLUG_MAX_LENGTH = 120

const logger = createLogger('ecommerce').child({ component: 'store-context' })

type NotFoundReason =
  | 'host_missing'
  | 'domain_routing_unavailable'
  | 'domain_mapping_not_active'
  | 'domain_binding_not_found'
  | 'store_draft_hidden'
  | 'slug_invalid'
  | 'slug_not_found'
  | 'slug_ambiguous'

const WARN_NOT_FOUND_REASONS: ReadonlySet<NotFoundReason> = new Set([
  'domain_routing_unavailable',
  'domain_binding_not_found',
  'slug_ambiguous',
])

function storeNotFound(reason: NotFoundReason, details: Record<string, unknown>): StorefrontResolutionError {
  const meta = { reason, ...details }
  if (WARN_NOT_FOUND_REASONS.has(reason)) {
    logger.warn('Storefront store not resolved', meta)
  } else {
    logger.debug('Storefront store not resolved', meta)
  }
  return new StorefrontResolutionError(404, 'store_not_found')
}

function tryResolve<T>(container: StoreContextContainer, name: string): T | null {
  try {
    const resolved = container.resolve(name) as T | null | undefined
    return resolved ?? null
  } catch {
    return null
  }
}

function resolveEntityManager(container: StoreContextContainer): EntityManager {
  const em = tryResolve<EntityManager>(container, 'em')
  if (!em) throw new Error('[internal] ecommerce store resolution requires the DI entity manager')
  return em
}

export function isDevStoreSlugEnabled(): boolean {
  return parseBooleanWithDefault(process.env[DEV_STORE_SLUG_ENV], false)
}

export function normalizeRequestHost(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const first = raw.split(',')[0]?.trim().toLowerCase() ?? ''
  if (!first.length) return null
  const withoutPort = first.startsWith('[')
    ? first.replace(/^(\[[^\]]*\])(?::\d+)?$/, '$1')
    : first.replace(/:\d+$/, '')
  const withoutTrailingDot = withoutPort.replace(/\.+$/, '')
  return withoutTrailingDot.length ? withoutTrailingDot : null
}

export function normalizeRequestPathname(pathname: string | null | undefined): string {
  if (typeof pathname !== 'string' || !pathname.length) return '/'
  const lowered = pathname.toLowerCase()
  const withLeadingSlash = lowered.startsWith('/') ? lowered : `/${lowered}`
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '')
  return withoutTrailingSlash.length ? withoutTrailingSlash : '/'
}

export function pathPrefixMatches(pathPrefix: string | null, pathname: string): boolean {
  if (!pathPrefix) return true
  const normalizedPrefix = normalizeRequestPathname(pathPrefix)
  if (normalizedPrefix === '/') return true
  return pathname === normalizedPrefix || pathname.startsWith(`${normalizedPrefix}/`)
}

export function selectLongestPrefixMatch<T extends { binding: { pathPrefix: string | null } | null }>(
  candidates: T[],
  pathname: string,
): T | null {
  let best: T | null = null
  let bestLength = -1
  for (const candidate of candidates) {
    const pathPrefix = candidate.binding?.pathPrefix ?? null
    if (!pathPrefixMatches(pathPrefix, pathname)) continue
    const length = pathPrefix ? normalizeRequestPathname(pathPrefix).length : 0
    if (length > bestLength) {
      best = candidate
      bestLength = length
    }
  }
  return best
}

function readForcedHost(request: Request): string | null {
  if (process.env.NODE_ENV !== 'test') return null
  const expected = process.env.FORCE_HOST_SECRET
  if (!expected) return null
  if (!secretEqual(request.headers.get(FORCE_HOST_SECRET_HEADER), expected)) return null
  const forced = request.headers.get(FORCE_HOST_HEADER)
  return forced && forced.length > 0 ? forced : null
}

function readLocaleCandidates(request: Request, url: URL): StoreLocaleCandidates {
  return {
    queryLocale: url.searchParams.get('locale'),
    headerLocale: request.headers.get('x-locale'),
    acceptLanguage: request.headers.get('accept-language'),
  }
}

function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSettings(raw: unknown, storeId: string): EcommerceStoreSettings {
  const parsed = ecommerceStoreSettingsSchema.safeParse(parseJsonColumn(raw) ?? {})
  if (parsed.success) return parsed.data
  logger.warn('Store settings failed validation; serving defaults', { storeId })
  return ecommerceStoreSettingsSchema.parse({})
}

function parseSupportedLocales(raw: unknown, defaultLocale: string): string[] {
  const value = parseJsonColumn(raw)
  const locales = Array.isArray(value)
    ? value.filter((locale): locale is string => typeof locale === 'string' && locale.length > 0)
    : []
  return locales.includes(defaultLocale) ? locales : [defaultLocale, ...locales]
}

function parseStatus(raw: string): EcommerceStoreStatus {
  const parsed = ecommerceStoreStatusSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'draft'
}

function parsePriceSortFallback(raw: string | null): EcommercePriceSortFallback {
  const parsed = ecommercePriceSortFallbackSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'approximate'
}

function parseAssortmentScope(raw: unknown): AssortmentScope | null {
  const value = parseJsonColumn(raw)
  return isRecord(value) ? (value as AssortmentScope) : null
}

function toCandidate(row: StoreResolutionRow): StoreCandidate {
  const store: CandidateStore = {
    id: row.store_id,
    tenantId: row.store_tenant_id,
    organizationId: row.store_organization_id,
    code: row.store_code,
    name: row.store_name,
    slug: row.store_slug,
    status: parseStatus(row.store_status),
    defaultLocale: row.store_default_locale,
    supportedLocales: parseSupportedLocales(row.store_supported_locales, row.store_default_locale),
    defaultCurrencyCode: row.store_default_currency_code,
    settings: parseSettings(row.store_settings, row.store_id),
  }
  const channel: ResolvedStoreChannel | null =
    row.channel_binding_id && row.channel_sales_channel_id
      ? {
          channelBindingId: row.channel_binding_id,
          salesChannelId: row.channel_sales_channel_id,
          priceKindId: row.channel_price_kind_id ?? null,
          priceSortFallback: parsePriceSortFallback(row.channel_price_sort_fallback),
          assortmentScope: parseAssortmentScope(row.channel_assortment_scope),
          requireAuthentication: row.channel_require_authentication === true,
        }
      : null
  const binding: CandidateBinding | null = row.binding_id
    ? { id: row.binding_id, pathPrefix: row.binding_path_prefix ?? null, isPrimary: row.binding_is_primary === true }
    : null
  return { store, channel, binding }
}

async function queryDomainCandidates(
  em: EntityManager,
  mapping: DomainMappingResolution,
): Promise<StoreResolutionRow[]> {
  const db = em.getKysely<StoreResolutionDatabase>()
  return db
    .selectFrom('ecommerce_store_domain_bindings as b')
    .innerJoin('ecommerce_stores as s', (join) =>
      join
        .onRef('s.id', '=', 'b.store_id')
        .onRef('s.tenant_id', '=', 'b.tenant_id')
        .onRef('s.organization_id', '=', 'b.organization_id')
        .on('s.deleted_at', 'is', null),
    )
    .leftJoin('ecommerce_store_channel_bindings as c', (join) =>
      join
        .onRef('c.store_id', '=', 's.id')
        .onRef('c.tenant_id', '=', 's.tenant_id')
        .onRef('c.organization_id', '=', 's.organization_id')
        .on('c.is_default', '=', true)
        .on('c.deleted_at', 'is', null),
    )
    .select([
      ...STORE_COLUMNS,
      'b.id as binding_id',
      'b.path_prefix as binding_path_prefix',
      'b.is_primary as binding_is_primary',
    ])
    .where('b.domain_mapping_id', '=', mapping.domainMappingId)
    .where('b.tenant_id', '=', mapping.tenantId)
    .where('b.organization_id', '=', mapping.organizationId)
    .where('b.deleted_at', 'is', null)
    .execute()
}

async function querySlugCandidates(
  em: EntityManager,
  slug: string,
  tenantId: string | null,
): Promise<StoreResolutionRow[]> {
  const db = em.getKysely<StoreResolutionDatabase>()
  let query = db
    .selectFrom('ecommerce_stores as s')
    .leftJoin('ecommerce_store_channel_bindings as c', (join) =>
      join
        .onRef('c.store_id', '=', 's.id')
        .onRef('c.tenant_id', '=', 's.tenant_id')
        .onRef('c.organization_id', '=', 's.organization_id')
        .on('c.is_default', '=', true)
        .on('c.deleted_at', 'is', null),
    )
    .select([...STORE_COLUMNS])
    .where('s.slug', '=', slug)
    .where('s.deleted_at', 'is', null)
  if (tenantId) query = query.where('s.tenant_id', '=', tenantId)
  return query.limit(2).execute()
}

async function loadDomainCandidates(
  container: StoreContextContainer,
  mapping: DomainMappingResolution,
): Promise<StoreCandidate[]> {
  const cache = ecommerceResolutionCache(container)
  const key = ['domain-mapping', mapping.domainMappingId]
  const cached = await cache.get<CachedStoreCandidates>(key)
  if (cached && Array.isArray(cached.candidates)) return cached.candidates
  const rows = await queryDomainCandidates(resolveEntityManager(container), mapping)
  const candidates = rows.map(toCandidate)
  const tags = [
    ecommerceDomainMappingTag(mapping.domainMappingId),
    ecommerceDomainTag(mapping.hostname),
    ...candidates.map((candidate) => ecommerceStoreTag(candidate.store.id)),
  ]
  await cache.set<CachedStoreCandidates>(
    key,
    { candidates },
    { ttlMs: STORE_RESOLUTION_TTL_MS, tags: Array.from(new Set(tags)) },
  )
  return candidates
}

async function loadSlugCandidates(
  container: StoreContextContainer,
  slug: string,
  tenantId: string | null,
): Promise<StoreCandidate[]> {
  const cache = ecommerceResolutionCache(container)
  const key = ['slug', tenantId ?? '*', slug]
  const cached = await cache.get<CachedStoreCandidates>(key)
  if (cached && Array.isArray(cached.candidates)) return cached.candidates
  const rows = await querySlugCandidates(resolveEntityManager(container), slug, tenantId)
  const candidates = rows.map(toCandidate)
  if (candidates.length > 0) {
    await cache.set<CachedStoreCandidates>(
      key,
      { candidates },
      {
        ttlMs: STORE_RESOLUTION_TTL_MS,
        tags: candidates.map((candidate) => ecommerceStoreTag(candidate.store.id)),
      },
    )
  }
  return candidates
}

async function reportMisconfiguredStore(container: StoreContextContainer, store: CandidateStore): Promise<void> {
  const cache = ecommerceResolutionCache(container)
  const key = ['misconfigured', 'channel-binding-missing', store.id]
  const alreadyReported = await cache.get<{ reportedAt: string }>(key)
  if (alreadyReported) return
  await cache.set(key, { reportedAt: new Date().toISOString() }, { ttlMs: STORE_MISCONFIGURED_THROTTLE_MS })
  logger.warn('Store has no default channel binding; answering 503', {
    storeId: store.id,
    tenantId: store.tenantId,
    organizationId: store.organizationId,
  })
  try {
    await emitEcommerceEvent(
      'ecommerce.store.misconfigured',
      {
        id: store.id,
        storeId: store.id,
        tenantId: store.tenantId,
        organizationId: store.organizationId,
        reason: 'channel_binding_missing',
      },
      { persistent: true, tenantId: store.tenantId, organizationId: store.organizationId },
    )
  } catch (error) {
    logger.warn('Failed to emit store misconfiguration event', { storeId: store.id, err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'ecommerce',
      code: 'ecommerce.store_misconfigured_emit_failed',
      attributes: { storeId: store.id },
    })
  }
}

async function finalizeCandidate(
  container: StoreContextContainer,
  candidate: StoreCandidate,
  source: ResolvedStore['source'],
  domain: ResolvedStoreDomain | null,
  localeCandidates: StoreLocaleCandidates,
): Promise<ResolvedStore> {
  const { store } = candidate
  if (store.status === 'draft') {
    if (isDevStoreSlugEnabled()) throw new StorefrontResolutionError(403, 'store_draft')
    throw storeNotFound('store_draft_hidden', { source, storeId: store.id })
  }
  if (store.status === 'archived') throw new StorefrontResolutionError(410, 'store_archived')
  if (!candidate.channel) {
    await reportMisconfiguredStore(container, store)
    throw new StorefrontResolutionError(503, 'store_misconfigured')
  }
  const locale = resolveStoreLocale(store, localeCandidates)
  return {
    source,
    store: {
      id: store.id,
      code: store.code,
      name: store.name,
      slug: store.slug,
      status: 'active',
      defaultLocale: store.defaultLocale,
      supportedLocales: store.supportedLocales,
      defaultCurrencyCode: store.defaultCurrencyCode,
      settings: store.settings,
    },
    tenantId: store.tenantId,
    organizationId: store.organizationId,
    channel: candidate.channel,
    domain,
    effectiveLocale: locale.effectiveLocale,
    requestedLocale: locale.requestedLocale,
    currencyCode: store.defaultCurrencyCode,
  }
}

async function resolveSlugWithCandidates(
  container: StoreContextContainer,
  rawSlug: string,
  tenantId: string | null,
  localeCandidates: StoreLocaleCandidates,
): Promise<ResolvedStore> {
  if (!isDevStoreSlugEnabled()) throw new StorefrontResolutionError(400, 'store_slug_not_allowed')
  const slug = rawSlug.trim().toLowerCase()
  if (!slug.length || slug.length > SLUG_MAX_LENGTH || !ECOMMERCE_STORE_SLUG_PATTERN.test(slug)) {
    throw storeNotFound('slug_invalid', {})
  }
  const candidates = await loadSlugCandidates(container, slug, tenantId)
  if (candidates.length === 0) throw storeNotFound('slug_not_found', { slug })
  if (candidates.length > 1) throw storeNotFound('slug_ambiguous', { slug })
  return finalizeCandidate(container, candidates[0], 'slug', null, localeCandidates)
}

export async function resolveStoreBySlug(
  container: StoreContextContainer,
  slug: string,
  options: ResolveStoreBySlugOptions = {},
): Promise<ResolvedStore> {
  return resolveSlugWithCandidates(container, slug, options.tenantId ?? null, {
    queryLocale: options.locale ?? null,
    headerLocale: options.headerLocale ?? null,
    acceptLanguage: options.acceptLanguage ?? null,
  })
}

export async function resolveStoreFromRequest(
  container: StoreContextContainer,
  request: Request,
  options: ResolveStoreFromRequestOptions = {},
): Promise<ResolvedStore> {
  const url = new URL(request.url)
  const localeCandidates = readLocaleCandidates(request, url)
  const storeSlug = url.searchParams.get('storeSlug')
  if (storeSlug !== null) return resolveSlugWithCandidates(container, storeSlug, null, localeCandidates)

  const host = normalizeRequestHost(readForcedHost(request) ?? request.headers.get('host'))
  if (!host) throw storeNotFound('host_missing', {})
  const domainMappingService = tryResolve<DomainMappingResolver>(container, 'domainMappingService')
  if (!domainMappingService) throw storeNotFound('domain_routing_unavailable', { host })
  const mapping = await domainMappingService.resolveByHostname(host)
  if (!mapping || mapping.status !== 'active') throw storeNotFound('domain_mapping_not_active', { host })

  const candidates = await loadDomainCandidates(container, mapping)
  const pathname = normalizeRequestPathname(options.pathname ?? url.pathname)
  const candidate = selectLongestPrefixMatch(candidates, pathname)
  if (!candidate?.binding) {
    throw storeNotFound('domain_binding_not_found', {
      host,
      domainMappingId: mapping.domainMappingId,
      bindingCount: candidates.length,
    })
  }
  return finalizeCandidate(
    container,
    candidate,
    'host',
    {
      domainMappingId: mapping.domainMappingId,
      hostname: mapping.hostname,
      bindingId: candidate.binding.id,
      pathPrefix: candidate.binding.pathPrefix,
      isPrimary: candidate.binding.isPrimary,
    },
    localeCandidates,
  )
}
