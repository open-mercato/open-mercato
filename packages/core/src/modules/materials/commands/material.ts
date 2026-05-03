import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  buildChanges,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Material, type MaterialKind, type MaterialLifecycleState } from '../data/entities'
import {
  createMaterialSchema,
  updateMaterialSchema,
  type CreateMaterialInput,
  type UpdateMaterialInput,
} from '../data/validators'

/**
 * Materials master CRUD commands (Phase 1 Step 3).
 *
 * Notes:
 * - Custom field hooks (collectCustomFieldValues / setCustomFieldsIfAny) will be wired in
 *   Step 12 alongside `ce.ts` registration. Until then, custom field values arriving on the
 *   request body are ignored by the strict zod schema.
 * - `is_sellable` is intentionally absent from create/update schemas — it is materialized
 *   from MaterialSalesProfile row existence (Step 5 subscriber). Strict-mode zod rejects
 *   any direct mutation attempt with HTTP 422.
 * - `replacement_material_id` and `base_unit_id` are stored as bare UUID FKs (no MikroORM
 *   relation) — same intra-module convention used elsewhere in this module.
 */

const materialCrudEvents: CrudEventsConfig = {
  module: 'materials',
  entity: 'material',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type MaterialSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  code: string
  name: string
  description: string | null
  kind: MaterialKind
  lifecycleState: MaterialLifecycleState
  replacementMaterialId: string | null
  baseUnitId: string | null
  isPurchasable: boolean
  isSellable: boolean
  isStockable: boolean
  isProducible: boolean
  isActive: boolean
  deletedAt: Date | null
}

type MaterialUndoPayload = {
  before?: MaterialSnapshot | null
  after?: MaterialSnapshot | null
}

async function loadMaterialSnapshot(em: EntityManager, id: string): Promise<MaterialSnapshot | null> {
  const material = await em.findOne(Material, { id })
  if (!material) return null
  return {
    id: material.id,
    organizationId: material.organizationId,
    tenantId: material.tenantId,
    code: material.code,
    name: material.name,
    description: material.description ?? null,
    kind: material.kind,
    lifecycleState: material.lifecycleState,
    replacementMaterialId: material.replacementMaterialId ?? null,
    baseUnitId: material.baseUnitId ?? null,
    isPurchasable: material.isPurchasable,
    isSellable: material.isSellable,
    isStockable: material.isStockable,
    isProducible: material.isProducible,
    isActive: material.isActive,
    deletedAt: material.deletedAt ?? null,
  }
}

const MATERIAL_TRACKED_COLUMNS: ReadonlyArray<keyof MaterialSnapshot> = [
  'code',
  'name',
  'description',
  'kind',
  'lifecycleState',
  'replacementMaterialId',
  'baseUnitId',
  'isPurchasable',
  'isStockable',
  'isProducible',
  'isActive',
] as const

