import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { buildChanges, requireId, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { loadCustomFieldSnapshot, buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CatalogProductCategory } from '../data/entities'
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  type CategoryCreateInput,
  type CategoryUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { rebuildCategoryHierarchyForOrganization } from '../lib/categoryHierarchy'
import { E } from '#generated/entities.ids.generated'

type CategorySnapshot = {
  id: string
  organizationId: string
  tenantId: string
  name: string
  slug: string | null
  description: string | null
  parentId: string | null
  rootId: string | null
  treePath: string | null
  depth: number
  ancestorIds: string[]
  childIds: string[]
  descendantIds: string[]
  isActive: boolean
  createdAt: string
  updatedAt: string
  custom?: Record<string, unknown> | null
}

type CategoryUndoPayload = {
  before?: CategorySnapshot | null
  after?: CategorySnapshot | null
}

const CATEGORY_CHANGE_KEYS = [
  'name',
  'slug',
  'description',
  'parentId',
  'rootId',
  'treePath',
  'isActive',
] as const satisfies readonly string[]

async function loadCategorySnapshot(em: EntityManager, id: string): Promise<CategorySnapshot | null> {
  const record = await em.findOne(CatalogProductCategory, { id })
  if (!record) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.catalog.catalog_product_category,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    name: record.name,
    slug: record.slug ?? null,
    description: record.description ?? null,
    parentId: record.parentId ?? null,
    rootId: record.rootId ?? null,
    treePath: record.treePath ?? null,
    depth: record.depth ?? 0,
    ancestorIds: Array.isArray(record.ancestorIds) ? [...record.ancestorIds] : [],
    childIds: Array.isArray(record.childIds) ? [...record.childIds] : [],
    descendantIds: Array.isArray(record.descendantIds) ? [...record.descendantIds] : [],
    isActive: !!record.isActive,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    custom: custom && Object.keys(custom).length ? custom : null,
  }
}

async function assertParentScope(
  em: EntityManager,
  parentId: string | null,
  organizationId: string,
  tenantId: string
): Promise<string | null> {
  if (!parentId) return null
  const parent = await em.findOne(CatalogProductCategory, {
    id: parentId,
    organizationId,
    tenantId,
    deletedAt: null,
  })
  if (!parent) {
    throw new CrudHttpError(400, { error: 'Parent category not found or inaccessible.' })
  }
  if (parent.id === parentId) return parent.id
  return String(parent.id)
}

function normalizeSlug(slug?: string | null): string | null {
  if (typeof slug !== 'string') return null
  const trimmed = slug.trim().toLowerCase()
  return trimmed.length ? trimmed : null
}

const createCategoryCommand: CommandHandler<CategoryCreateInput, { categoryId: string }> = {
  id: 'catalog.categories.create',
  async execute(input, ctx) {
    const { parsed, custom } = parseWithCustomFields(categoryCreateSchema, input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const slug = normalizeSlug(parsed.slug ?? null)
    if (slug) {
      const conflict = await em.findOne(CatalogProductCategory, {
        slug,
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
        deletedAt: null,
      })
      if (conflict) {
        throw new CrudHttpError(400, { error: 'Category slug already exists for this organization.' })
      }
    }
    const parentId = parsed.parentId ? String(parsed.parentId) : null
    const resolvedParent = await assertParentScope(em, parentId, parsed.organizationId, parsed.tenantId)

    const now = new Date()
    const record = em.create(CatalogProductCategory, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      name: parsed.name,
      slug,
      description: parsed.description?.trim()?.length ? parsed.description.trim() : null,
      parentId: resolvedParent,
      depth: 0,
      ancestorIds: [],
      childIds: [],
      descendantIds: [],
      isActive: parsed.isActive !== false,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    await rebuildCategoryHierarchyForOrganization(em, record.organizationId, record.tenantId)
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.catalog.catalog_product_category,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    return { categoryId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadCategorySnapshot(em, result.categoryId)
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadCategorySnapshot(em, result.categoryId)
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.categories.create', 'Create catalog category'),
      resourceKind: 'catalog.category',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies CategoryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CategoryUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProductCategory, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    record.isActive = false
    await em.flush()
    await rebuildCategoryHierarchyForOrganization(em, record.organizationId, record.tenantId)
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_category,
        recordId: after.id,
        organizationId: after.organizationId,
        tenantId: after.tenantId,
        values: resetValues,
      })
    }
  },
}

