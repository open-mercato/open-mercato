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
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerCompanyProfile } from '@open-mercato/core/modules/customers/data/entities'
import { Material, MaterialSupplierLink } from '../data/entities'
import {
  createMaterialSupplierLinkSchema,
  updateMaterialSupplierLinkSchema,
  type CreateMaterialSupplierLinkInput,
  type UpdateMaterialSupplierLinkInput,
} from '../data/validators'

/**
 * MaterialSupplierLink commands (Phase 1 Step 7).
 *
 * Domain invariants enforced here:
 * 1. Parent Material must exist in the same org/tenant scope as the request.
 * 2. supplier_company_id must reference a CustomerCompanyProfile in the same org/tenant —
 *    enforced via findOneWithDecryption (per .ai/lessons.md "Cross-module FK validation").
 *    Phase 1 does NOT additionally check that the company is tagged with the 'supplier' role
 *    via CustomerEntityRole — that is a UX hint, not a data integrity rule, and adding it
 *    here would couple us to the CRM role taxonomy. Step 14 widget can render a "no role
 *    assigned" warning if useful.
 * 3. (material_id, supplier_company_id) is unique among live rows — DB partial unique index
 *    guards; command surfaces a translated 409 first.
 * 4. preferred=true is mutually exclusive across the material — command auto-clears any
 *    sibling preferred flag (mirror of MaterialUnit.is_base pattern from Step 6).
 *
 * Soft-delete cascade on Material.deleted is still pending; will be addressed alongside
 * other children in a dedicated cascade subscriber commit.
 */

const supplierLinkCrudEvents: CrudEventsConfig = {
  module: 'materials',
  entity: 'supplier_link',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
    materialId: (ctx.entity as MaterialSupplierLink | undefined)?.materialId ?? null,
    supplierCompanyId: (ctx.entity as MaterialSupplierLink | undefined)?.supplierCompanyId ?? null,
  }),
}

type SupplierLinkSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  materialId: string
  supplierCompanyId: string
  supplierSku: string | null
  minOrderQty: string | null
  leadTimeDays: number | null
  preferred: boolean
  notes: string | null
  isActive: boolean
  deletedAt: Date | null
}

type SupplierLinkUndoPayload = {
  before?: SupplierLinkSnapshot | null
  after?: SupplierLinkSnapshot | null
}

