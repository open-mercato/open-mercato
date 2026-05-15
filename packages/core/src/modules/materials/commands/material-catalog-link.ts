import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import {
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
} from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { Material, MaterialCatalogProductLink } from '../data/entities'
import {
  upsertMaterialCatalogLinkSchema,
  type UpsertMaterialCatalogLinkInput,
} from '../data/validators'

/**
 * MaterialCatalogProductLink commands (Phase 1 Step 13).
 *
 * One-to-one bridge between materials and catalog products. Re-linking semantics:
 * - upsert finds the existing live row by materialId (1:1) and either updates
 *   catalog_product_id or creates a new row.
 * - The DB partial unique indexes on (material_id) and (catalog_product_id) prevent
 *   any double-binding; the command surfaces translated 409s before letting the
 *   constraint throw.
 *
 * Cross-org validators run on both ends — material AND catalog_product must live in
 * the same org/tenant as the request. Per .ai/lessons.md "Cross-module FK validation"
 * we go through findOneWithDecryption (catalog_product is encryption-aware).
 */

const linkCrudEvents: CrudEventsConfig = {
  module: 'materials',
  entity: 'catalog_link',
  persistent: true,
  buildPayload: (ctx) => {
    const entity = ctx.entity as MaterialCatalogProductLink | undefined
    return {
      id: ctx.identifiers.id,
      organizationId: ctx.identifiers.organizationId,
      tenantId: ctx.identifiers.tenantId,
      materialId: entity?.materialId ?? null,
      catalogProductId: entity?.catalogProductId ?? null,
    }
  },
}

type LinkSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  materialId: string
  catalogProductId: string
  isActive: boolean
  deletedAt: Date | null
}

type LinkUndoPayload = {
  before?: LinkSnapshot | null
  after?: LinkSnapshot | null
}

async function loadLinkSnapshot(em: EntityManager, id: string): Promise<LinkSnapshot | null> {
  const link = await em.findOne(MaterialCatalogProductLink, { id })
  if (!link) return null
  return {
    id: link.id,
    organizationId: link.organizationId,
    tenantId: link.tenantId,
    materialId: link.materialId,
    catalogProductId: link.catalogProductId,
    isActive: link.isActive,
    deletedAt: link.deletedAt ?? null,
  }
}

async function ensureMaterialInScope(
  em: EntityManager,
  materialId: string,
  organizationId: string,
  tenantId: string,
): Promise<void> {
  const material = await em.findOne(Material, { id: materialId, deletedAt: null })
  const { translate } = await resolveTranslations()
  if (!material || material.organizationId !== organizationId || material.tenantId !== tenantId) {
    throw new CrudHttpError(404, {
      error: translate('materials.material.errors.not_found', 'Material not found'),
    })
  }
}

async function ensureCatalogProductInScope(
  em: EntityManager,
  catalogProductId: string,
  organizationId: string,
  tenantId: string,
): Promise<void> {
  const product = await findOneWithDecryption(
    em,
    CatalogProduct,
    { id: catalogProductId },
    undefined,
    { tenantId, organizationId },
  )
  if (!product) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(404, {
      error: translate(
        'materials.catalog_link.errors.product_not_found',
        'Catalog product not found in this organization',
      ),
    })
  }
}

