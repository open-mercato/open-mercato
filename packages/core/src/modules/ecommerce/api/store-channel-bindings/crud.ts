import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/ecommerce_store_channel_binding'
import { EcommerceStoreChannelBinding } from '../../data/entities'
import {
  ecommerceStoreChannelBindingCreateSchema,
  ecommerceStoreChannelBindingUpdateSchema,
  type EcommerceStoreChannelBindingCreateInput,
  type EcommerceStoreChannelBindingUpdateInput,
} from '../../data/validators'
import { fieldError, hasOwn, resolveWriteScope, type EcommerceWriteScope, type Translate } from '../../lib/crudSupport'
import { assignExclusiveFlag, promoteExclusiveFlag, type ExclusiveFlagConfig } from '../../lib/exclusiveFlag'
import { assertPriceKindInScope, assertSalesChannelInScope, assertStoreInScope } from '../../lib/references'
import {
  announceStoreChannelBindingsUpdated,
  buildStoreChannelBindingEventPayload,
  ECOMMERCE_EVENTS_MODULE,
  STORE_CHANNEL_BINDING_EVENT_ENTITY,
} from '../../lib/crudEvents'

const rawBodySchema = z.object({}).passthrough()
type RawChannelBindingInput = z.infer<typeof rawBodySchema>

export const channelBindingListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    storeId: z.string().uuid().optional(),
    salesChannelId: z.string().uuid().optional(),
    isDefault: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export type ChannelBindingListQuery = z.infer<typeof channelBindingListQuerySchema>

