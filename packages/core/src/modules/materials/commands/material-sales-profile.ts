import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  buildChanges,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Material, MaterialSalesProfile } from '../data/entities'
import {
  upsertMaterialSalesProfileSchema,
  type UpsertMaterialSalesProfileInput,
} from '../data/validators'

/**
 * MaterialSalesProfile commands (Phase 1 Step 5).
 *
 * The sales profile is a 1:1 child of Material. Phase 1 exposes only upsert + delete:
 * - Upsert may emit `created` (new row) or `updated` (existing row).
 * - Delete is soft (sets deleted_at + is_active=false), counterpart `materials.sales_profile.deleted`
 *   event triggers subscriber sync-sales-on-delete which clears Material.is_sellable.
 *
 * Material-level capability flag is_sellable is materialized by the two
 * subscribers/sync-sales-* listeners — never set by these commands directly.
 */

const salesProfileCrudEvents: CrudEventsConfig = {
  module: 'materials',
  entity: 'sales_profile',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
    // materialId is needed by sync-sales-on-* subscribers; entity FK is reliable here because
    // the entity was just persisted/updated and the EM has the freshest state.
    materialId: (ctx.entity as MaterialSalesProfile | undefined)?.materialId ?? null,
  }),
}

type SalesProfileSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  materialId: string
  gtin: string | null
  commodityCode: string | null
  isActive: boolean
  deletedAt: Date | null
}

type SalesProfileUndoPayload = {
  before?: SalesProfileSnapshot | null
  after?: SalesProfileSnapshot | null
  // Records whether the upsert created a new row or modified an existing one — drives
  // undo logic: created → remove, updated → restore prior values.
  wasCreate?: boolean
}

async function loadSalesProfileSnapshot(
  em: EntityManager,
  materialId: string,
): Promise<SalesProfileSnapshot | null> {
  const profile = await em.findOne(MaterialSalesProfile, { materialId, deletedAt: null })
  if (!profile) return null
  return {
    id: profile.id,
    organizationId: profile.organizationId,
    tenantId: profile.tenantId,
    materialId: profile.materialId,
    gtin: profile.gtin ?? null,
    commodityCode: profile.commodityCode ?? null,
    isActive: profile.isActive,
    deletedAt: profile.deletedAt ?? null,
  }
}

async function loadParentMaterial(
  em: EntityManager,
  materialId: string,
): Promise<Material | null> {
  return await em.findOne(Material, { id: materialId, deletedAt: null })
}

const SALES_PROFILE_TRACKED_COLUMNS: ReadonlyArray<keyof SalesProfileSnapshot> = [
  'gtin',
  'commodityCode',
  'isActive',
] as const

// ── upsert ───────────────────────────────────────────────────────────────────
//
// Single command for both PUT-create and PUT-update semantics. The handler determines
// `wasCreate` at execution time based on whether a live row exists for the materialId.

type UpsertInput = UpsertMaterialSalesProfileInput & { materialId: string }

