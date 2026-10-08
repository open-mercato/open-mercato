import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/ecommerce_store_domain_binding'
import { EcommerceStoreDomainBinding } from '../../data/entities'
import {
  ecommerceStoreDomainBindingCreateSchema,
  ecommerceStoreDomainBindingUpdateSchema,
  type EcommerceStoreDomainBindingCreateInput,
  type EcommerceStoreDomainBindingUpdateInput,
} from '../../data/validators'
import {
  assertRecordInWriteScope,
  fieldError,
  hasOwn,
  resolveScopeOrganizationId,
  resolveWriteScope,
  type EcommerceWriteScope,
  type Translate,
} from '../../lib/crudSupport'
import { clearCreateConflictRecheck, registerCreateConflictRecheck } from '../../lib/createConflictRecheck'
import { assignExclusiveFlag, promoteExclusiveFlag, type ExclusiveFlagConfig } from '../../lib/exclusiveFlag'
import { assertDomainMappingInScope, assertStoreInScope } from '../../lib/references'
import {
  announceStoreDomainBindingsUpdated,
  buildStoreDomainBindingEventPayload,
  ECOMMERCE_EVENTS_MODULE,
  rememberDomainBindingPlacement,
  STORE_DOMAIN_BINDING_EVENT_ENTITY,
} from '../../lib/crudEvents'

const rawBodySchema = z.object({}).passthrough()
type RawDomainBindingInput = z.infer<typeof rawBodySchema>

export const domainBindingListQuerySchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    storeId: z.string().uuid().optional(),
    domainMappingId: z.string().uuid().optional(),
    isPrimary: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

export type DomainBindingListQuery = z.infer<typeof domainBindingListQuerySchema>

