import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { RequiredEntityData } from '@mikro-orm/core'
import {
  parseWithCustomFields,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
  snapshotsEqual,
} from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'
import { setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { z } from 'zod'
import { EudrProductMapping } from '../data/entities'
import {
  productMappingCreateSchema,
  productMappingUpdateSchema,
  type ProductMappingCreateInput,
  type ProductMappingUpdateInput,
} from '../data/validators'

const PRODUCT_MAPPING_ENTITY_ID = 'eudr:eudr_product_mapping'

type ScopedCommandInput = {
  tenantId: string
  organizationId: string
}

type ProductSnapshot = {
  name?: string | null
  sku?: string | null
}

type ProductMappingSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  productId: string
  productSnapshot: ProductSnapshot | null
  commodity: string
  hsCode: string | null
  isInScope: boolean
  notes: string | null
  speciesScientificName: string | null
  speciesCommonName: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  custom?: Record<string, unknown> | null
}

type ProductMappingUndoPayload = {
  before?: ProductMappingSnapshot | null
  after?: ProductMappingSnapshot | null
}

type ScopedProductMappingCreateInput = ProductMappingCreateInput & ScopedCommandInput
type ScopedProductMappingUpdateInput = ProductMappingUpdateInput & Partial<ScopedCommandInput>

type ProductMappingCommandResult = {
  entityId: string
  updatedAt?: Date
}

const scopedCommandInputSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

const productMappingCrudIndexer: CrudIndexerConfig<EudrProductMapping> = {
  entityType: E.eudr.eudr_product_mapping,
}

const productMappingCrudEvents: CrudEventsConfig<EudrProductMapping> = {
  module: 'eudr',
  entity: 'product_mapping',
  persistent: true,
  buildPayload: (emitContext) => ({
    id: emitContext.identifiers.id,
    entityId: emitContext.entity?.id ?? emitContext.identifiers.id,
    organizationId: emitContext.identifiers.organizationId,
    tenantId: emitContext.identifiers.tenantId,
  }),
}

function parseScopedCommandInput(input: unknown): ScopedCommandInput {
  return scopedCommandInputSchema.parse(input)
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

function productMappingSeedFromSnapshot(snapshot: ProductMappingSnapshot): RequiredEntityData<EudrProductMapping> {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    productId: snapshot.productId,
    productSnapshot: snapshot.productSnapshot,
    commodity: snapshot.commodity,
    hsCode: snapshot.hsCode,
    isInScope: snapshot.isInScope,
    notes: snapshot.notes,
    speciesScientificName: snapshot.speciesScientificName,
    speciesCommonName: snapshot.speciesCommonName,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: toDate(snapshot.deletedAt),
  }
}

async function loadProductMappingSnapshot(em: EntityManager, entityId: string): Promise<ProductMappingSnapshot | null> {
  const record = await em.findOne(EudrProductMapping, { id: entityId })
  if (!record) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: PRODUCT_MAPPING_ENTITY_ID,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    productId: record.productId,
    productSnapshot: record.productSnapshot ?? null,
    commodity: record.commodity,
    hsCode: record.hsCode ?? null,
    isInScope: record.isInScope,
    notes: record.notes ?? null,
    speciesScientificName: record.speciesScientificName ?? null,
    speciesCommonName: record.speciesCommonName ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
    custom: Object.keys(custom).length ? custom : null,
  }
}

async function assertUniqueProductMapping(
  em: EntityManager,
  input: {
    tenantId: string
    organizationId: string
    productId: string
    commodity: string
    excludeId?: string
  },
): Promise<void> {
  const existing = await em.findOne(EudrProductMapping, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    productId: input.productId,
    commodity: input.commodity,
    deletedAt: null,
    ...(input.excludeId ? { id: { $ne: input.excludeId } } : {}),
  })
  if (existing) {
    throw new CrudHttpError(400, { error: 'eudr.errors.duplicateMapping' })
  }
}

