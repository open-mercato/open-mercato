import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { organizationCreateSchema, organizationUpdateSchema } from '@open-mercato/core/modules/directory/data/validators'
import { rebuildHierarchyForTenant } from '@open-mercato/core/modules/directory/lib/hierarchy'
import { E } from '#generated/entities.ids.generated'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
  diffCustomFieldChanges,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireTenantScope,
  requireId,
  buildChanges,
} from '@open-mercato/shared/lib/commands/helpers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const organizationCrudEvents: CrudEventsConfig = {
  module: 'directory',
  entity: 'organization',
  persistent: true,
  buildPayload: (ctx) => {
    const orgCtx = ctx as CrudEmitContext<Organization>
    return {
      id: orgCtx.identifiers.id,
      tenantId: tenantIdFromContext(orgCtx),
      organizationId: orgCtx.identifiers.id,
    }
  },
}

export const organizationCrudIndexer: CrudIndexerConfig = {
  entityType: E.directory.organization,
  buildUpsertPayload: (ctx) => {
    const orgCtx = ctx as CrudEmitContext<Organization>
    return {
      entityType: E.directory.organization,
      recordId: orgCtx.identifiers.id,
      organizationId: orgCtx.identifiers.id,
      tenantId: tenantIdFromContext(orgCtx),
    }
  },
  buildDeletePayload: (ctx) => {
    const orgCtx = ctx as CrudEmitContext<Organization>
    return {
      entityType: E.directory.organization,
      recordId: orgCtx.identifiers.id,
      organizationId: orgCtx.identifiers.id,
      tenantId: tenantIdFromContext(orgCtx),
    }
  },
}

type OrganizationTenantShape = {
  __tenantId?: unknown
  tenant?: string | { id?: unknown; getEntity?: () => { id?: unknown } }
  tenantId?: unknown
  tenant_id?: unknown
}

type SerializedOrganization = ReturnType<typeof serializeOrganization>

type ChildParentSnapshot = {
  childId: string
  parentId: string | null
}

type OrganizationUndoSnapshot = {
  id: string
  tenantId: string | null
  name: string
  isActive: boolean
  parentId: string | null
  childParents: ChildParentSnapshot[]
  custom?: Record<string, unknown>
}

type OrganizationSnapshots = {
  view: SerializedOrganization
  undo: OrganizationUndoSnapshot
}

export function resolveTenantIdFromEntity(entity: Organization): string | null {
  const shape = entity as unknown as OrganizationTenantShape
  const cached = toOptionalString(shape.__tenantId)
  if (cached) return cached
  const tenantRef = shape.tenant
  if (typeof tenantRef === 'string') return tenantRef
  if (tenantRef && typeof tenantRef === 'object') {
    const direct = toOptionalString(tenantRef.id)
    if (direct) return direct
    if (typeof tenantRef.getEntity === 'function') {
      const nested = tenantRef.getEntity()
      const nestedId = nested ? toOptionalString(nested.id) : null
      if (nestedId) return nestedId
    }
  }
  const fallback = toOptionalString(shape.tenantId) || toOptionalString(shape.tenant_id)
  return fallback
}

function serializeOrganization(entity: Organization, custom?: Record<string, unknown> | null) {
  return {
    id: String(entity.id),
    tenantId: resolveTenantIdFromEntity(entity),
    name: entity.name,
    isActive: !!entity.isActive,
    parentId: entity.parentId ?? null,
    ancestorIds: Array.isArray(entity.ancestorIds) ? [...entity.ancestorIds] : [],
    childIds: Array.isArray(entity.childIds) ? [...entity.childIds] : [],
    descendantIds: Array.isArray(entity.descendantIds) ? [...entity.descendantIds] : [],
    createdAt: entity.createdAt ? entity.createdAt.toISOString() : null,
    updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : null,
    ...(custom && Object.keys(custom).length ? { custom } : {}),
  }
}

function captureOrganizationSnapshots(
  entity: Organization,
  childParents: ChildParentSnapshot[],
  custom?: Record<string, unknown> | null
): OrganizationSnapshots {
  const tenantId = resolveTenantIdFromEntity(entity)
  return {
    view: serializeOrganization(entity, custom),
    undo: {
      id: String(entity.id),
      tenantId,
      name: entity.name,
      isActive: !!entity.isActive,
      parentId: entity.parentId ?? null,
      childParents: (childParents ?? []).map((entry) => ({
        childId: String(entry.childId),
        parentId: entry.parentId,
      })),
      ...(custom && Object.keys(custom).length ? { custom } : {}),
    },
  }
}