export const channelBindingRouteMetadata = {
  GET: { requireAuth: true, requireFeatures: ['ecommerce.stores.view'] },
  POST: { requireAuth: true, requireFeatures: ['ecommerce.channels.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['ecommerce.channels.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['ecommerce.channels.manage'] },
}

export const CHANNEL_BINDING_DEFAULT_UNIQUE_CONSTRAINT = 'ecommerce_store_channel_bindings_store_default_unique'

const channelBindingDefaultFlag: ExclusiveFlagConfig<EcommerceStoreChannelBinding> = {
  entity: EcommerceStoreChannelBinding,
  flag: 'isDefault',
  constraint: CHANNEL_BINDING_DEFAULT_UNIQUE_CONSTRAINT,
}

function defaultBindingConflict(translate: Translate) {
  return fieldError(409, {
    isDefault: translate(
      'ecommerce.errors.defaultChannelConflict',
      'Another channel binding of this store was made the default at the same time. Reload and try again.',
    ),
  })
}

export function toChannelBindingUniqueConflict(err: unknown, translate: Translate): unknown {
  if (isUniqueViolation(err, CHANNEL_BINDING_DEFAULT_UNIQUE_CONSTRAINT)) return defaultBindingConflict(translate)
  return err
}

function parseCreateInput(input: RawChannelBindingInput, ctx: CrudCtx): EcommerceStoreChannelBindingCreateInput {
  return ecommerceStoreChannelBindingCreateSchema.parse({ ...input, ...resolveWriteScope(ctx) })
}

function parseUpdateInput(input: RawChannelBindingInput, ctx: CrudCtx): EcommerceStoreChannelBindingUpdateInput {
  return ecommerceStoreChannelBindingUpdateSchema.parse({ ...input, ...resolveWriteScope(ctx) })
}

function bindingScope(binding: Pick<EcommerceStoreChannelBinding, 'tenantId' | 'organizationId'>): EcommerceWriteScope {
  return { tenantId: binding.tenantId, organizationId: binding.organizationId }
}

const clearedDefaultByUpdate = new WeakMap<EcommerceStoreChannelBinding, EcommerceStoreChannelBinding[]>()

type ChannelBindingListRow = Record<string, unknown>

export function toChannelBindingListItem(row: ChannelBindingListRow): Record<string, unknown> {
  return {
    id: row[F.id],
    organizationId: row[F.organization_id] ?? null,
    tenantId: row[F.tenant_id] ?? null,
    storeId: row[F.store_id],
    salesChannelId: row[F.sales_channel_id],
    priceKindId: row[F.price_kind_id] ?? null,
    assortmentScope: row[F.assortment_scope] ?? null,
    priceSortFallback: row[F.price_sort_fallback] ?? 'approximate',
    isDefault: row[F.is_default] === true,
    requireAuthentication: row[F.require_authentication] === true,
    createdAt: row[F.created_at] ?? null,
    updatedAt: row[F.updated_at] ?? null,
  }
}

export const channelBindingCrud = makeCrudRoute<RawChannelBindingInput, RawChannelBindingInput, ChannelBindingListQuery>({
  metadata: channelBindingRouteMetadata,
  orm: {
    entity: EcommerceStoreChannelBinding,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.ecommerce.ecommerce_store_channel_binding },
  list: {
    schema: channelBindingListQuerySchema,
    entityId: E.ecommerce.ecommerce_store_channel_binding,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.store_id,
      F.sales_channel_id,
      F.price_kind_id,
      F.assortment_scope,
      F.price_sort_fallback,
      F.is_default,
      F.require_authentication,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      isDefault: F.is_default,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    defaultSort: { field: 'createdAt', dir: 'asc' },
    tiebreakSortField: F.id,
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters[F.id] = { $eq: query.id }
      if (query.storeId) filters[F.store_id] = { $eq: query.storeId }
      if (query.salesChannelId) filters[F.sales_channel_id] = { $eq: query.salesChannelId }
      const isDefault = parseBooleanToken(query.isDefault)
      if (isDefault !== null) filters[F.is_default] = { $eq: isDefault }
      return filters
    },
    transformItem: (item: ChannelBindingListRow) => toChannelBindingListItem(item),
  },
  events: {
    module: ECOMMERCE_EVENTS_MODULE,
    entity: STORE_CHANNEL_BINDING_EVENT_ENTITY,
    persistent: true,
    buildPayload: (emitCtx) => buildStoreChannelBindingEventPayload(emitCtx.entity as EcommerceStoreChannelBinding),
  },
  create: {
    schema: rawBodySchema,
    mapToEntity: (input, ctx) => {
      const parsed = parseCreateInput(input, ctx)
      return {
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        storeId: parsed.storeId,
        salesChannelId: parsed.salesChannelId,
        priceKindId: parsed.priceKindId ?? null,
        assortmentScope: parsed.assortmentScope ?? null,
        priceSortFallback: parsed.priceSortFallback,
        isDefault: false,
        requireAuthentication: parsed.requireAuthentication,
      }
    },
    response: (entity) => {
      const binding = entity as EcommerceStoreChannelBinding
      return { id: binding.id, isDefault: binding.isDefault }
    },
  },
  update: {
    schema: rawBodySchema,
    getId: (input) => (typeof input.id === 'string' ? input.id : ''),
    applyToEntity: async (entity, input, ctx) => {
      const binding = entity as EcommerceStoreChannelBinding
      const parsed = parseUpdateInput(input, ctx)
      const em = ctx.container.resolve('em') as EntityManager
      const { translate } = await resolveTranslations()
      const scope = bindingScope(binding)
      const nextStoreId = parsed.storeId ?? binding.storeId
      const storeChanged = nextStoreId !== binding.storeId
      if (storeChanged) await assertStoreInScope(em, nextStoreId, scope, translate)
      if (parsed.salesChannelId !== undefined && parsed.salesChannelId !== binding.salesChannelId) {
        await assertSalesChannelInScope(em, parsed.salesChannelId, scope, translate)
      }
      const nextPriceKindId = hasOwn(parsed, 'priceKindId') ? parsed.priceKindId ?? null : binding.priceKindId ?? null
      if (nextPriceKindId && nextPriceKindId !== (binding.priceKindId ?? null)) {
        await assertPriceKindInScope(em, nextPriceKindId, scope, translate)
      }
      const nextDefault = parsed.isDefault ?? binding.isDefault
      if (nextDefault && (!binding.isDefault || storeChanged)) {
        clearedDefaultByUpdate.set(
          binding,
          await assignExclusiveFlag(
            em,
            channelBindingDefaultFlag,
            { ...scope, storeId: nextStoreId },
            binding.id,
            () => defaultBindingConflict(translate),
          ),
        )
      }
      binding.storeId = nextStoreId
      if (parsed.salesChannelId !== undefined) binding.salesChannelId = parsed.salesChannelId
      binding.priceKindId = nextPriceKindId
      if (hasOwn(parsed, 'assortmentScope')) binding.assortmentScope = parsed.assortmentScope ?? null
      if (parsed.priceSortFallback !== undefined) binding.priceSortFallback = parsed.priceSortFallback
      if (parsed.requireAuthentication !== undefined) binding.requireAuthentication = parsed.requireAuthentication
      binding.isDefault = nextDefault
      try {
        await em.flush()
      } catch (err) {
        throw toChannelBindingUniqueConflict(err, translate)
      }
    },
    response: () => ({ ok: true }),
  },
  del: { idFrom: 'query', softDelete: true, response: () => ({ ok: true }) },
  hooks: {
    beforeCreate: async (input, ctx) => {
      const result = ecommerceStoreChannelBindingCreateSchema.safeParse({ ...input, ...resolveWriteScope(ctx) })
      if (!result.success) return
      const { translate } = await resolveTranslations()
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const scope: EcommerceWriteScope = { tenantId: result.data.tenantId, organizationId: result.data.organizationId }
      await assertStoreInScope(em, result.data.storeId, scope, translate)
      await assertSalesChannelInScope(em, result.data.salesChannelId, scope, translate)
      if (result.data.priceKindId) await assertPriceKindInScope(em, result.data.priceKindId, scope, translate)
    },
    afterCreate: async (entity, ctx) => {
      const binding = entity as EcommerceStoreChannelBinding
      if (parseCreateInput(ctx.input, ctx).isDefault !== true) return
      const now = new Date()
      const em = ctx.container.resolve('em') as EntityManager
      const { promoted, cleared } = await promoteExclusiveFlag(
        em,
        channelBindingDefaultFlag,
        { ...bindingScope(binding), storeId: binding.storeId },
        binding.id,
        now,
      )
      if (!promoted) return
      binding.isDefault = true
      binding.updatedAt = now
      await announceStoreChannelBindingsUpdated(ctx.container, cleared)
    },
    afterUpdate: async (entity, ctx) => {
      const binding = entity as EcommerceStoreChannelBinding
      const cleared = clearedDefaultByUpdate.get(binding)
      if (!cleared) return
      clearedDefaultByUpdate.delete(binding)
      await announceStoreChannelBindingsUpdated(ctx.container, cleared)
    },
  },
})