const upsertSalesProfileCommand: CommandHandler<UpsertInput, { profileId: string; wasCreate: boolean }> = {
  id: 'materials.sales_profile.upsert',
  async prepare(rawInput, ctx) {
    if (!rawInput?.materialId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadSalesProfileSnapshot(em, rawInput.materialId)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = upsertMaterialSalesProfileSchema.parse({
      organizationId: rawInput.organizationId,
      tenantId: rawInput.tenantId,
      gtin: rawInput.gtin ?? null,
      commodityCode: rawInput.commodityCode ?? null,
      isActive: rawInput.isActive,
    })
    const materialId = rawInput.materialId
    if (!materialId) throw new CrudHttpError(400, { error: 'materialId is required' })
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const material = await loadParentMaterial(em, materialId)
    if (!material) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, {
        error: translate('materials.material.errors.not_found', 'Material not found'),
      })
    }
    if (material.organizationId !== parsed.organizationId || material.tenantId !== parsed.tenantId) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(403, {
        error: translate('materials.errors.cross_org_forbidden', 'Material belongs to a different organization'),
      })
    }

    let profile = await em.findOne(MaterialSalesProfile, { materialId, deletedAt: null })
    const wasCreate = !profile

    if (profile) {
      profile.gtin = parsed.gtin ?? null
      profile.commodityCode = parsed.commodityCode ?? null
      if (parsed.isActive !== undefined) profile.isActive = parsed.isActive
    } else {
      profile = em.create(MaterialSalesProfile, {
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        materialId,
        gtin: parsed.gtin ?? null,
        commodityCode: parsed.commodityCode ?? null,
        isActive: parsed.isActive ?? true,
      })
      em.persist(profile)
    }
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: wasCreate ? 'created' : 'updated',
      entity: profile,
      identifiers: {
        id: profile.id,
        organizationId: profile.organizationId,
        tenantId: profile.tenantId,
      },
      events: salesProfileCrudEvents,
    })

    return { profileId: profile.id, wasCreate }
  },
  buildLog: async ({ snapshots, result, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SalesProfileSnapshot | undefined
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const profile = await em.findOne(MaterialSalesProfile, { id: result.profileId })
    const after: SalesProfileSnapshot | null = profile
      ? {
          id: profile.id,
          organizationId: profile.organizationId,
          tenantId: profile.tenantId,
          materialId: profile.materialId,
          gtin: profile.gtin ?? null,
          commodityCode: profile.commodityCode ?? null,
          isActive: profile.isActive,
          deletedAt: profile.deletedAt ?? null,
        }
      : null
    const changes =
      before && after
        ? buildChanges(
            before as unknown as Record<string, unknown>,
            after as unknown as Record<string, unknown>,
            SALES_PROFILE_TRACKED_COLUMNS as unknown as string[],
          )
        : {}
    return {
      actionLabel: result.wasCreate
        ? translate('materials.audit.sales_profile.create', 'Create material sales profile')
        : translate('materials.audit.sales_profile.update', 'Update material sales profile'),
      resourceKind: 'materials.sales_profile',
      resourceId: result.profileId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      changes,
      payload: {
        undo: {
          before: before ?? null,
          after,
          wasCreate: result.wasCreate,
        } satisfies SalesProfileUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<SalesProfileUndoPayload>(logEntry)
    if (!payload) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    if (payload.wasCreate) {
      // Undo create: hard-delete the row that did not exist before.
      const after = payload.after
      if (!after) return
      const profile = await em.findOne(MaterialSalesProfile, { id: after.id })
      if (profile) {
        em.remove(profile)
        await em.flush()
        const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
        await emitCrudUndoSideEffects({
          dataEngine,
          action: 'created',
          entity: profile,
          identifiers: {
            id: profile.id,
            organizationId: profile.organizationId,
            tenantId: profile.tenantId,
          },
          events: salesProfileCrudEvents,
        })
      }
      return
    }

    // Undo update: restore prior values.
    const before = payload.before
    if (!before) return
    const profile = await em.findOne(MaterialSalesProfile, { id: before.id })
    if (!profile) return
    profile.gtin = before.gtin
    profile.commodityCode = before.commodityCode
    profile.isActive = before.isActive
    profile.deletedAt = before.deletedAt
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: profile,
      identifiers: {
        id: profile.id,
        organizationId: profile.organizationId,
        tenantId: profile.tenantId,
      },
      events: salesProfileCrudEvents,
    })
  },
}

// ── delete ───────────────────────────────────────────────────────────────────

type DeleteInput = {
  materialId: string
  organizationId: string
  tenantId: string
}

const deleteSalesProfileCommand: CommandHandler<DeleteInput, { profileId: string }> = {
  id: 'materials.sales_profile.delete',
  async prepare(rawInput, ctx) {
    if (!rawInput?.materialId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadSalesProfileSnapshot(em, rawInput.materialId)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    if (!rawInput.materialId) throw new CrudHttpError(400, { error: 'materialId is required' })
    ensureTenantScope(ctx, rawInput.tenantId)
    ensureOrganizationScope(ctx, rawInput.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const profile = await em.findOne(MaterialSalesProfile, {
      materialId: rawInput.materialId,
      deletedAt: null,
    })
    if (!profile) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, {
        error: translate('materials.sales_profile.errors.not_found', 'Sales profile not found for this material'),
      })
    }
    if (profile.organizationId !== rawInput.organizationId || profile.tenantId !== rawInput.tenantId) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(403, {
        error: translate('materials.errors.cross_org_forbidden', 'Sales profile belongs to a different organization'),
      })
    }

    profile.deletedAt = new Date()
    profile.isActive = false
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: profile,
      identifiers: {
        id: profile.id,
        organizationId: profile.organizationId,
        tenantId: profile.tenantId,
      },
      events: salesProfileCrudEvents,
    })

    return { profileId: profile.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as SalesProfileSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('materials.audit.sales_profile.delete', 'Delete material sales profile'),
      resourceKind: 'materials.sales_profile',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies SalesProfileUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<SalesProfileUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const profile = await em.findOne(MaterialSalesProfile, { id: before.id })
    if (!profile) return
    profile.deletedAt = before.deletedAt
    profile.isActive = before.isActive
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: profile,
      identifiers: {
        id: profile.id,
        organizationId: profile.organizationId,
        tenantId: profile.tenantId,
      },
      events: salesProfileCrudEvents,
    })
  },
}

registerCommand(upsertSalesProfileCommand)
registerCommand(deleteSalesProfileCommand)