async function loadChildParentSnapshots(
  em: EntityManager,
  tenantId: string | null,
  childIds: Iterable<string>
): Promise<ChildParentSnapshot[]> {
  if (!tenantId) return []
  const ids = Array.from(new Set(Array.from(childIds ?? []).map((id) => String(id)).filter(Boolean)))
  if (!ids.length) return []
  const filter: FilterQuery<Organization> = {
    tenant: tenantId,
    deletedAt: null,
    id: { $in: ids },
  } as unknown as FilterQuery<Organization>
  const children = await em.find(Organization, filter)
  if (!children.length) return []
  const map = new Map(children.map((child) => [String(child.id), child.parentId ? String(child.parentId) : null]))
  return ids
    .filter((id) => map.has(id))
    .map((id) => ({
      childId: id,
      parentId: map.get(id) ?? null,
    }))
}

async function restoreChildParents(em: EntityManager, tenantId: string, snapshots: ChildParentSnapshot[]) {
  if (!snapshots?.length) return
  const ids = Array.from(new Set(snapshots.map((entry) => entry.childId).filter(Boolean)))
  if (!ids.length) return
  const filter: FilterQuery<Organization> = {
    tenant: tenantId,
    deletedAt: null,
    id: { $in: ids },
  } as unknown as FilterQuery<Organization>
  const children = await em.find(Organization, filter)
  if (!children.length) return
  const desired = new Map(snapshots.map((entry) => [entry.childId, entry.parentId ?? null]))
  const toPersist: Organization[] = []
  for (const child of children) {
    const id = String(child.id)
    if (!desired.has(id)) continue
    const nextParent = desired.get(id) ?? null
    if (child.parentId !== nextParent) {
      child.parentId = nextParent
      toPersist.push(child)
    }
  }
  if (toPersist.length) await em.persistAndFlush(toPersist)
}

function normalizeChildIds(ids: readonly string[], exclude: string[]): string[] {
  const excludeSet = new Set(exclude)
  return Array.from(new Set(ids)).filter((id) => !excludeSet.has(id))
}

async function ensureParentExists(em: EntityManager, tenantId: string, parentId: string | null): Promise<void> {
  if (!parentId) return
  const parentFilter: FilterQuery<Organization> = { id: parentId, tenant: tenantId, deletedAt: null }
  const parent = await em.findOne(Organization, parentFilter)
  if (!parent) throw new CrudHttpError(400, { error: 'Parent not found' })
}

async function ensureChildrenValid(em: EntityManager, tenantId: string, childIds: string[]): Promise<void> {
  if (!childIds.length) return
  const childFilter: FilterQuery<Organization> = { id: { $in: childIds }, tenant: tenantId, deletedAt: null }
  const children = await em.find(Organization, childFilter)
  if (children.length !== childIds.length) throw new CrudHttpError(400, { error: 'Invalid child assignment' })
}

async function assignChildren(
  em: EntityManager,
  tenantId: string,
  recordId: string,
  desiredChildIds: Iterable<string>
): Promise<void> {
  const targetIds = Array.from(new Set(desiredChildIds)).filter((id) => id !== recordId)
  if (!targetIds.length) return
  const filter: FilterQuery<Organization> = { tenant: tenantId, deletedAt: null, id: { $in: targetIds } }
  const children = await em.find(Organization, filter)
  const toPersist: Organization[] = []
  for (const child of children) {
    if (String(child.id) === recordId) continue
    if (child.parentId !== recordId) {
      child.parentId = recordId
      toPersist.push(child)
    }
  }
  if (toPersist.length) await em.persistAndFlush(toPersist)
}

async function clearRemovedChildren(em: EntityManager, tenantId: string, recordId: string, desiredChildIds: Set<string>): Promise<void> {
  const currentFilter: FilterQuery<Organization> = { tenant: tenantId, parentId: recordId, deletedAt: null }
  const current = await em.find(Organization, currentFilter)
  const toPersist = current.filter((child) => !desiredChildIds.has(String(child.id)))
  if (!toPersist.length) return
  for (const child of toPersist) child.parentId = null
  await em.persistAndFlush(toPersist)
}