async function loadSupplierLinkSnapshot(
  em: EntityManager,
  id: string,
): Promise<SupplierLinkSnapshot | null> {
  const link = await em.findOne(MaterialSupplierLink, { id })
  if (!link) return null
  return {
    id: link.id,
    organizationId: link.organizationId,
    tenantId: link.tenantId,
    materialId: link.materialId,
    supplierCompanyId: link.supplierCompanyId,
    supplierSku: link.supplierSku ?? null,
    minOrderQty: link.minOrderQty ?? null,
    leadTimeDays: link.leadTimeDays ?? null,
    preferred: link.preferred,
    notes: link.notes ?? null,
    isActive: link.isActive,
    deletedAt: link.deletedAt ?? null,
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

async function ensureSupplierCompanyInScope(
  em: EntityManager,
  supplierCompanyId: string,
  organizationId: string,
  tenantId: string,
): Promise<void> {
  // Per .ai/lessons.md "Cross-module FK validation": always go through findOneWithDecryption
  // so encrypted-field tenant scoping rules are honored uniformly.
  const company = await findOneWithDecryption(
    em,
    CustomerCompanyProfile,
    { id: supplierCompanyId },
    undefined,
    { tenantId, organizationId },
  )
  if (!company) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(404, {
      error: translate(
        'materials.supplier_link.errors.supplier_not_found',
        'Supplier company not found in this organization',
      ),
    })
  }
}

async function clearOtherPreferred(em: EntityManager, materialId: string, exceptId: string | null) {
  const others = await em.find(MaterialSupplierLink, {
    materialId,
    preferred: true,
    deletedAt: null,
    ...(exceptId ? { id: { $ne: exceptId } } : {}),
  })
  for (const other of others) {
    other.preferred = false
  }
  if (others.length) await em.flush()
}

const SUPPLIER_LINK_TRACKED_COLUMNS: ReadonlyArray<keyof SupplierLinkSnapshot> = [
  'supplierCompanyId',
  'supplierSku',
  'minOrderQty',
  'leadTimeDays',
  'preferred',
  'notes',
  'isActive',
] as const

const createSupplierLinkCommand: CommandHandler<
  CreateMaterialSupplierLinkInput,
  { supplierLinkId: string }
> = {
  id: 'materials.supplier_link.create',
  async execute(rawInput, ctx) {
    const parsed = createMaterialSupplierLinkSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await ensureMaterialInScope(em, parsed.materialId, parsed.organizationId, parsed.tenantId)
    await ensureSupplierCompanyInScope(em, parsed.supplierCompanyId, parsed.organizationId, parsed.tenantId)

    const duplicate = await em.findOne(MaterialSupplierLink, {
      materialId: parsed.materialId,
      supplierCompanyId: parsed.supplierCompanyId,
      deletedAt: null,
    })
    if (duplicate) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(409, {
        error: translate(
          'materials.supplier_link.errors.duplicate',
          'This supplier is already linked to the material',
        ),
      })
    }

    const link = em.create(MaterialSupplierLink, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      materialId: parsed.materialId,
      supplierCompanyId: parsed.supplierCompanyId,
      supplierSku: parsed.supplierSku ?? null,
      minOrderQty: parsed.minOrderQty ?? null,
      leadTimeDays: parsed.leadTimeDays ?? null,
      preferred: !!parsed.preferred,
      notes: parsed.notes ?? null,
      isActive: parsed.isActive ?? true,
    })
    em.persist(link)
    await em.flush()

    if (link.preferred) {
      await clearOtherPreferred(em, link.materialId, link.id)
    }

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: link,
      identifiers: {
        id: link.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      },
      events: supplierLinkCrudEvents,
    })

    return { supplierLinkId: link.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadSupplierLinkSnapshot(em, result.supplierLinkId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadSupplierLinkSnapshot(em, result.supplierLinkId)
    return {
      actionLabel: translate('materials.audit.supplier_link.create', 'Link supplier to material'),
      resourceKind: 'materials.supplier_link',
      resourceId: result.supplierLinkId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies SupplierLinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const linkId = logEntry?.resourceId ?? null
    if (!linkId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await em.findOne(MaterialSupplierLink, { id: linkId })
    if (link) {
      em.remove(link)
      await em.flush()
    }
  },
}

const updateSupplierLinkCommand: CommandHandler<
  UpdateMaterialSupplierLinkInput,
  { supplierLinkId: string }
> = {
  id: 'materials.supplier_link.update',
  async prepare(rawInput, ctx) {
    const parsed = updateMaterialSupplierLinkSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadSupplierLinkSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = updateMaterialSupplierLinkSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await em.findOne(MaterialSupplierLink, { id: parsed.id })
    if (!link) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, {
        error: translate('materials.supplier_link.errors.not_found', 'Supplier link not found'),
      })
    }
    ensureTenantScope(ctx, link.tenantId)
    ensureOrganizationScope(ctx, link.organizationId)

    if (parsed.supplierSku !== undefined) link.supplierSku = parsed.supplierSku ?? null
    if (parsed.minOrderQty !== undefined) link.minOrderQty = parsed.minOrderQty ?? null
    if (parsed.leadTimeDays !== undefined) link.leadTimeDays = parsed.leadTimeDays ?? null
    if (parsed.preferred !== undefined) link.preferred = parsed.preferred
    if (parsed.notes !== undefined) link.notes = parsed.notes ?? null
    if (parsed.isActive !== undefined) link.isActive = parsed.isActive

    await em.flush()

    if (link.preferred) {
      await clearOtherPreferred(em, link.materialId, link.id)
    }

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: link,
      identifiers: {
        id: link.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      },
      events: supplierLinkCrudEvents,
    })

    return { supplierLinkId: link.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SupplierLinkSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadSupplierLinkSnapshot(em, before.id)
    const changes = after
      ? buildChanges(
          before as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
          SUPPLIER_LINK_TRACKED_COLUMNS as unknown as string[],
        )
      : {}
    return {
      actionLabel: translate('materials.audit.supplier_link.update', 'Update material supplier link'),
      resourceKind: 'materials.supplier_link',
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
        } satisfies SupplierLinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<SupplierLinkUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let link = await em.findOne(MaterialSupplierLink, { id: before.id })
    if (!link) {
      link = em.create(MaterialSupplierLink, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        materialId: before.materialId,
        supplierCompanyId: before.supplierCompanyId,
        supplierSku: before.supplierSku,
        minOrderQty: before.minOrderQty,
        leadTimeDays: before.leadTimeDays,
        preferred: before.preferred,
        notes: before.notes,
        isActive: before.isActive,
      })
      em.persist(link)
    } else {
      link.supplierCompanyId = before.supplierCompanyId
      link.supplierSku = before.supplierSku
      link.minOrderQty = before.minOrderQty
      link.leadTimeDays = before.leadTimeDays
      link.preferred = before.preferred
      link.notes = before.notes
      link.isActive = before.isActive
      link.deletedAt = before.deletedAt
    }
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: link,
      identifiers: {
        id: link.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      },
      events: supplierLinkCrudEvents,
    })
  },
}

const deleteSupplierLinkCommand: CommandHandler<
  { body?: Record<string, unknown>; query?: Record<string, unknown>; id?: string },
  { supplierLinkId: string }
> = {
  id: 'materials.supplier_link.remove',
  async prepare(input, ctx) {
    const id = requireId(input, 'Supplier link id required')
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadSupplierLinkSnapshot(em, id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Supplier link id required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await em.findOne(MaterialSupplierLink, { id })
    if (!link) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(404, {
        error: translate('materials.supplier_link.errors.not_found', 'Supplier link not found'),
      })
    }
    ensureTenantScope(ctx, link.tenantId)
    ensureOrganizationScope(ctx, link.organizationId)

    link.deletedAt = new Date()
    link.isActive = false
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: link,
      identifiers: {
        id: link.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      },
      events: supplierLinkCrudEvents,
    })

    return { supplierLinkId: link.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as SupplierLinkSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('materials.audit.supplier_link.remove', 'Remove material supplier link'),
      resourceKind: 'materials.supplier_link',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies SupplierLinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<SupplierLinkUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await em.findOne(MaterialSupplierLink, { id: before.id })
    if (!link) return
    link.deletedAt = before.deletedAt
    link.isActive = before.isActive
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: link,
      identifiers: {
        id: link.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      },
      events: supplierLinkCrudEvents,
    })
  },
}

registerCommand(createSupplierLinkCommand)
registerCommand(updateSupplierLinkCommand)
registerCommand(deleteSupplierLinkCommand)