function restoreProductMapping(record: EudrProductMapping, snapshot: ProductMappingSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.productId = snapshot.productId
  record.productSnapshot = snapshot.productSnapshot
  record.commodity = snapshot.commodity
  record.hsCode = snapshot.hsCode
  record.isInScope = snapshot.isInScope
  record.notes = snapshot.notes
  record.speciesScientificName = snapshot.speciesScientificName
  record.speciesCommonName = snapshot.speciesCommonName
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = toDate(snapshot.deletedAt)
}

async function setProductMappingCustomFields(
  dataEngine: DataEngine,
  entityId: string,
  organizationId: string,
  tenantId: string,
  values: Record<string, unknown>,
): Promise<void> {
  await setCustomFieldsIfAny({
    dataEngine,
    entityId: PRODUCT_MAPPING_ENTITY_ID,
    recordId: entityId,
    organizationId,
    tenantId,
    values,
    notify: false,
  })
}

const createProductMappingCommand: CommandHandler<ScopedProductMappingCreateInput, ProductMappingCommandResult> = {
  id: 'eudr.product_mappings.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(productMappingCreateSchema, rawInput)
    const scope = parseScopedCommandInput(rawInput)
    ensureTenantScope(ctx, scope.tenantId)
    ensureOrganizationScope(ctx, scope.organizationId)

    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record!: EudrProductMapping

    await runCrudCommandWrite({
      ctx,
      em: entityManager,
      entityId: PRODUCT_MAPPING_ENTITY_ID,
      action: 'created',
      scope,
      customFields: custom,
      events: productMappingCrudEvents,
      indexer: productMappingCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
      }),
      phases: [
        () => assertUniqueProductMapping(entityManager, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          productId: parsed.productId,
          commodity: parsed.commodity,
        }),
        () => {
          record = entityManager.create(EudrProductMapping, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            productId: parsed.productId,
            productSnapshot: parsed.productSnapshot ?? null,
            commodity: parsed.commodity,
            hsCode: parsed.hsCode ?? null,
            isInScope: parsed.isInScope ?? true,
            notes: parsed.notes ?? null,
            speciesScientificName: parsed.commodity === 'wood' ? (parsed.speciesScientificName ?? null) : null,
            speciesCommonName: parsed.commodity === 'wood' ? (parsed.speciesCommonName ?? null) : null,
          })
          entityManager.persist(record)
        },
      ],
    })

    return { entityId: record.id }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    return loadProductMappingSnapshot(entityManager, result.entityId)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as ProductMappingSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.product_mappings.create', 'Create EUDR product mapping'),
      resourceKind: 'eudr.product_mapping',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies ProductMappingUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProductMappingUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await entityManager.findOne(EudrProductMapping, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    await setProductMappingCustomFields(dataEngine, after.id, after.organizationId, after.tenantId, resetValues)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: productMappingCrudIndexer,
      events: productMappingCrudEvents,
    })
  },
  redo: makeCreateRedo<EudrProductMapping, ProductMappingSnapshot, ScopedProductMappingCreateInput, ProductMappingCommandResult>({
    entityClass: EudrProductMapping,
    seedFromSnapshot: productMappingSeedFromSnapshot,
    buildResult: (entity) => ({ entityId: entity.id }),
    indexer: productMappingCrudIndexer,
    events: productMappingCrudEvents,
    afterRestore: async ({ ctx, entity, snapshot }) => {
      if (!snapshot.custom || !Object.keys(snapshot.custom).length) return
      await setProductMappingCustomFields(
        ctx.container.resolve('dataEngine') as DataEngine,
        entity.id,
        entity.organizationId,
        entity.tenantId,
        snapshot.custom,
      )
    },
  }),
}