const createOrganizationCommand: CommandHandler<Record<string, unknown>, Organization> = {
  id: 'directory.organizations.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(organizationCreateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const authTenantId = ctx.auth?.tenantId ?? null
    const tenantId = requireTenantScope(authTenantId, parsed.tenantId ?? null)

    const parentId = parsed.parentId ?? null
    if (parentId) {
      await ensureParentExists(em, tenantId, parentId)
    }

    const childIds = normalizeChildIds(parsed.childIds ?? [], parentId ? [parentId] : [])
    if (parentId && childIds.includes(parentId)) throw new CrudHttpError(400, { error: 'Child cannot equal parent' })
    await ensureChildrenValid(em, tenantId, childIds)
    const childParentsBefore = await loadChildParentSnapshots(em, tenantId, childIds)

    const tenantRef = em.getReference(Tenant, tenantId)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const organization = await de.createOrmEntity({
      entity: Organization,
      data: {
        tenant: tenantRef,
        name: parsed.name,
        isActive: parsed.isActive ?? true,
        parentId,
      },
    })
    setInternalTenantId(organization, tenantId)
    const recordId = String(organization.id)

    if (childIds.length) {
      await assignChildren(em, tenantId, recordId, childIds)
    }
    const childParentsAfter = await loadChildParentSnapshots(em, tenantId, childIds)
    setUndoMeta(organization, { childParentsBefore, childParentsAfter })

    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.directory.organization,
      recordId,
      tenantId,
      organizationId: recordId,
      values: custom,
    })

    await rebuildHierarchyForTenant(em, tenantId)

    const identifiers = { id: recordId, organizationId: recordId, tenantId }
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: organization,
      identifiers,
      events: organizationCrudEvents,
      indexer: organizationCrudIndexer,
    })

    return organization
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tenantId = resolveTenantIdFromEntity(result)
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.directory.organization,
      recordId: String(result.id),
      tenantId,
      organizationId: String(result.id),
    })
    return serializeOrganization(result, custom)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const meta = getUndoMeta(result)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tenantId = resolveTenantIdFromEntity(result)
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.directory.organization,
      recordId: String(result.id),
      tenantId,
      organizationId: String(result.id),
    })
    const afterSnapshots = captureOrganizationSnapshots(result, meta.childParentsAfter ?? [], custom)
    return {
      actionLabel: translate('directory.audit.organizations.create', 'Create organization'),
      resourceKind: 'directory.organization',
      resourceId: String(result.id),
      tenantId: ctx.auth?.tenantId ?? resolveTenantIdFromEntity(result),
      snapshotAfter: afterSnapshots.view,
      payload: {
        undo: {
          after: afterSnapshots.undo,
          childrenBefore: meta.childParentsBefore ?? [],
        },
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OrganizationUndoPayload>(logEntry)
    const after = payload?.after
    const childrenBefore = payload?.childrenBefore ?? []
    if (!after) return
    const tenantId = after.tenantId
    if (!tenantId) return
    const em = (ctx.container.resolve('em') as EntityManager)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await restoreChildParents(em, tenantId, childrenBefore)
    if (after.custom && Object.keys(after.custom).length) {
      const reset = buildCustomFieldResetMap(undefined, after.custom)
      if (Object.keys(reset).length) {
        const resetValues = reset as Parameters<DataEngine['setCustomFields']>[0]['values']
        await de.setCustomFields({
          entityId: E.directory.organization,
          recordId: after.id,
          tenantId,
          organizationId: after.id,
          values: resetValues,
          notify: false,
        })
      }
    }
    await de.deleteOrmEntity({
      entity: Organization,
      where: { id: after.id, deletedAt: null } as FilterQuery<Organization>,
      soft: false,
    })
    await rebuildHierarchyForTenant(em, tenantId)
  },
}