const updateCategoryCommand: CommandHandler<CategoryUpdateInput, { categoryId: string }> = {
  id: 'catalog.categories.update',
  async prepare(input, ctx) {
    const id = requireId(input, 'Category id is required')
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadCategorySnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const { parsed, custom } = parseWithCustomFields(categoryUpdateSchema, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProductCategory, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog category not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.name !== undefined) {
      record.name = parsed.name
    }

    if (parsed.slug !== undefined) {
      const slug = normalizeSlug(parsed.slug ?? null)
      if (slug !== record.slug) {
        if (slug) {
          const conflict = await em.findOne(CatalogProductCategory, {
            slug,
            organizationId: record.organizationId,
            tenantId: record.tenantId,
            deletedAt: null,
            id: { $ne: record.id },
          })
          if (conflict) {
            throw new CrudHttpError(400, { error: 'Category slug already exists.' })
          }
        }
        record.slug = slug
      }
    }

    if (parsed.description !== undefined) {
      record.description = parsed.description?.trim()?.length ? parsed.description.trim() : null
    }

    if (parsed.parentId !== undefined) {
      const requestedParent = parsed.parentId ? String(parsed.parentId) : null
      const safeParent = requestedParent && requestedParent !== record.id ? requestedParent : null
      record.parentId = await assertParentScope(em, safeParent, record.organizationId, record.tenantId)
    }

    if (parsed.isActive !== undefined) {
      record.isActive = parsed.isActive
    }

    await em.flush()
    await rebuildCategoryHierarchyForOrganization(em, record.organizationId, record.tenantId)
    await setCustomFieldsIfAny({
      dataEngine: ctx.container.resolve('dataEngine'),
      entityId: E.catalog.catalog_product_category,
      recordId: record.id,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      values: custom,
    })
    return { categoryId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return loadCategorySnapshot(em, result.categoryId)
  },
  buildLog: async ({ result, ctx, snapshots }) => {
    const before = snapshots.before as CategorySnapshot | undefined
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const after = await loadCategorySnapshot(em, result.categoryId)
    if (!before || !after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.categories.update', 'Update catalog category'),
      resourceKind: 'catalog.category',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes: buildChanges(before as Record<string, unknown>, after as Record<string, unknown>, CATEGORY_CHANGE_KEYS),
      payload: {
        undo: { before, after } satisfies CategoryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CategoryUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogProductCategory, { id: before.id })
    if (!record) {
      record = em.create(CatalogProductCategory, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        name: before.name,
        slug: before.slug,
        description: before.description,
        parentId: before.parentId,
        rootId: before.rootId,
        treePath: before.treePath,
        depth: before.depth,
        ancestorIds: before.ancestorIds,
        childIds: before.childIds,
        descendantIds: before.descendantIds,
        isActive: before.isActive,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      record.name = before.name
      record.slug = before.slug
      record.description = before.description
      record.parentId = before.parentId
      record.rootId = before.rootId
      record.treePath = before.treePath
      record.depth = before.depth
      record.ancestorIds = before.ancestorIds
      record.childIds = before.childIds
      record.descendantIds = before.descendantIds
      record.isActive = before.isActive
      record.deletedAt = null
    }
    await em.flush()
    await rebuildCategoryHierarchyForOrganization(em, before.organizationId, before.tenantId)
    const resetValues = buildCustomFieldResetMap(payload?.after?.custom ?? undefined, before.custom ?? undefined)
    if (Object.keys(resetValues).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_category,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: resetValues,
      })
    }
  },
}

const deleteCategoryCommand: CommandHandler<{ id?: string }, { categoryId: string }> = {
  id: 'catalog.categories.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Category id is required')
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadCategorySnapshot(em, id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Category id is required')
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(CatalogProductCategory, { id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Catalog category not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const baseEm = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadCategorySnapshot(baseEm, id)

    record.deletedAt = new Date()
    record.isActive = false
    await em.flush()
    await rebuildCategoryHierarchyForOrganization(em, record.organizationId, record.tenantId)
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      if (Object.keys(resetValues).length) {
        await setCustomFieldsIfAny({
          dataEngine: ctx.container.resolve('dataEngine'),
          entityId: E.catalog.catalog_product_category,
          recordId: snapshot.id,
          organizationId: snapshot.organizationId,
          tenantId: snapshot.tenantId,
          values: resetValues,
        })
      }
    }
    return { categoryId: record.id }
  },
  buildLog: async ({ ctx, snapshots }) => {
    const before = snapshots.before as CategorySnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('catalog.audit.categories.delete', 'Delete catalog category'),
      resourceKind: 'catalog.category',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies CategoryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CategoryUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(CatalogProductCategory, { id: before.id })
    if (!record) {
      record = em.create(CatalogProductCategory, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        name: before.name,
        slug: before.slug,
        description: before.description,
        parentId: before.parentId,
        rootId: before.rootId,
        treePath: before.treePath,
        depth: before.depth,
        ancestorIds: before.ancestorIds,
        childIds: before.childIds,
        descendantIds: before.descendantIds,
        isActive: before.isActive,
        createdAt: new Date(before.createdAt),
        updatedAt: new Date(before.updatedAt),
      })
      em.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      record.deletedAt = null
      record.isActive = before.isActive
      record.name = before.name
      record.slug = before.slug
      record.description = before.description
      record.parentId = before.parentId
      record.rootId = before.rootId
      record.treePath = before.treePath
      record.depth = before.depth
      record.ancestorIds = before.ancestorIds
      record.childIds = before.childIds
      record.descendantIds = before.descendantIds
    }
    await em.flush()
    await rebuildCategoryHierarchyForOrganization(em, before.organizationId, before.tenantId)
    if (before.custom && Object.keys(before.custom).length) {
      await setCustomFieldsIfAny({
        dataEngine: ctx.container.resolve('dataEngine'),
        entityId: E.catalog.catalog_product_category,
        recordId: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        values: before.custom,
      })
    }
  },
}

registerCommand(createCategoryCommand)
registerCommand(updateCategoryCommand)
registerCommand(deleteCategoryCommand)
