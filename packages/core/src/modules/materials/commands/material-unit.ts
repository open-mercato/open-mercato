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
import { Material, MaterialUnit, type MaterialUnitUsage } from '../data/entities'
import {
  createMaterialUnitSchema,
  updateMaterialUnitSchema,
  type CreateMaterialUnitInput,
  type UpdateMaterialUnitInput,
} from '../data/validators'

/**
 * MaterialUnit commands (Phase 1 Step 6).
 *
 * Domain invariants enforced here:
 * 1. Parent Material must exist in the same organization/tenant scope as the request.
 * 2. `(material_id, code)` is unique per live row — DB partial unique index also guards this;
 *    the command checks first to surface a translated 409 instead of a raw constraint violation.
 * 3. Exactly one `is_base = true` per material — DB partial unique index guards; command
 *    auto-flips the previous base off when a new base arrives, then flushes between mutations
 *    (per .ai/lessons.md "Flush entity updates before running relation syncs that query").
 * 4. At most one `is_default_for_usage = true` per (material, usage) — same flush-then-rebalance
 *    pattern; auto-clears the previous default for the same usage on toggle.
 * 5. Base unit (is_base=true) must carry factor = 1.0 — overrides factor on create/update.
 * 6. Cannot deactivate the base unit if it is the only unit (would leave material without a
 *    base). Phase 1 punts; Step 10 will revisit when lifecycle transitions land.
 */

const unitCrudEvents: CrudEventsConfig = {
  module: 'materials',
  entity: 'unit',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
    materialId: (ctx.entity as MaterialUnit | undefined)?.materialId ?? null,
  }),
}

type UnitSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  materialId: string
  code: string
  label: string
  usage: MaterialUnitUsage
  factor: string
  isBase: boolean
  isDefaultForUsage: boolean
  isActive: boolean
  deletedAt: Date | null
}

type UnitUndoPayload = {
  before?: UnitSnapshot | null
  after?: UnitSnapshot | null
}

async function loadUnitSnapshot(em: EntityManager, id: string): Promise<UnitSnapshot | null> {
  const unit = await em.findOne(MaterialUnit, { id })
  if (!unit) return null
  return {
    id: unit.id,
    organizationId: unit.organizationId,
    tenantId: unit.tenantId,
    materialId: unit.materialId,
    code: unit.code,
    label: unit.label,
    usage: unit.usage,
    factor: unit.factor,
    isBase: unit.isBase,
    isDefaultForUsage: unit.isDefaultForUsage,
    isActive: unit.isActive,
    deletedAt: unit.deletedAt ?? null,
  }
}

async function ensureMaterialInScope(
  em: EntityManager,
  materialId: string,
  organizationId: string,
  tenantId: string,
): Promise<Material> {
  const material = await em.findOne(Material, { id: materialId, deletedAt: null })
  const { translate } = await resolveTranslations()
  if (!material) {
    throw new CrudHttpError(404, {
      error: translate('materials.material.errors.not_found', 'Material not found'),
    })
  }
  if (material.organizationId !== organizationId || material.tenantId !== tenantId) {
    throw new CrudHttpError(403, {
      error: translate('materials.errors.cross_org_forbidden', 'Material belongs to a different organization'),
    })
  }
  return material
}

async function clearOtherBaseUnit(em: EntityManager, materialId: string, exceptId: string | null) {
  const others = await em.find(MaterialUnit, {
    materialId,
    isBase: true,
    deletedAt: null,
    ...(exceptId ? { id: { $ne: exceptId } } : {}),
  })
  for (const other of others) {
    other.isBase = false
  }
  if (others.length) await em.flush()
}

async function clearOtherDefaultForUsage(
  em: EntityManager,
  materialId: string,
  usage: MaterialUnitUsage,
  exceptId: string | null,
) {
  const others = await em.find(MaterialUnit, {
    materialId,
    usage,
    isDefaultForUsage: true,
    deletedAt: null,
    ...(exceptId ? { id: { $ne: exceptId } } : {}),
  })
  for (const other of others) {
    other.isDefaultForUsage = false
  }
  if (others.length) await em.flush()
}