const updateOrganizationCommand: CommandHandler<Record<string, unknown>, Organization> = {
  id: 'directory.organizations.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(organizationUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const current = await em.findOne(Organization, { id: parsed.id, deletedAt: null })
    if (!current) throw new CrudHttpError(404, { error: 'Not found' })
    const tenantId = resolveTenantIdFromEntity(current)
    const currentChildIds = Array.isArray(current.childIds) ? current.childIds : []
    const requestedChildIds = Array.isArray(parsed.childIds) ? parsed.childIds : []
    const combinedChildIds = new Set<string>([...currentChildIds.map(String), ...requestedChildIds.map(String)])
    const childParentsBefore = tenantId
      ? await loadChildParentSnapshots(em, tenantId, combinedChildIds)
      : []
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.directory.organization,
      recordId: String(current.id),
      tenantId,
      organizationId: String(current.id),
    })
    return { before: captureOrganizationSnapshots(current, childParentsBefore, custom) }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(organizationUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const existing = await em.findOne(Organization, { id: parsed.id, deletedAt: null })
    if (!existing) throw new CrudHttpError(404, { error: 'Not found' })

    const authTenantId = ctx.auth?.tenantId ?? null
    const tenantId = requireTenantScope(authTenantId, parsed.tenantId ?? resolveTenantIdFromEntity(existing))

    const parentId = parsed.parentId ?? null
    if (parentId) {
      if (parentId === parsed.id) throw new CrudHttpError(400, { error: 'Organization cannot be its own parent' })
      if (Array.isArray(existing.descendantIds) && existing.descendantIds.includes(parentId)) {
        throw new CrudHttpError(400, { error: 'Cannot assign descendant as parent' })
      }
      await ensureParentExists(em, tenantId, parentId)
    }

    const normalizedChildIds = normalizeChildIds(parsed.childIds ?? [], [parsed.id, parentId ?? ''])
    if (normalizedChildIds.some((id) => id === parentId)) throw new CrudHttpError(400, { error: 'Child cannot equal parent' })
    if (Array.isArray(existing.ancestorIds) && normalizedChildIds.some((id) => existing.ancestorIds.includes(id))) {
      throw new CrudHttpError(400, { error: 'Cannot assign ancestor as child' })
    }

    if (normalizedChildIds.length) {
      await ensureChildrenValid(em, tenantId, normalizedChildIds)
      const childFilter = {
        tenant: tenantId,
        deletedAt: null,
        id: { $in: normalizedChildIds },
      } as unknown as FilterQuery<Organization>
      const children = await em.find(Organization, childFilter)
      for (const child of children) {
        if (Array.isArray(child.descendantIds) && child.descendantIds.includes(parsed.id)) {
          throw new CrudHttpError(400, { error: 'Cannot assign descendant cycle' })
        }
      }
    }

    const combinedChildIds = new Set<string>([
      ...normalizedChildIds.map(String),
      ...(Array.isArray(existing.childIds) ? existing.childIds.map(String) : []),
    ])
    const childParentsBefore = await loadChildParentSnapshots(em, tenantId, combinedChildIds)

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const organization = await de.updateOrmEntity({
      entity: Organization,
      where: { id: parsed.id, deletedAt: null } as FilterQuery<Organization>,
      apply: (entity) => {
        if (parsed.name !== undefined) entity.name = parsed.name
        if (parsed.isActive !== undefined) entity.isActive = parsed.isActive
        entity.parentId = parentId
      },
    })
    if (!organization) throw new CrudHttpError(404, { error: 'Not found' })
    setInternalTenantId(organization, tenantId)

    const recordId = String(organization.id)
    const desiredChildIds = new Set(normalizedChildIds.filter((id) => id !== recordId))
    await clearRemovedChildren(em, tenantId, recordId, desiredChildIds)
    await assignChildren(em, tenantId, recordId, desiredChildIds)
    const childParentsAfter = await loadChildParentSnapshots(em, tenantId, combinedChildIds)
    setUndoMeta(organization, { childParentsBefore, childParentsAfter })

    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.directory.organization,
      recordId,
      tenantId,
      organizationId: recordId,
      values: custom,
    })

    await rebuildHierarchyForTenant(em, tenantId)

    const identifiers = { id: recordId, organizationId: recordId, tenantId }
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: organization,
      identifiers,
      events: organizationCrudEvents,
      indexer: organizationCrudIndexer,
    })

    return organization
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tenantId = resolveTenantIdFromEntity(result)
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.directory.organization,
      recordId: String(result.id),
      tenantId,
      organizationId: String(result.id),
    })
    return serializeOrganization(result, custom)
  },
  buildLog: async ({ snapshots, result, ctx }) => {
    const { translate } = await resolveTranslations()
    const meta = getUndoMeta(result)
    const beforeSnapshots = snapshots.before as OrganizationSnapshots | undefined
    const beforeRecord = beforeSnapshots?.view ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tenantId = resolveTenantIdFromEntity(result)
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.directory.organization,
      recordId: String(result.id),
      tenantId,
      organizationId: String(result.id),
    })
    const after = serializeOrganization(result, custom)
    const changes = buildChanges(beforeRecord, after as Record<string, unknown>, ['name', 'isActive', 'parentId'])
    const customDiff = diffCustomFieldChanges(beforeRecord?.custom, custom)
    for (const [key, diff] of Object.entries(customDiff)) {
      changes[`cf_${key}`] = diff
    }
    return {
      actionLabel: translate('directory.audit.organizations.update', 'Update organization'),
      resourceKind: 'directory.organization',
      resourceId: String(result.id),
      changes,
      tenantId: ctx.auth?.tenantId ?? after.tenantId,
      payload: {
        undo: {
          before: beforeSnapshots?.undo ?? null,
          after: captureOrganizationSnapshots(result, meta.childParentsAfter ?? [], custom).undo,
        },
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OrganizationUndoPayload>(logEntry)
    const before = payload?.before
    const after = payload?.after
    if (!before) return
    const tenantId = before.tenantId
    if (!tenantId) return
    const em = (ctx.container.resolve('em') as EntityManager)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const updated = await de.updateOrmEntity({
      entity: Organization,
      where: { id: before.id } as FilterQuery<Organization>,
      apply: (entity) => {
        entity.name = before.name
        entity.isActive = before.isActive
        entity.parentId = before.parentId
      },
    })
    if (updated && tenantId) {
      setInternalTenantId(updated, tenantId)
    }
    const reset = buildCustomFieldResetMap(before.custom, after?.custom)
    if (Object.keys(reset).length) {
      const resetValues = reset as Parameters<DataEngine['setCustomFields']>[0]['values']
      await de.setCustomFields({
        entityId: E.directory.organization,
        recordId: before.id,
        tenantId,
        organizationId: before.id,
        values: resetValues,
        notify: false,
      })
    }
    const childSnapshots = before.childParents
    await restoreChildParents(em, tenantId, childSnapshots)
    await rebuildHierarchyForTenant(em, tenantId)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: {
        id: before.id,
        tenantId,
        organizationId: before.id,
      },
      events: organizationCrudEvents,
      indexer: organizationCrudIndexer,
    })
  },
}

