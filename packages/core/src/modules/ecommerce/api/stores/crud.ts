import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/ecommerce_store'
import { EcommerceStore } from '../../data/entities'
import {
  ecommerceStoreCreateSchema,
  ecommerceStoreStatusSchema,
  ecommerceStoreUpdateSchema,
  type EcommerceStoreCreateInput,
  type EcommerceStoreSettings,
  type EcommerceStoreSettingsPatch,
  type EcommerceStoreUpdateInput,
} from '../../data/validators'
import { fieldError, hasOwn, resolveWriteScope, type Translate } from '../../lib/crudSupport'
import { clearCreateConflictRecheck, registerCreateConflictRecheck } from '../../lib/createConflictRecheck'
import {
  assignExclusiveFlag,
  promoteExclusiveFlag,
  type ExclusiveFlagConfig,
} from '../../lib/exclusiveFlag'
import {
  announceStoresUpdated,
  buildStoreEventPayload,
  ECOMMERCE_EVENTS_MODULE,
  STORE_EVENT_ENTITY,
} from '../../lib/crudEvents'

const rawBodySchema = z.object({}).passthrough()
type RawStoreInput = z.infer<typeof rawBodySchema>

export const storeListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    search: z.string().optional(),
    status: ecommerceStoreStatusSchema.optional(),
    isPrimary: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export type StoreListQuery = z.infer<typeof storeListQuerySchema>