const createMaterialCommand: CommandHandler<CreateMaterialInput, { materialId: string }> = {
  id: 'materials.material.create',
  async execute(rawInput, ctx) {
    const parsed = createMaterialSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const duplicate = await em.findOne(Material, {
      code: parsed.code,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      deletedAt: null,
    })
    if (duplicate) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(409, {
        error: translate('materials.material.errors.code_duplicate', 'Material code already exists in this organization'),
      })
    }

    const material = em.create(Material, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      code: parsed.code,
      name: parsed.name,
      description: parsed.description ?? null,
      kind: parsed.kind,
      lifecycleState: parsed.lifecycleState ?? 'draft',
      replacementMaterialId: parsed.replacementMaterialId ?? null,
      baseUnitId: parsed.baseUnitId ?? null,
      isPurchasable: parsed.isPurchasable ?? true,
      isStockable: parsed.isStockable ?? true,
      isProducible: parsed.isProducible ?? false,
      isActive: parsed.isActive ?? true,
    })
    em.persist(material)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: material,
      identifiers: {
        id: material.id,
        organizationId: material.organizationId,
        tenantId: material.tenantId,
      },
      events: materialCrudEvents,
    })

    return { materialId: material.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadMaterialSnapshot(em, result.materialId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadMaterialSnapshot(em, result.materialId)
    return {
      actionLabel: translate('materials.audit.material.create', 'Create material'),
      resourceKind: 'materials.material',
      resourceId: result.materialId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies MaterialUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const materialId = logEntry?.resourceId ?? null
    if (!materialId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const material = await em.findOne(Material, { id: materialId })
    if (material) {
      em.remove(material)
      await em.flush()
    }
  },
}

const updateMaterialCommand: CommandHandler<UpdateMaterialInput, { materialId: string }> = {
  id: 'materials.material.update',
  async prepare(rawInput, ctx) {
    const parsed = updateMaterialSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadMaterialSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = updateMaterialSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const material = await em.findOne(Material, { id: parsed.id })
    if (!material) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, { error: translate('materials.material.errors.not_found', 'Material not found') })
    }
    ensureTenantScope(ctx, material.tenantId)
    ensureOrganizationScope(ctx, material.organizationId)

    if (parsed.code !== undefined && parsed.code !== material.code) {
      const duplicate = await em.findOne(Material, {
        code: parsed.code,
        organizationId: material.organizationId,
        tenantId: material.tenantId,
        deletedAt: null,
        id: { $ne: material.id },
      })
      if (duplicate) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(409, {
          error: translate('materials.material.errors.code_duplicate', 'Material code already exists in this organization'),
        })
      }
      material.code = parsed.code
    }
    if (parsed.name !== undefined) material.name = parsed.name
    if (parsed.description !== undefined) material.description = parsed.description ?? null
    if (parsed.kind !== undefined) material.kind = parsed.kind
    if (parsed.lifecycleState !== undefined) material.lifecycleState = parsed.lifecycleState
    if (parsed.replacementMaterialId !== undefined) material.replacementMaterialId = parsed.replacementMaterialId ?? null
    if (parsed.baseUnitId !== undefined) material.baseUnitId = parsed.baseUnitId ?? null
    if (parsed.isPurchasable !== undefined) material.isPurchasable = parsed.isPurchasable
    if (parsed.isStockable !== undefined) material.isStockable = parsed.isStockable
    if (parsed.isProducible !== undefined) material.isProducible = parsed.isProducible
    if (parsed.isActive !== undefined) material.isActive = parsed.isActive

    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: material,
      identifiers: {
        id: material.id,
        organizationId: material.organizationId,
        tenantId: material.tenantId,
      },
      events: materialCrudEvents,
    })

    return { materialId: material.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as MaterialSnapshot | undefined
    if (!before) return null
    // Forked EM avoids identity-map cached entity drift between prepare and buildLog phases
    // (per .ai/lessons.md "Avoid identity-map stale snapshots").
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadMaterialSnapshot(em, before.id)
    const changes = after
      ? buildChanges(
          before as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
          MATERIAL_TRACKED_COLUMNS as unknown as string[],
        )
      : {}
    return {
      actionLabel: translate('materials.audit.material.update', 'Update material'),
      resourceKind: 'materials.material',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: after ?? null,
        } satisfies MaterialUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<MaterialUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let material = await em.findOne(Material, { id: before.id })
    if (!material) {
      material = em.create(Material, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        code: before.code,
        name: before.name,
        description: before.description,
        kind: before.kind,
        lifecycleState: before.lifecycleState,
        replacementMaterialId: before.replacementMaterialId,
        baseUnitId: before.baseUnitId,
        isPurchasable: before.isPurchasable,
        isSellable: before.isSellable,
        isStockable: before.isStockable,
        isProducible: before.isProducible,
        isActive: before.isActive,
      })
      em.persist(material)
    } else {
      material.code = before.code
      material.name = before.name
      material.description = before.description
      material.kind = before.kind
      material.lifecycleState = before.lifecycleState
      material.replacementMaterialId = before.replacementMaterialId
      material.baseUnitId = before.baseUnitId
      material.isPurchasable = before.isPurchasable
      material.isSellable = before.isSellable
      material.isStockable = before.isStockable
      material.isProducible = before.isProducible
      material.isActive = before.isActive
      material.deletedAt = before.deletedAt
    }
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: material,
      identifiers: {
        id: material.id,
        organizationId: material.organizationId,
        tenantId: material.tenantId,
      },
      events: materialCrudEvents,
    })
  },
}

const deleteMaterialCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown>; id?: string },
  { materialId: string }
> = {
  id: 'materials.material.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Material id required')
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadMaterialSnapshot(em, id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Material id required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const material = await em.findOne(Material, { id })
    if (!material) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, { error: translate('materials.material.errors.not_found', 'Material not found') })
    }
    ensureTenantScope(ctx, material.tenantId)
    ensureOrganizationScope(ctx, material.organizationId)

    // Soft-delete only — children (units, supplier links, prices, sales profile) cascade via
    // dedicated subscribers in their respective steps. Phase 1 enforces no-existing-supplier-links
    // and no-existing-prices guardrails inside the supplier/price commands; future modules add
    // their own checks via subscriber to materials.material.deleted.
    material.deletedAt = new Date()
    material.isActive = false
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: material,
      identifiers: {
        id: material.id,
        organizationId: material.organizationId,
        tenantId: material.tenantId,
      },
      events: materialCrudEvents,
    })

    return { materialId: material.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as MaterialSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('materials.audit.material.delete', 'Delete material'),
      resourceKind: 'materials.material',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies MaterialUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<MaterialUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const material = await em.findOne(Material, { id: before.id })
    if (!material) return
    // Restore soft-deleted material to its prior state.
    material.deletedAt = before.deletedAt
    material.isActive = before.isActive
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: material,
      identifiers: {
        id: material.id,
        organizationId: material.organizationId,
        tenantId: material.tenantId,
      },
      events: materialCrudEvents,
    })
  },
}

registerCommand(createMaterialCommand)
registerCommand(updateMaterialCommand)
registerCommand(deleteMaterialCommand)