const deleteOrganizationCommand: CommandHandler<{ body: any; query: Record<string, string> }, Organization> = {
  id: 'directory.organizations.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Organization id required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const existing = await em.findOne(Organization, { id, deletedAt: null })
    if (!existing) return {}
    const tenantId = resolveTenantIdFromEntity(existing)
    const childParentsBefore = tenantId
      ? await loadChildParentSnapshots(em, tenantId, Array.isArray(existing.childIds) ? existing.childIds : [])
      : []
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.directory.organization,
      recordId: String(existing.id),
      tenantId,
      organizationId: String(existing.id),
    })
    return { before: captureOrganizationSnapshots(existing, childParentsBefore, custom) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Organization id required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const existing = await em.findOne(Organization, { id, deletedAt: null })
    if (!existing) throw new CrudHttpError(404, { error: 'Not found' })

    const authTenantId = ctx.auth?.tenantId ?? null
    const tenantId = requireTenantScope(authTenantId, resolveTenantIdFromEntity(existing))

    const parentId = existing.parentId ?? null
    const childSnapshotsBefore = await loadChildParentSnapshots(
      em,
      tenantId,
      Array.isArray(existing.childIds) ? existing.childIds : [],
    )

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const deleted = await de.deleteOrmEntity({
      entity: Organization,
      where: { id, deletedAt: null } as FilterQuery<Organization>,
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!deleted) throw new CrudHttpError(404, { error: 'Not found' })
    setInternalTenantId(deleted, tenantId)
    deleted.isActive = false
    deleted.parentId = null

    const childrenFilter: FilterQuery<Organization> = { tenant: tenantId, parentId: id, deletedAt: null }
    const children = await em.find(Organization, childrenFilter)
    const toPersist: Organization[] = []
    for (const child of children) {
      child.parentId = parentId
      toPersist.push(child)
    }
    toPersist.push(deleted)
    if (toPersist.length) await em.persistAndFlush(toPersist)
    setUndoMeta(deleted, { childParentsBefore: childSnapshotsBefore })

    await rebuildHierarchyForTenant(em, tenantId)

    const identifiers = { id, organizationId: id, tenantId }
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: deleted,
      identifiers,
      events: organizationCrudEvents,
      indexer: organizationCrudIndexer,
    })

    return deleted
  },
  buildLog: async ({ snapshots, input, ctx }) => {
    const { translate } = await resolveTranslations()
    const beforeSnapshots = snapshots.before as OrganizationSnapshots | undefined
    const beforeSnapshot = beforeSnapshots?.view ?? null
    const beforeUndo = beforeSnapshots?.undo ?? null
    const id = String(input?.body?.id ?? input?.query?.id ?? '')
    const fallbackId = beforeSnapshot?.id ?? null
    const fallbackTenant = beforeSnapshot?.tenantId ?? null
    return {
      actionLabel: translate('directory.audit.organizations.delete', 'Delete organization'),
      resourceKind: 'directory.organization',
      resourceId: id || fallbackId || null,
      snapshotBefore: beforeSnapshot ?? null,
      tenantId: ctx.auth?.tenantId ?? fallbackTenant,
      payload: {
        undo: {
          before: beforeUndo,
        },
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<OrganizationUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const tenantId = before.tenantId
    if (!tenantId) return
    const em = (ctx.container.resolve('em') as EntityManager)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    let organization = await em.findOne(Organization, { id: before.id })
    if (organization) {
      organization.deletedAt = null
      organization.isActive = before.isActive
      organization.name = before.name
      organization.parentId = before.parentId
      await em.flush()
      if (tenantId) setInternalTenantId(organization, tenantId)
    } else {
      organization = await de.createOrmEntity({
        entity: Organization,
        data: {
          id: before.id,
          name: before.name,
          tenant: tenantId ? em.getReference(Tenant, tenantId) : undefined,
          isActive: before.isActive,
          parentId: before.parentId,
        },
      })
      if (tenantId) setInternalTenantId(organization, tenantId)
    }
    if (tenantId) {
      const customValues = buildCustomFieldResetMap(before.custom, undefined)
      if (Object.keys(customValues).length) {
        const resetValues = customValues as Parameters<DataEngine['setCustomFields']>[0]['values']
        await de.setCustomFields({
          entityId: E.directory.organization,
          recordId: before.id,
          tenantId,
          organizationId: before.id,
          values: resetValues,
          notify: false,
        })
      }
    }
    await restoreChildParents(em, tenantId, before.childParents)
    await rebuildHierarchyForTenant(em, tenantId)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: organization,
      identifiers: {
        id: before.id,
        tenantId,
        organizationId: before.id,
      },
      events: organizationCrudEvents,
      indexer: organizationCrudIndexer,
    })
  },
}

