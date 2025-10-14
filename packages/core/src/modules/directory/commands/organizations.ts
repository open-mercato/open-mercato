import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { organizationCreateSchema, organizationUpdateSchema } from '@open-mercato/core/modules/directory/data/validators'
import { rebuildHierarchyForTenant } from '@open-mercato/core/modules/directory/lib/hierarchy'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  requireTenantScope,
  requireId,
  buildChanges,
} from '@open-mercato/shared/lib/commands/helpers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const organizationCrudEvents: CrudEventsConfig<Organization> = {
  module: 'directory',
  entity: 'organization',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<Organization>) => ({
    id: ctx.identifiers.id,
    tenantId: tenantIdFromContext(ctx),
    organizationId: ctx.identifiers.id,
  }),
}

export const organizationCrudIndexer: CrudIndexerConfig<Organization> = {
  entityType: E.directory.organization,
  buildUpsertPayload: (ctx: CrudEmitContext<Organization>) => ({
    entityType: E.directory.organization,
    recordId: ctx.identifiers.id,
    organizationId: ctx.identifiers.id,
    tenantId: tenantIdFromContext(ctx),
  }),
  buildDeletePayload: (ctx: CrudEmitContext<Organization>) => ({
    entityType: E.directory.organization,
    recordId: ctx.identifiers.id,
    organizationId: ctx.identifiers.id,
    tenantId: tenantIdFromContext(ctx),
  }),
}

type OrganizationTenantShape = {
  __tenantId?: unknown
  tenant?: string | { id?: unknown; getEntity?: () => { id?: unknown } }
  tenantId?: unknown
  tenant_id?: unknown
}

type SerializedOrganization = ReturnType<typeof serializeOrganization>

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

function serializeOrganization(entity: Organization) {
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
  }
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
    const em = ctx.container.resolve<EntityManager>('em')
    const authTenantId = ctx.auth?.tenantId ?? null
    const tenantId = requireTenantScope(authTenantId, parsed.tenantId ?? null)

    const parentId = parsed.parentId ?? null
    if (parentId) {
      await ensureParentExists(em, tenantId, parentId)
    }

    const childIds = normalizeChildIds(parsed.childIds ?? [], parentId ? [parentId] : [])
    if (parentId && childIds.includes(parentId)) throw new CrudHttpError(400, { error: 'Child cannot equal parent' })
    await ensureChildrenValid(em, tenantId, childIds)

    const tenantRef = em.getReference(Tenant, tenantId)
    const de = ctx.container.resolve<DataEngine>('dataEngine')
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
  captureAfter: (_input, result) => serializeOrganization(result),
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('directory.audit.organizations.create', 'Create organization'),
      resourceKind: 'directory.organization',
      resourceId: String(result.id),
      tenantId: ctx.auth?.tenantId ?? resolveTenantIdFromEntity(result),
    }
  },
}

const updateOrganizationCommand: CommandHandler<Record<string, unknown>, Organization> = {
  id: 'directory.organizations.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(organizationUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')
    const current = await em.findOne(Organization, { id: parsed.id, deletedAt: null })
    if (!current) throw new CrudHttpError(404, { error: 'Not found' })
    return { before: serializeOrganization(current) }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(organizationUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')
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

    const de = ctx.container.resolve<DataEngine>('dataEngine')
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
  captureAfter: (_input, result) => serializeOrganization(result),
  buildLog: async ({ snapshots, result, ctx }) => {
    const { translate } = await resolveTranslations()
    const beforeRecord = (snapshots.before ?? null) as Record<string, unknown> | null
    const after = serializeOrganization(result)
    const changes = buildChanges(beforeRecord, after as Record<string, unknown>, ['name', 'isActive', 'parentId'])
    return {
      actionLabel: translate('directory.audit.organizations.update', 'Update organization'),
      resourceKind: 'directory.organization',
      resourceId: String(result.id),
      changes,
      tenantId: ctx.auth?.tenantId ?? after.tenantId,
    }
  },
}

const deleteOrganizationCommand: CommandHandler<{ body: any; query: Record<string, string> }, Organization> = {
  id: 'directory.organizations.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Organization id required')
    const em = ctx.container.resolve<EntityManager>('em')
    const existing = await em.findOne(Organization, { id, deletedAt: null })
    return existing ? { before: serializeOrganization(existing) } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Organization id required')
    const em = ctx.container.resolve<EntityManager>('em')
    const existing = await em.findOne(Organization, { id, deletedAt: null })
    if (!existing) throw new CrudHttpError(404, { error: 'Not found' })

    const authTenantId = ctx.auth?.tenantId ?? null
    const tenantId = requireTenantScope(authTenantId, resolveTenantIdFromEntity(existing))

    const parentId = existing.parentId ?? null

    const de = ctx.container.resolve<DataEngine>('dataEngine')
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
    const beforeSnapshot = (snapshots.before ?? null) as SerializedOrganization | null
    const id = String(input?.body?.id ?? input?.query?.id ?? '')
    const fallbackId = beforeSnapshot?.id ?? null
    const fallbackTenant = beforeSnapshot?.tenantId ?? null
    return {
      actionLabel: translate('directory.audit.organizations.delete', 'Delete organization'),
      resourceKind: 'directory.organization',
      resourceId: id || fallbackId || null,
      snapshotBefore: beforeSnapshot ?? null,
      tenantId: ctx.auth?.tenantId ?? fallbackTenant,
    }
  },
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