const updateProductMappingCommand: CommandHandler<ScopedProductMappingUpdateInput, ProductMappingCommandResult> = {
  id: 'eudr.product_mappings.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(productMappingUpdateSchema, rawInput)
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadProductMappingSnapshot(entityManager, parsed.id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(productMappingUpdateSchema, rawInput)
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await entityManager.findOne(EudrProductMapping, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'EUDR product mapping not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    const nextProductId = parsed.productId ?? record.productId
    const nextCommodity = parsed.commodity ?? record.commodity

    await runCrudCommandWrite({
      ctx,
      em: entityManager,
      entityId: PRODUCT_MAPPING_ENTITY_ID,
      action: 'updated',
      scope: { tenantId: record.tenantId, organizationId: record.organizationId },
      customFields: custom,
      events: productMappingCrudEvents,
      indexer: productMappingCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
      }),
      phases: [
        async () => {
          if (nextProductId === record.productId && nextCommodity === record.commodity) return
          await assertUniqueProductMapping(entityManager, {
            tenantId: record.tenantId,
            organizationId: record.organizationId,
            productId: nextProductId,
            commodity: nextCommodity,
            excludeId: record.id,
          })
        },
        () => {
          if (parsed.productId !== undefined) record.productId = parsed.productId
          if (parsed.productSnapshot !== undefined) record.productSnapshot = parsed.productSnapshot ?? null
          if (parsed.commodity !== undefined) record.commodity = parsed.commodity
          if (parsed.hsCode !== undefined) record.hsCode = parsed.hsCode ?? null
          if (parsed.isInScope !== undefined) record.isInScope = parsed.isInScope
          if (parsed.notes !== undefined) record.notes = parsed.notes ?? null
          if (parsed.speciesScientificName !== undefined) record.speciesScientificName = parsed.speciesScientificName ?? null
          if (parsed.speciesCommonName !== undefined) record.speciesCommonName = parsed.speciesCommonName ?? null
          if (nextCommodity !== 'wood') {
            record.speciesScientificName = null
            record.speciesCommonName = null
          }
        },
      ],
    })

    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    return loadProductMappingSnapshot(entityManager, result.entityId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ProductMappingSnapshot | undefined
    const after = snapshots.after as ProductMappingSnapshot | undefined
    if (!before) return null
    if (after && snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.product_mappings.update', 'Update EUDR product mapping'),
      resourceKind: 'eudr.product_mapping',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: {
        undo: { before, after: after ?? null } satisfies ProductMappingUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProductMappingUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await entityManager.findOne(EudrProductMapping, { id: before.id })
    if (!record) {
      record = entityManager.create(EudrProductMapping, productMappingSeedFromSnapshot(before))
      entityManager.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreProductMapping(record, before)
    }
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    await setProductMappingCustomFields(dataEngine, before.id, before.organizationId, before.tenantId, resetValues)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: productMappingCrudIndexer,
      events: productMappingCrudEvents,
    })
  },
}

const deleteProductMappingCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, ProductMappingCommandResult> = {
  id: 'eudr.product_mappings.delete',
  async prepare(input, ctx) {
    const entityId = requireId(input, 'EUDR product mapping id required')
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadProductMappingSnapshot(entityManager, entityId)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const entityId = requireId(input, 'EUDR product mapping id required')
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await entityManager.findOne(EudrProductMapping, { id: entityId, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'EUDR product mapping not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    const snapshot = await loadProductMappingSnapshot(entityManager, entityId)
    record.deletedAt = new Date()
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (snapshot?.custom) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      await setProductMappingCustomFields(dataEngine, snapshot.id, snapshot.organizationId, snapshot.tenantId, resetValues)
    }
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: productMappingCrudIndexer,
      events: productMappingCrudEvents,
    })
    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as ProductMappingSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.product_mappings.delete', 'Delete EUDR product mapping'),
      resourceKind: 'eudr.product_mapping',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies ProductMappingUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ProductMappingUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await entityManager.findOne(EudrProductMapping, { id: before.id })
    if (!record) {
      record = entityManager.create(EudrProductMapping, productMappingSeedFromSnapshot(before))
      entityManager.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreProductMapping(record, before)
    }
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (before.custom) {
      await setProductMappingCustomFields(dataEngine, before.id, before.organizationId, before.tenantId, before.custom)
    }
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: productMappingCrudIndexer,
      events: productMappingCrudEvents,
    })
  },
}

registerCommand(createProductMappingCommand)
registerCommand(updateProductMappingCommand)
registerCommand(deleteProductMappingCommand)