export const domainBindingRouteMetadata = {
  GET: { requireAuth: true, requireFeatures: ['ecommerce.stores.view'] },
  POST: { requireAuth: true, requireFeatures: ['ecommerce.domains.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['ecommerce.domains.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['ecommerce.domains.manage'] },
}

export const DOMAIN_BINDING_PREFIX_UNIQUE_CONSTRAINT = 'ecommerce_store_domain_bindings_mapping_prefix_unique'
export const DOMAIN_BINDING_PRIMARY_UNIQUE_CONSTRAINT = 'ecommerce_store_domain_bindings_store_primary_unique'

const domainBindingPrimaryFlag: ExclusiveFlagConfig<EcommerceStoreDomainBinding> = {
  entity: EcommerceStoreDomainBinding,
  flag: 'isPrimary',
  constraint: DOMAIN_BINDING_PRIMARY_UNIQUE_CONSTRAINT,
}

function duplicateBindingConflict(translate: Translate) {
  return fieldError(409, {
    pathPrefix: translate(
      'ecommerce.errors.domainBindingDuplicate',
      'This domain and path prefix already serve a store.',
    ),
  })
}

function primaryBindingConflict(translate: Translate) {
  return fieldError(409, {
    isPrimary: translate(
      'ecommerce.errors.primaryDomainConflict',
      'Another domain binding of this store was made primary at the same time. Reload and try again.',
    ),
  })
}

export function toDomainBindingUniqueConflict(err: unknown, translate: Translate): unknown {
  if (isUniqueViolation(err, DOMAIN_BINDING_PREFIX_UNIQUE_CONSTRAINT)) return duplicateBindingConflict(translate)
  if (isUniqueViolation(err, DOMAIN_BINDING_PRIMARY_UNIQUE_CONSTRAINT)) return primaryBindingConflict(translate)
  return err
}

export type DomainBindingPlacement = {
  tenantId: string
  bindingId: string | null
  domainMappingId: string
  pathPrefix: string | null
}

export async function assertDomainBindingAvailable(
  em: EntityManager,
  placement: DomainBindingPlacement,
  translate: Translate,
): Promise<void> {
  const where: Record<string, unknown> = {
    tenantId: placement.tenantId,
    domainMappingId: placement.domainMappingId,
    pathPrefix: placement.pathPrefix,
    deletedAt: null,
  }
  if (placement.bindingId) where.id = { $ne: placement.bindingId }
  if ((await em.count(EcommerceStoreDomainBinding, where as FilterQuery<EcommerceStoreDomainBinding>)) > 0) {
    throw duplicateBindingConflict(translate)
  }
}

function parseCreateInput(input: RawDomainBindingInput, ctx: CrudCtx): EcommerceStoreDomainBindingCreateInput {
  return ecommerceStoreDomainBindingCreateSchema.parse({ ...input, ...resolveWriteScope(ctx) })
}

function parseUpdateInput(input: RawDomainBindingInput, ctx: CrudCtx): EcommerceStoreDomainBindingUpdateInput {
  return ecommerceStoreDomainBindingUpdateSchema.parse({ ...input, ...resolveWriteScope(ctx) })
}

function bindingScope(binding: Pick<EcommerceStoreDomainBinding, 'tenantId' | 'organizationId'>): EcommerceWriteScope {
  return { tenantId: binding.tenantId, organizationId: binding.organizationId }
}

const clearedPrimaryByUpdate = new WeakMap<EcommerceStoreDomainBinding, EcommerceStoreDomainBinding[]>()

type DomainBindingListRow = Record<string, unknown>

export function toDomainBindingListItem(row: DomainBindingListRow): Record<string, unknown> {
  return {
    id: row[F.id],
    organizationId: row[F.organization_id] ?? null,
    tenantId: row[F.tenant_id] ?? null,
    storeId: row[F.store_id],
    domainMappingId: row[F.domain_mapping_id],
    pathPrefix: row[F.path_prefix] ?? null,
    isPrimary: row[F.is_primary] === true,
    createdAt: row[F.created_at] ?? null,
    updatedAt: row[F.updated_at] ?? null,
  }
}

const NOT_FOUND = { key: 'ecommerce.errors.domainBindingNotFound', fallback: 'The selected domain binding does not exist in this organization.' }

export const domainBindingCrud = makeCrudRoute<RawDomainBindingInput, RawDomainBindingInput, DomainBindingListQuery>({
  metadata: domainBindingRouteMetadata,
  orm: {
    entity: EcommerceStoreDomainBinding,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.ecommerce.ecommerce_store_domain_binding },
  enrichers: { entityId: E.ecommerce.ecommerce_store_domain_binding },
  list: {
    schema: domainBindingListQuerySchema,
    entityId: E.ecommerce.ecommerce_store_domain_binding,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.store_id,
      F.domain_mapping_id,
      F.path_prefix,
      F.is_primary,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      pathPrefix: F.path_prefix,
      isPrimary: F.is_primary,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    defaultSort: { field: 'createdAt', dir: 'asc' },
    tiebreakSortField: F.id,
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      const scopeOrganizationId = resolveScopeOrganizationId(ctx)
      if (scopeOrganizationId) filters[F.organization_id] = { $eq: scopeOrganizationId }
      if (query.id) filters[F.id] = { $eq: query.id }
      if (query.storeId) filters[F.store_id] = { $eq: query.storeId }
      if (query.domainMappingId) filters[F.domain_mapping_id] = { $eq: query.domainMappingId }
      const isPrimary = parseBooleanToken(query.isPrimary)
      if (isPrimary !== null) filters[F.is_primary] = { $eq: isPrimary }
      return filters
    },
    transformItem: (item: DomainBindingListRow) => toDomainBindingListItem(item),
  },
  events: {
    module: ECOMMERCE_EVENTS_MODULE,
    entity: STORE_DOMAIN_BINDING_EVENT_ENTITY,
    persistent: true,
    buildPayload: (emitCtx) => buildStoreDomainBindingEventPayload(emitCtx.entity as EcommerceStoreDomainBinding),
  },
  create: {
    schema: rawBodySchema,
    mapToEntity: (input, ctx) => {
      const parsed = parseCreateInput(input, ctx)
      return {
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        storeId: parsed.storeId,
        domainMappingId: parsed.domainMappingId,
        pathPrefix: parsed.pathPrefix ?? null,
        isPrimary: false,
      }
    },
    response: (entity) => {
      const binding = entity as EcommerceStoreDomainBinding
      return { id: binding.id, isPrimary: binding.isPrimary }
    },
  },
  update: {
    schema: rawBodySchema,
    getId: (input) => (typeof input.id === 'string' ? input.id : ''),
    applyToEntity: async (entity, input, ctx) => {
      const binding = entity as EcommerceStoreDomainBinding
      rememberDomainBindingPlacement(binding)
      const parsed = parseUpdateInput(input, ctx)
      const em = ctx.container.resolve('em') as EntityManager
      const { translate } = await resolveTranslations()
      const scope = bindingScope(binding)
      const nextStoreId = parsed.storeId ?? binding.storeId
      const nextDomainMappingId = parsed.domainMappingId ?? binding.domainMappingId
      const nextPathPrefix = hasOwn(parsed, 'pathPrefix') ? parsed.pathPrefix ?? null : binding.pathPrefix ?? null
      const storeChanged = nextStoreId !== binding.storeId
      if (storeChanged) await assertStoreInScope(em, nextStoreId, scope, translate)
      if (nextDomainMappingId !== binding.domainMappingId) {
        await assertDomainMappingInScope(ctx.container, nextDomainMappingId, scope, translate)
      }
      if (nextDomainMappingId !== binding.domainMappingId || nextPathPrefix !== (binding.pathPrefix ?? null)) {
        await assertDomainBindingAvailable(
          em,
          { tenantId: binding.tenantId, bindingId: binding.id, domainMappingId: nextDomainMappingId, pathPrefix: nextPathPrefix },
          translate,
        )
      }
      const nextPrimary = parsed.isPrimary ?? binding.isPrimary
      if (nextPrimary && (!binding.isPrimary || storeChanged)) {
        clearedPrimaryByUpdate.set(
          binding,
          await assignExclusiveFlag(
            em,
            domainBindingPrimaryFlag,
            { ...scope, storeId: nextStoreId },
            binding.id,
            () => primaryBindingConflict(translate),
          ),
        )
      }
      binding.storeId = nextStoreId
      binding.domainMappingId = nextDomainMappingId
      binding.pathPrefix = nextPathPrefix
      binding.isPrimary = nextPrimary
      try {
        await em.flush()
      } catch (err) {
        throw toDomainBindingUniqueConflict(err, translate)
      }
    },
    response: () => ({ ok: true }),
  },
  del: { idFrom: 'query', softDelete: true, response: () => ({ ok: true }) },
  hooks: {
    beforeUpdate: async (input, ctx) => {
      await assertRecordInWriteScope(ctx, EcommerceStoreDomainBinding, (input as { id?: unknown }).id, NOT_FOUND)
    },
    beforeDelete: async (id, ctx) => {
      await assertRecordInWriteScope(ctx, EcommerceStoreDomainBinding, id, NOT_FOUND)
    },
    beforeCreate: async (input, ctx) => {
      const result = ecommerceStoreDomainBindingCreateSchema.safeParse({ ...input, ...resolveWriteScope(ctx) })
      if (!result.success) return
      const { translate } = await resolveTranslations()
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const scope: EcommerceWriteScope = { tenantId: result.data.tenantId, organizationId: result.data.organizationId }
      await assertStoreInScope(em, result.data.storeId, scope, translate)
      await assertDomainMappingInScope(ctx.container, result.data.domainMappingId, scope, translate)
      const placement: DomainBindingPlacement = {
        tenantId: scope.tenantId,
        bindingId: null,
        domainMappingId: result.data.domainMappingId,
        pathPrefix: result.data.pathPrefix ?? null,
      }
      await assertDomainBindingAvailable(em, placement, translate)
      registerCreateConflictRecheck(ctx.request, () =>
        assertDomainBindingAvailable((ctx.container.resolve('em') as EntityManager).fork(), placement, translate),
      )
    },
    afterCreate: async (entity, ctx) => {
      clearCreateConflictRecheck(ctx.request)
      const binding = entity as EcommerceStoreDomainBinding
      if (parseCreateInput(ctx.input, ctx).isPrimary !== true) return
      const now = new Date()
      const em = ctx.container.resolve('em') as EntityManager
      const { promoted, cleared } = await promoteExclusiveFlag(
        em,
        domainBindingPrimaryFlag,
        { ...bindingScope(binding), storeId: binding.storeId },
        binding.id,
        now,
      )
      if (!promoted) return
      binding.isPrimary = true
      binding.updatedAt = now
      await announceStoreDomainBindingsUpdated(ctx.container, cleared)
    },
    afterUpdate: async (entity, ctx) => {
      const binding = entity as EcommerceStoreDomainBinding
      const cleared = clearedPrimaryByUpdate.get(binding)
      if (!cleared) return
      clearedPrimaryByUpdate.delete(binding)
      await announceStoreDomainBindingsUpdated(ctx.container, cleared)
    },
  },
})