type OrganizationUndoPayload = {
  before?: OrganizationUndoSnapshot | null
  after?: OrganizationUndoSnapshot | null
  childrenBefore?: ChildParentSnapshot[] | null
}

type OrganizationUndoMeta = {
  childParentsBefore?: ChildParentSnapshot[]
  childParentsAfter?: ChildParentSnapshot[]
}

const UNDO_META_KEY: unique symbol = Symbol('directory.organization.undoMeta')

function getUndoMeta(entity: Organization): OrganizationUndoMeta {
  return (Reflect.get(entity, UNDO_META_KEY) as OrganizationUndoMeta | undefined) ?? {}
}

function setUndoMeta(entity: Organization, meta: Partial<OrganizationUndoMeta>) {
  const current = getUndoMeta(entity)
  Reflect.set(entity, UNDO_META_KEY, { ...current, ...meta })
}

registerCommand(createOrganizationCommand)
registerCommand(updateOrganizationCommand)
registerCommand(deleteOrganizationCommand)

function toOptionalString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return null
}

function setInternalTenantId(entity: Organization, tenantId: string) {
  Reflect.set(entity, '__tenantId', tenantId)
}

function tenantIdFromContext(ctx: CrudEmitContext<Organization>): string | null {
  return resolveTenantIdFromEntity(ctx.entity) ?? ctx.identifiers.tenantId ?? null
}
