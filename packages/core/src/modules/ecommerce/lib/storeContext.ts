import type { EntityManager } from '@mikro-orm/postgresql'
import { EcommerceStore, EcommerceStoreDomain, EcommerceStoreChannelBinding } from '../data/entities'

export type StoreContext = {
  store: {
    id: string
    code: string
    name: string
    slug: string
    status: string
    defaultLocale: string
    supportedLocales: string[]
    defaultCurrencyCode: string
    isPrimary: boolean
    settings: Record<string, unknown> | null
  }
  tenantId: string
  organizationId: string
  channelBinding: {
    id: string
    salesChannelId: string
    priceKindId: string | null
    catalogScope: Record<string, unknown> | null
  } | null
  effectiveLocale: string
}

function resolveEffectiveLocale(
  requestedLocale: string | null,
  supportedLocales: string[],
  defaultLocale: string,
): string {
  if (!requestedLocale) return defaultLocale
  if (supportedLocales.includes(requestedLocale)) return requestedLocale
  const lang = requestedLocale.split('-')[0]
  const match = supportedLocales.find((l) => l.startsWith(lang))
  return match ?? defaultLocale
}

function buildStoreContext(
  store: EcommerceStore,
  channelBinding: EcommerceStoreChannelBinding | null,
  requestedLocale: string | null,
): StoreContext {
  return {
    store: {
      id: store.id,
      code: store.code,
      name: store.name,
      slug: store.slug,
      status: store.status,
      defaultLocale: store.defaultLocale,
      supportedLocales: store.supportedLocales,
      defaultCurrencyCode: store.defaultCurrencyCode,
      isPrimary: store.isPrimary,
      settings: store.settings ?? null,
    },
    tenantId: store.tenantId,
    organizationId: store.organizationId,
    channelBinding: channelBinding
      ? {
          id: channelBinding.id,
          salesChannelId: channelBinding.salesChannelId,
          priceKindId: channelBinding.priceKindId ?? null,
          catalogScope: channelBinding.catalogScope ?? null,
        }
      : null,
    effectiveLocale: resolveEffectiveLocale(
      requestedLocale,
      store.supportedLocales,
      store.defaultLocale,
    ),
  }
}

async function resolveChannelBinding(em: EntityManager, storeId: string): Promise<EcommerceStoreChannelBinding | null> {
  return em.findOne(EcommerceStoreChannelBinding, { storeId, isDefault: true, deletedAt: null })
}

export async function resolveStoreByHost(
  em: EntityManager,
  host: string,
  requestedLocale: string | null = null,
): Promise<StoreContext | null> {
  const normalizedHost = host.split(':')[0].toLowerCase().trim()
  if (!normalizedHost) return null

  const domain = await em.findOne(EcommerceStoreDomain, {
    host: normalizedHost,
    deletedAt: null,
  })
  if (!domain) return null

  const store = await em.findOne(EcommerceStore, {
    id: domain.storeId,
    status: 'active',
    deletedAt: null,
  })
  if (!store) return null

  const channelBinding = await resolveChannelBinding(em, store.id)
  return buildStoreContext(store, channelBinding, requestedLocale)
}

export async function resolveStoreBySlug(
  em: EntityManager,
  slug: string,
  tenantId: string | null,
  requestedLocale: string | null = null,
): Promise<StoreContext | null> {
  const filter: Record<string, unknown> = { slug, deletedAt: null }
  if (tenantId) filter.tenantId = tenantId
  const store = await em.findOne(EcommerceStore, filter as object)
  if (!store) return null

  const channelBinding = await resolveChannelBinding(em, store.id)
  return buildStoreContext(store, channelBinding, requestedLocale)
}

export async function resolveStoreFromRequest(
  request: { headers: { get: (key: string) => string | null }; url: string },
  em: EntityManager,
  tenantId: string | null,
): Promise<StoreContext | null> {
  const url = new URL(request.url)
  const requestedLocale = request.headers.get('x-locale') ?? url.searchParams.get('locale')

  const storeSlug = url.searchParams.get('storeSlug')
  if (storeSlug) {
    return resolveStoreBySlug(em, storeSlug, tenantId, requestedLocale)
  }

  const host = request.headers.get('host') ?? request.headers.get('x-forwarded-host')
  if (host) {
    return resolveStoreByHost(em, host, requestedLocale)
  }

  return null
}
