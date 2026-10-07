import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defaultLocale } from '@open-mercato/shared/lib/i18n/config'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { slugify } from '@open-mercato/shared/lib/slugify'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { EcommerceStore } from '../data/entities'
import { ecommerceStoreCreateSchema } from '../data/validators'
import { buildStoreEventPayload } from './crudEvents'
import { emitEcommerceEvent } from '../events'

const logger = createLogger('ecommerce').child({ component: 'seed-draft-store' })

export const DEFAULT_DRAFT_STORE_NAME = 'Default store'
export const DEFAULT_DRAFT_STORE_CODE = 'default'
export const DEFAULT_DRAFT_STORE_CURRENCY = 'USD'

const CODE_MAX_LENGTH = 80

export type SeedDraftStoreScope = {
  tenantId: string
  organizationId: string
}

export type SeedDraftStoreOptions = {
  resolveCurrencyCode?: () => Promise<string | null>
}

export type SeedDraftStoreResult =
  | { status: 'created'; storeId: string }
  | { status: 'exists' }

export type DraftStoreIdentity = {
  name: string
  code: string
  slug: string
}

export function deriveDraftStoreIdentity(organizationName: string | null | undefined): DraftStoreIdentity {
  const name = (organizationName ?? '').trim().slice(0, 200) || DEFAULT_DRAFT_STORE_NAME
  const slug = slugify(name).replace(/-{2,}/g, '-').slice(0, CODE_MAX_LENGTH).replace(/-+$/, '') || DEFAULT_DRAFT_STORE_CODE
  return { name, code: slug, slug }
}

async function tenantHasStore(em: EntityManager, tenantId: string): Promise<boolean> {
  return (await em.count(EcommerceStore, { tenantId })) > 0
}

async function loadOrganizationName(em: EntityManager, scope: SeedDraftStoreScope): Promise<string | null> {
  const organization = await findOneWithDecryption(
    em,
    Organization,
    { id: scope.organizationId, tenant: scope.tenantId },
    undefined,
    scope,
  )
  return organization?.name ?? null
}

async function announceCreated(store: EcommerceStore): Promise<void> {
  try {
    await emitEcommerceEvent('ecommerce.store.created', buildStoreEventPayload(store), {
      persistent: true,
      tenantId: store.tenantId,
      organizationId: store.organizationId,
    })
  } catch (err) {
    logger.warn('draft store created but the created event could not be emitted', { storeId: store.id, err })
    getTelemetryRuntime()?.reportError(err, { module: 'ecommerce', code: 'ecommerce.seed_draft_store_event_failed' })
  }
}

export async function seedDraftStore(
  em: EntityManager,
  scope: SeedDraftStoreScope,
  options: SeedDraftStoreOptions = {},
): Promise<SeedDraftStoreResult> {
  if (await tenantHasStore(em, scope.tenantId)) return { status: 'exists' }

  const identity = deriveDraftStoreIdentity(await loadOrganizationName(em, scope))
  const resolvedCurrency = options.resolveCurrencyCode ? await options.resolveCurrencyCode() : null
  const input = ecommerceStoreCreateSchema.parse({
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    code: identity.code,
    name: identity.name,
    slug: identity.slug,
    status: 'draft',
    defaultLocale,
    supportedLocales: [defaultLocale],
    defaultCurrencyCode: resolvedCurrency ?? DEFAULT_DRAFT_STORE_CURRENCY,
    isPrimary: false,
  })

  const store = em.create(EcommerceStore, {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    code: input.code,
    name: input.name,
    slug: input.slug,
    status: input.status,
    defaultLocale: input.defaultLocale,
    supportedLocales: input.supportedLocales,
    defaultCurrencyCode: input.defaultCurrencyCode,
    isPrimary: false,
    settings: input.settings,
  })
  em.persist(store)
  await em.flush()
  await announceCreated(store)
  logger.info('draft store seeded', { tenantId: scope.tenantId, organizationId: scope.organizationId, storeId: store.id })
  return { status: 'created', storeId: store.id }
}