const UNIT_TRACKED_COLUMNS: ReadonlyArray<keyof UnitSnapshot> = [
  'code',
  'label',
  'usage',
  'factor',
  'isBase',
  'isDefaultForUsage',
  'isActive',
] as const

const createUnitCommand: CommandHandler<CreateMaterialUnitInput, { unitId: string }> = {
  id: 'materials.unit.create',
  async execute(rawInput, ctx) {
    const parsed = createMaterialUnitSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await ensureMaterialInScope(em, parsed.materialId, parsed.organizationId, parsed.tenantId)

    const duplicate = await em.findOne(MaterialUnit, {
      materialId: parsed.materialId,
      code: parsed.code,
      deletedAt: null,
    })
    if (duplicate) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(409, {
        error: translate('materials.unit.errors.code_duplicate', 'Unit code already exists for this material'),
      })
    }

    const isBase = !!parsed.isBase
    const isDefaultForUsage = !!parsed.isDefaultForUsage
    // Base unit always has factor 1.0; overrides any user-supplied value.
    const factor = isBase ? '1.000000' : parsed.factor ?? '1.000000'

    const unit = em.create(MaterialUnit, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      materialId: parsed.materialId,
      code: parsed.code,
      label: parsed.label,
      usage: parsed.usage,
      factor,
      isBase,
      isDefaultForUsage,
      isActive: parsed.isActive ?? true,
    })
    em.persist(unit)
    await em.flush()

    // Atomicity not strictly transactional here — DB partial unique indexes are the actual
    // safety net; these helpers exist to clear stale flags so the index never has to throw.
    if (isBase) await clearOtherBaseUnit(em, parsed.materialId, unit.id)
    if (isDefaultForUsage) await clearOtherDefaultForUsage(em, parsed.materialId, parsed.usage, unit.id)

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: unit,
      identifiers: {
        id: unit.id,
        organizationId: unit.organizationId,
        tenantId: unit.tenantId,
      },
      events: unitCrudEvents,
    })

    return { unitId: unit.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadUnitSnapshot(em, result.unitId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadUnitSnapshot(em, result.unitId)
    return {
      actionLabel: translate('materials.audit.unit.create', 'Create material unit'),
      resourceKind: 'materials.unit',
      resourceId: result.unitId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies UnitUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const unitId = logEntry?.resourceId ?? null
    if (!unitId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const unit = await em.findOne(MaterialUnit, { id: unitId })
    if (unit) {
      em.remove(unit)
      await em.flush()
    }
  },
}

const updateUnitCommand: CommandHandler<UpdateMaterialUnitInput, { unitId: string }> = {
  id: 'materials.unit.update',
  async prepare(rawInput, ctx) {
    const parsed = updateMaterialUnitSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadUnitSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = updateMaterialUnitSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const unit = await em.findOne(MaterialUnit, { id: parsed.id })
    if (!unit) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, { error: translate('materials.unit.errors.not_found', 'Unit not found') })
    }
    ensureTenantScope(ctx, unit.tenantId)
    ensureOrganizationScope(ctx, unit.organizationId)

    if (parsed.code !== undefined && parsed.code !== unit.code) {
      const duplicate = await em.findOne(MaterialUnit, {
        materialId: unit.materialId,
        code: parsed.code,
        deletedAt: null,
        id: { $ne: unit.id },
      })
      if (duplicate) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(409, {
          error: translate('materials.unit.errors.code_duplicate', 'Unit code already exists for this material'),
        })
      }
      unit.code = parsed.code
    }
    if (parsed.label !== undefined) unit.label = parsed.label
    if (parsed.usage !== undefined) unit.usage = parsed.usage

    // Apply isBase before factor so the base-unit factor=1 invariant wins on update.
    const willBeBase = parsed.isBase !== undefined ? parsed.isBase : unit.isBase
    if (parsed.isBase !== undefined) unit.isBase = parsed.isBase
    if (willBeBase) {
      unit.factor = '1.000000'
    } else if (parsed.factor !== undefined) {
      unit.factor = parsed.factor
    }
    if (parsed.isDefaultForUsage !== undefined) unit.isDefaultForUsage = parsed.isDefaultForUsage
    if (parsed.isActive !== undefined) unit.isActive = parsed.isActive

    await em.flush()

    if (willBeBase && parsed.isBase) {
      await clearOtherBaseUnit(em, unit.materialId, unit.id)
    }
    if (unit.isDefaultForUsage) {
      await clearOtherDefaultForUsage(em, unit.materialId, unit.usage, unit.id)
    }

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: unit,
      identifiers: {
        id: unit.id,
        organizationId: unit.organizationId,
        tenantId: unit.tenantId,
      },
      events: unitCrudEvents,
    })

    return { unitId: unit.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as UnitSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadUnitSnapshot(em, before.id)
    const changes = after
      ? buildChanges(
          before as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
          UNIT_TRACKED_COLUMNS as unknown as string[],
        )
      : {}
    return {
      actionLabel: translate('materials.audit.unit.update', 'Update material unit'),
      resourceKind: 'materials.unit',
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
        } satisfies UnitUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UnitUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let unit = await em.findOne(MaterialUnit, { id: before.id })
    if (!unit) {
      unit = em.create(MaterialUnit, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        materialId: before.materialId,
        code: before.code,
        label: before.label,
        usage: before.usage,
        factor: before.factor,
        isBase: before.isBase,
        isDefaultForUsage: before.isDefaultForUsage,
        isActive: before.isActive,
      })
      em.persist(unit)
    } else {
      unit.code = before.code
      unit.label = before.label
      unit.usage = before.usage
      unit.factor = before.factor
      unit.isBase = before.isBase
      unit.isDefaultForUsage = before.isDefaultForUsage
      unit.isActive = before.isActive
      unit.deletedAt = before.deletedAt
    }
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: unit,
      identifiers: {
        id: unit.id,
        organizationId: unit.organizationId,
        tenantId: unit.tenantId,
      },
      events: unitCrudEvents,
    })
  },
}

const deleteUnitCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown>; id?: string },
  { unitId: string }
> = {
  id: 'materials.unit.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Unit id required')
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadUnitSnapshot(em, id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Unit id required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const unit = await em.findOne(MaterialUnit, { id })
    if (!unit) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, { error: translate('materials.unit.errors.not_found', 'Unit not found') })
    }
    ensureTenantScope(ctx, unit.tenantId)
    ensureOrganizationScope(ctx, unit.organizationId)

    // Phase 1 guardrail: refuse to soft-delete the base unit while there are other units left.
    // Materials need exactly one base; without one downstream consumers (procurement, inventory)
    // can't compute conversions. Step 10 will tighten this when lifecycle transitions land.
    if (unit.isBase) {
      const liveSiblings = await em.count(MaterialUnit, {
        materialId: unit.materialId,
        deletedAt: null,
        id: { $ne: unit.id },
      })
      if (liveSiblings > 0) {
        const { translate } = await resolveTranslations()
        throw new CrudHttpError(409, {
          error: translate(
            'materials.unit.errors.base_with_siblings',
            'Cannot delete the base unit while other units exist for this material. Promote another unit to base first.',
          ),
        })
      }
    }

    unit.deletedAt = new Date()
    unit.isActive = false
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: unit,
      identifiers: {
        id: unit.id,
        organizationId: unit.organizationId,
        tenantId: unit.tenantId,
      },
      events: unitCrudEvents,
    })

    return { unitId: unit.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as UnitSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('materials.audit.unit.delete', 'Delete material unit'),
      resourceKind: 'materials.unit',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies UnitUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UnitUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const unit = await em.findOne(MaterialUnit, { id: before.id })
    if (!unit) return
    unit.deletedAt = before.deletedAt
    unit.isActive = before.isActive
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: unit,
      identifiers: {
        id: unit.id,
        organizationId: unit.organizationId,
        tenantId: unit.tenantId,
      },
      events: unitCrudEvents,
    })
  },
}

registerCommand(createUnitCommand)
registerCommand(updateUnitCommand)
registerCommand(deleteUnitCommand)