export const storeRouteMetadata = {
  GET: { requireAuth: true, requireFeatures: ['ecommerce.stores.view'] },
  POST: { requireAuth: true, requireFeatures: ['ecommerce.stores.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['ecommerce.stores.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['ecommerce.stores.manage'] },
}

export const STORE_CODE_UNIQUE_CONSTRAINT = 'ecommerce_stores_tenant_code_unique'
export const STORE_SLUG_UNIQUE_CONSTRAINT = 'ecommerce_stores_tenant_slug_unique'
export const STORE_PRIMARY_UNIQUE_CONSTRAINT = 'ecommerce_stores_org_primary_unique'

const storePrimaryFlag: ExclusiveFlagConfig<EcommerceStore> = {
  entity: EcommerceStore,
  flag: 'isPrimary',
  constraint: STORE_PRIMARY_UNIQUE_CONSTRAINT,
}

function codeDuplicateMessage(translate: Translate): string {
  return translate('ecommerce.errors.codeDuplicate', 'A store with this code already exists.')
}

function slugDuplicateMessage(translate: Translate): string {
  return translate('ecommerce.errors.slugDuplicate', 'A store with this slug already exists.')
}

function primaryConflict(translate: Translate) {
  return fieldError(409, {
    isPrimary: translate(
      'ecommerce.errors.primaryConflict',
      'Another store was made primary at the same time. Reload and try again.',
    ),
  })
}

export function toStoreUniqueConflict(err: unknown, translate: Translate): unknown {
  if (isUniqueViolation(err, STORE_CODE_UNIQUE_CONSTRAINT)) return fieldError(409, { code: codeDuplicateMessage(translate) })
  if (isUniqueViolation(err, STORE_SLUG_UNIQUE_CONSTRAINT)) return fieldError(409, { slug: slugDuplicateMessage(translate) })
  if (isUniqueViolation(err, STORE_PRIMARY_UNIQUE_CONSTRAINT)) return primaryConflict(translate)
  return err
}

export type StoreIdentifierCheck = {
  tenantId: string
  storeId: string | null
  code?: string
  slug?: string
}

export async function assertStoreIdentifiersAvailable(
  em: EntityManager,
  check: StoreIdentifierCheck,
  translate: Translate,
): Promise<void> {
  const fieldErrors: Record<string, string> = {}
  const taken = async (field: 'code' | 'slug', value: string): Promise<boolean> => {
    const where: Record<string, unknown> = { tenantId: check.tenantId, [field]: value, deletedAt: null }
    if (check.storeId) where.id = { $ne: check.storeId }
    return (await em.count(EcommerceStore, where as FilterQuery<EcommerceStore>)) > 0
  }
  if (check.code !== undefined && (await taken('code', check.code))) fieldErrors.code = codeDuplicateMessage(translate)
  if (check.slug !== undefined && (await taken('slug', check.slug))) fieldErrors.slug = slugDuplicateMessage(translate)
  if (Object.keys(fieldErrors).length) throw fieldError(409, fieldErrors)
}

function canonicalBranding(value: unknown): string {
  if (!value || typeof value !== 'object') return '[]'
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')
    .sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify(entries)
}

export function assertBrandingUnchanged(
  current: Partial<EcommerceStoreSettings> | null | undefined,
  patch: EcommerceStoreSettingsPatch | undefined,
  translate: Translate,
): void {
  if (!patch?.branding) return
  if (canonicalBranding(patch.branding) === canonicalBranding(current?.branding)) return
  throw fieldError(400, {
    'settings.branding': translate(
      'ecommerce.errors.brandingRouteRequired',
      'Branding cannot be changed here. Save it through the branding endpoint (PUT /api/ecommerce/stores/{id}/branding).',
    ),
  })
}

export function mergeStoreSettings(
  current: Partial<EcommerceStoreSettings> | null | undefined,
  patch: EcommerceStoreSettingsPatch,
): EcommerceStoreSettings {
  return {
    branding: current?.branding ?? {},
    contact: patch.contact ?? current?.contact ?? {},
    display: {
      priceDisplayModeDefault: 'gross',
      enableSearch: true,
      ...current?.display,
      ...patch.display,
    },
    seo: patch.seo ?? current?.seo ?? {},
  }
}

export function assertLocalesConsistent(store: EcommerceStore, input: EcommerceStoreUpdateInput, translate: Translate): void {
  const defaultLocale = input.defaultLocale ?? store.defaultLocale
  const supportedLocales = input.supportedLocales ?? store.supportedLocales
  if (supportedLocales.includes(defaultLocale)) return
  const field = input.supportedLocales !== undefined && input.defaultLocale === undefined ? 'supportedLocales' : 'defaultLocale'
  throw fieldError(400, {
    [field]: translate('ecommerce.validation.defaultLocaleNotSupported', 'The default locale must be one of the supported locales.'),
  })
}

function parseCreateInput(input: RawStoreInput, ctx: CrudCtx): EcommerceStoreCreateInput {
  return ecommerceStoreCreateSchema.parse({ ...input, ...resolveWriteScope(ctx) })
}

function parseUpdateInput(input: RawStoreInput, ctx: CrudCtx): EcommerceStoreUpdateInput {
  return ecommerceStoreUpdateSchema.parse({ ...input, ...resolveWriteScope(ctx) })
}

function toStoreEntityData(input: EcommerceStoreCreateInput): Record<string, unknown> {
  return {
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
  }
}

function applyStoreUpdate(store: EcommerceStore, input: EcommerceStoreUpdateInput): void {
  if (input.code !== undefined) store.code = input.code
  if (input.name !== undefined) store.name = input.name
  if (input.slug !== undefined) store.slug = input.slug
  if (input.status !== undefined) store.status = input.status
  if (input.defaultLocale !== undefined) store.defaultLocale = input.defaultLocale
  if (input.supportedLocales !== undefined) store.supportedLocales = input.supportedLocales
  if (input.defaultCurrencyCode !== undefined) store.defaultCurrencyCode = input.defaultCurrencyCode
  if (input.isPrimary !== undefined) store.isPrimary = input.isPrimary
  if (hasOwn(input, 'settings') && input.settings) store.settings = mergeStoreSettings(store.settings, input.settings)
}

function primaryScope(store: Pick<EcommerceStore, 'tenantId' | 'organizationId'>): Record<string, string> {
  return { tenantId: store.tenantId, organizationId: store.organizationId }
}

const clearedPrimaryByUpdate = new WeakMap<EcommerceStore, EcommerceStore[]>()

type StoreListRow = Record<string, unknown>

export function toStoreListItem(row: StoreListRow): Record<string, unknown> {
  return {
    id: row[F.id],
    organizationId: row[F.organization_id] ?? null,
    tenantId: row[F.tenant_id] ?? null,
    code: row[F.code],
    name: row[F.name],
    slug: row[F.slug],
    status: row[F.status],
    defaultLocale: row[F.default_locale],
    supportedLocales: row[F.supported_locales] ?? [],
    defaultCurrencyCode: row[F.default_currency_code],
    isPrimary: row[F.is_primary] === true,
    settings: row[F.settings] ?? null,
    createdAt: row[F.created_at] ?? null,
    updatedAt: row[F.updated_at] ?? null,
  }
}

export const storeCrud = makeCrudRoute<RawStoreInput, RawStoreInput, StoreListQuery>({
  metadata: storeRouteMetadata,
  orm: {
    entity: EcommerceStore,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.ecommerce.ecommerce_store },
  list: {
    schema: storeListQuerySchema,
    entityId: E.ecommerce.ecommerce_store,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.code,
      F.name,
      F.slug,
      F.status,
      F.default_locale,
      F.supported_locales,
      F.default_currency_code,
      F.is_primary,
      F.settings,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      name: F.name,
      code: F.code,
      slug: F.slug,
      status: F.status,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    defaultSort: { field: 'name', dir: 'asc' },
    tiebreakSortField: F.id,
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters[F.id] = { $eq: query.id }
      if (query.search) {
        const pattern = buildIlikeTerm(query.search)
        filters.$or = [{ [F.code]: { $ilike: pattern } }, { [F.name]: { $ilike: pattern } }, { [F.slug]: { $ilike: pattern } }]
      }
      if (query.status) filters[F.status] = { $eq: query.status }
      const isPrimary = parseBooleanToken(query.isPrimary)
      if (isPrimary !== null) filters[F.is_primary] = { $eq: isPrimary }
      return filters
    },
    transformItem: (item: StoreListRow) => toStoreListItem(item),
  },
  events: {
    module: ECOMMERCE_EVENTS_MODULE,
    entity: STORE_EVENT_ENTITY,
    persistent: true,
    buildPayload: (emitCtx) => buildStoreEventPayload(emitCtx.entity as EcommerceStore),
  },
  create: {
    schema: rawBodySchema,
    mapToEntity: (input, ctx) => toStoreEntityData(parseCreateInput(input, ctx)),
    response: (entity) => {
      const store = entity as EcommerceStore
      return { id: store.id, isPrimary: store.isPrimary }
    },
  },
  update: {
    schema: rawBodySchema,
    getId: (input) => (typeof input.id === 'string' ? input.id : ''),
    applyToEntity: async (entity, input, ctx) => {
      const store = entity as EcommerceStore
      const parsed = parseUpdateInput(input, ctx)
      const em = ctx.container.resolve('em') as EntityManager
      const { translate } = await resolveTranslations()
      assertBrandingUnchanged(store.settings, parsed.settings, translate)
      assertLocalesConsistent(store, parsed, translate)
      await assertStoreIdentifiersAvailable(
        em,
        {
          tenantId: store.tenantId,
          storeId: store.id,
          code: parsed.code !== undefined && parsed.code !== store.code ? parsed.code : undefined,
          slug: parsed.slug !== undefined && parsed.slug !== store.slug ? parsed.slug : undefined,
        },
        translate,
      )
      if (parsed.isPrimary === true && !store.isPrimary) {
        clearedPrimaryByUpdate.set(
          store,
          await assignExclusiveFlag(em, storePrimaryFlag, primaryScope(store), store.id, () => primaryConflict(translate)),
        )
      }
      applyStoreUpdate(store, parsed)
      try {
        await em.flush()
      } catch (err) {
        throw toStoreUniqueConflict(err, translate)
      }
    },
    response: () => ({ ok: true }),
  },
  del: { idFrom: 'query', softDelete: true, response: () => ({ ok: true }) },
  hooks: {
    beforeCreate: async (input, ctx) => {
      const result = ecommerceStoreCreateSchema.safeParse({ ...input, ...resolveWriteScope(ctx) })
      if (!result.success) return
      const { translate } = await resolveTranslations()
      const check: StoreIdentifierCheck = {
        tenantId: result.data.tenantId,
        storeId: null,
        code: result.data.code,
        slug: result.data.slug,
      }
      await assertStoreIdentifiersAvailable((ctx.container.resolve('em') as EntityManager).fork(), check, translate)
      registerCreateConflictRecheck(ctx.request, () =>
        assertStoreIdentifiersAvailable((ctx.container.resolve('em') as EntityManager).fork(), check, translate),
      )
    },
    afterCreate: async (entity, ctx) => {
      clearCreateConflictRecheck(ctx.request)
      const store = entity as EcommerceStore
      if (parseCreateInput(ctx.input, ctx).isPrimary !== true) return
      const now = new Date()
      const em = ctx.container.resolve('em') as EntityManager
      const { promoted, cleared } = await promoteExclusiveFlag(em, storePrimaryFlag, primaryScope(store), store.id, now)
      if (!promoted) return
      store.isPrimary = true
      store.updatedAt = now
      await announceStoresUpdated(ctx.container, cleared)
    },
    afterUpdate: async (entity, ctx) => {
      const store = entity as EcommerceStore
      const cleared = clearedPrimaryByUpdate.get(store)
      if (!cleared) return
      clearedPrimaryByUpdate.delete(store)
      await announceStoresUpdated(ctx.container, cleared)
    },
  },
})