const upsertLinkCommand: CommandHandler<UpsertMaterialCatalogLinkInput, { linkId: string; wasCreate: boolean }> = {
  id: 'materials.catalog_link.upsert',
  async prepare(rawInput, ctx) {
    if (!rawInput?.materialId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const link = await em.findOne(MaterialCatalogProductLink, {
      materialId: rawInput.materialId,
      deletedAt: null,
    })
    if (!link) return {}
    return { before: await loadLinkSnapshot(em, link.id) ?? undefined }
  },
  async execute(rawInput, ctx) {
    const parsed = upsertMaterialCatalogLinkSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await ensureMaterialInScope(em, parsed.materialId, parsed.organizationId, parsed.tenantId)
    await ensureCatalogProductInScope(em, parsed.catalogProductId, parsed.organizationId, parsed.tenantId)

    // 1:1 — there can be at most one live link per material AND at most one per catalog product.
    const existingForMaterial = await em.findOne(MaterialCatalogProductLink, {
      materialId: parsed.materialId,
      deletedAt: null,
    })
    const existingForProduct = await em.findOne(MaterialCatalogProductLink, {
      catalogProductId: parsed.catalogProductId,
      deletedAt: null,
    })
    if (existingForProduct && existingForProduct.materialId !== parsed.materialId) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(409, {
        error: translate(
          'materials.catalog_link.errors.product_already_linked',
          'This catalog product is already linked to a different material',
        ),
      })
    }

    let link: MaterialCatalogProductLink
    let wasCreate = false
    if (existingForMaterial) {
      // Update the existing link's product (re-link semantics).
      link = existingForMaterial
      link.catalogProductId = parsed.catalogProductId
      if (parsed.isActive !== undefined) link.isActive = parsed.isActive
    } else {
      link = em.create(MaterialCatalogProductLink, {
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        materialId: parsed.materialId,
        catalogProductId: parsed.catalogProductId,
        isActive: parsed.isActive ?? true,
      })
      em.persist(link)
      wasCreate = true
    }
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: wasCreate ? 'created' : 'updated',
      entity: link,
      identifiers: {
        id: link.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      },
      events: linkCrudEvents,
    })

    return { linkId: link.id, wasCreate }
  },
  buildLog: async ({ snapshots, result, ctx }) => {
    const before = snapshots.before as LinkSnapshot | undefined
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadLinkSnapshot(em, result.linkId)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: result.wasCreate
        ? translate('materials.audit.catalog_link.create', 'Link material to catalog product')
        : translate('materials.audit.catalog_link.update', 'Re-link material to a different catalog product'),
      resourceKind: 'materials.catalog_link',
      resourceId: result.linkId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after,
        } satisfies LinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LinkUndoPayload>(logEntry)
    if (!payload) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    if (!payload.before && payload.after) {
      // Undo create — hard delete the row that didn't exist before.
      const link = await em.findOne(MaterialCatalogProductLink, { id: payload.after.id })
      if (link) {
        em.remove(link)
        await em.flush()
      }
      return
    }
    if (payload.before) {
      const link = await em.findOne(MaterialCatalogProductLink, { id: payload.before.id })
      if (link) {
        link.materialId = payload.before.materialId
        link.catalogProductId = payload.before.catalogProductId
        link.isActive = payload.before.isActive
        link.deletedAt = payload.before.deletedAt
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
          events: linkCrudEvents,
        })
      }
    }
  },
}

const removeLinkCommand: CommandHandler<
  { materialId: string; organizationId: string; tenantId: string },
  { linkId: string | null }
> = {
  id: 'materials.catalog_link.remove',
  async prepare(input, ctx) {
    if (!input?.materialId) return {}
    const em = ctx.container.resolve('em') as EntityManager
    const link = await em.findOne(MaterialCatalogProductLink, {
      materialId: input.materialId,
      deletedAt: null,
    })
    if (!link) return {}
    return { before: await loadLinkSnapshot(em, link.id) ?? undefined }
  },
  async execute(input, ctx) {
    if (!input.materialId) throw new CrudHttpError(400, { error: 'materialId is required' })
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await em.findOne(MaterialCatalogProductLink, {
      materialId: input.materialId,
      deletedAt: null,
    })
    if (!link) {
      // Idempotent: removing an already-absent link is a 204-style no-op.
      return { linkId: null }
    }
    if (link.organizationId !== input.organizationId || link.tenantId !== input.tenantId) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(403, {
        error: translate('materials.errors.cross_org_forbidden', 'Link belongs to a different organization'),
      })
    }
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
      events: linkCrudEvents,
    })

    return { linkId: link.id }
  },
  buildLog: async ({ snapshots, result }) => {
    const before = snapshots.before as LinkSnapshot | undefined
    if (!before || !result.linkId) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('materials.audit.catalog_link.remove', 'Unlink material from catalog product'),
      resourceKind: 'materials.catalog_link',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies LinkUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LinkUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const link = await em.findOne(MaterialCatalogProductLink, { id: before.id })
    if (!link) return
    link.deletedAt = before.deletedAt
    link.isActive = before.isActive
    await em.flush()
  },
}

registerCommand(upsertLinkCommand)
registerCommand(removeLinkCommand)
