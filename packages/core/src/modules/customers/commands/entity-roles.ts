import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { CrudEventsConfig } from '@open-mercato/shared/lib/crud/types'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity, CustomerEntityRole } from '../data/entities'
import {
  entityRoleCreateSchema,
  entityRoleUpdateSchema,
  entityRoleDeleteSchema,
  type EntityRoleCreateInput,
  type EntityRoleUpdateInput,
  type EntityRoleDeleteInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureSameScope,
  ensureTenantScope,
  extractUndoPayload,
  requireCustomerEntity,
  resolveParentResourceKind,
} from './shared'

type EntityRoleSnapshot = {
  role: {
    id: string
    entityType: 'company' | 'person'
    entityId: string
    userId: string
    roleType: string
    organizationId: string
    tenantId: string
  }
  entityKind: 'company' | 'person' | null
}

type EntityRoleUndoPayload = {
  before?: EntityRoleSnapshot | null
  after?: EntityRoleSnapshot | null
}

const entityRoleCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'entity_role',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
    entityId:
      ctx.entity && typeof ctx.entity === 'object' && 'entityId' in (ctx.entity as Record<string, unknown>)
        ? (ctx.entity as CustomerEntityRole).entityId
        : null,
    entityType:
      ctx.entity && typeof ctx.entity === 'object' && 'entityType' in (ctx.entity as Record<string, unknown>)
        ? (ctx.entity as CustomerEntityRole).entityType
        : null,
    roleType:
      ctx.entity && typeof ctx.entity === 'object' && 'roleType' in (ctx.entity as Record<string, unknown>)
        ? (ctx.entity as CustomerEntityRole).roleType
        : null,
    userId:
      ctx.entity && typeof ctx.entity === 'object' && 'userId' in (ctx.entity as Record<string, unknown>)
        ? (ctx.entity as CustomerEntityRole).userId
        : null,
    ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
  }),
}

function getRoleIdentifiers(role: CustomerEntityRole) {
  return {
    id: role.id,
    organizationId: role.organizationId,
    tenantId: role.tenantId,
  }
}

async function loadEntityRoleSnapshot(em: EntityManager, id: string): Promise<EntityRoleSnapshot | null> {
  const role = await findOneWithDecryption(
    em,
    CustomerEntityRole,
    { id },
    undefined,
    { tenantId: null, organizationId: null },
  )
  if (!role) return null

  const entity = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: role.entityId, deletedAt: null },
    undefined,
    { tenantId: role.tenantId, organizationId: role.organizationId },
  )

  return {
    role: {
      id: role.id,
      entityType: role.entityType as 'company' | 'person',
      entityId: role.entityId,
      userId: role.userId,
      roleType: role.roleType,
      organizationId: role.organizationId,
      tenantId: role.tenantId,
    },
    entityKind: entity?.kind === 'company' || entity?.kind === 'person' ? entity.kind : null,
  }
}

const createEntityRoleCommand: CommandHandler<EntityRoleCreateInput, { roleId: string }> = {
  id: 'customers.entityRoles.create',
  async execute(rawInput, ctx) {
    const parsed = entityRoleCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await requireCustomerEntity(em, parsed.entityId, parsed.entityType, 'Customer not found')
    ensureSameScope(entity, parsed.organizationId, parsed.tenantId)

    const existing = await findOneWithDecryption(
      em,
      CustomerEntityRole,
      {
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        roleType: parsed.roleType,
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
      },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (existing) {
      throw new CrudHttpError(409, { error: 'Role type already assigned for this entity' })
    }

    const role = em.create(CustomerEntityRole, {
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      userId: parsed.userId,
      roleType: parsed.roleType,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
    })
    em.persist(role)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: role,
      identifiers: getRoleIdentifiers(role),
      syncOrigin: ctx.syncOrigin,
      events: entityRoleCrudEvents,
      indexer: { entityType: 'customers:entity_role' },
    })

    return { roleId: role.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return loadEntityRoleSnapshot(em, result.roleId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as EntityRoleSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.entityRoles.create', 'Create entity role'),
      resourceKind: 'customers.entityRole',
      resourceId: result.roleId,
      parentResourceKind: resolveParentResourceKind(snapshot?.entityKind),
      parentResourceId: snapshot?.role.entityId ?? null,
      tenantId: snapshot?.role.tenantId ?? null,
      organizationId: snapshot?.role.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies EntityRoleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<EntityRoleUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const role = await findOneWithDecryption(
      em,
      CustomerEntityRole,
      { id: after.role.id },
      undefined,
      { tenantId: after.role.tenantId, organizationId: after.role.organizationId },
    )
    if (!role) return

    em.remove(role)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: role,
      identifiers: getRoleIdentifiers(role),
      syncOrigin: ctx.syncOrigin,
      events: entityRoleCrudEvents,
      indexer: { entityType: 'customers:entity_role' },
    })
  },
}

const updateEntityRoleCommand: CommandHandler<EntityRoleUpdateInput, { roleId: string }> = {
  id: 'customers.entityRoles.update',
  async prepare(rawInput, ctx) {
    const parsed = entityRoleUpdateSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadEntityRoleSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = entityRoleUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const role = await findOneWithDecryption(
      em,
      CustomerEntityRole,
      { id: parsed.id },
      undefined,
      { tenantId: null, organizationId: null },
    )
    if (!role) {
      throw new CrudHttpError(404, { error: 'Role not found' })
    }

    ensureTenantScope(ctx, role.tenantId)
    ensureOrganizationScope(ctx, role.organizationId)
    role.userId = parsed.userId
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: role,
      identifiers: getRoleIdentifiers(role),
      syncOrigin: ctx.syncOrigin,
      events: entityRoleCrudEvents,
      indexer: { entityType: 'customers:entity_role' },
    })

    return { roleId: role.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve('em') as EntityManager
    return loadEntityRoleSnapshot(em, result.roleId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as EntityRoleSnapshot | undefined
    const after = snapshots.after as EntityRoleSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.entityRoles.update', 'Update entity role'),
      resourceKind: 'customers.entityRole',
      resourceId: result.roleId,
      parentResourceKind: resolveParentResourceKind(after?.entityKind ?? before?.entityKind),
      parentResourceId: after?.role.entityId ?? before?.role.entityId ?? null,
      tenantId: after?.role.tenantId ?? before?.role.tenantId ?? null,
      organizationId: after?.role.organizationId ?? before?.role.organizationId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: after ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after: after ?? null,
        } satisfies EntityRoleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<EntityRoleUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const role = await findOneWithDecryption(
      em,
      CustomerEntityRole,
      { id: before.role.id },
      undefined,
      { tenantId: before.role.tenantId, organizationId: before.role.organizationId },
    )
    if (!role) return

    role.userId = before.role.userId
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: role,
      identifiers: getRoleIdentifiers(role),
      syncOrigin: ctx.syncOrigin,
      events: entityRoleCrudEvents,
      indexer: { entityType: 'customers:entity_role' },
    })
  },
}

const deleteEntityRoleCommand: CommandHandler<EntityRoleDeleteInput, { roleId: string }> = {
  id: 'customers.entityRoles.delete',
  async prepare(rawInput, ctx) {
    const parsed = entityRoleDeleteSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    const snapshot = await loadEntityRoleSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = entityRoleDeleteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const role = await findOneWithDecryption(
      em,
      CustomerEntityRole,
      { id: parsed.id },
      undefined,
      { tenantId: null, organizationId: null },
    )
    if (!role) {
      throw new CrudHttpError(404, { error: 'Role not found' })
    }

    ensureTenantScope(ctx, role.tenantId)
    ensureOrganizationScope(ctx, role.organizationId)
    em.remove(role)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: role,
      identifiers: getRoleIdentifiers(role),
      syncOrigin: ctx.syncOrigin,
      events: entityRoleCrudEvents,
      indexer: { entityType: 'customers:entity_role' },
    })

    return { roleId: role.id }
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as EntityRoleSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.entityRoles.delete', 'Delete entity role'),
      resourceKind: 'customers.entityRole',
      resourceId: result.roleId,
      parentResourceKind: resolveParentResourceKind(before?.entityKind),
      parentResourceId: before?.role.entityId ?? null,
      tenantId: before?.role.tenantId ?? null,
      organizationId: before?.role.organizationId ?? null,
      snapshotBefore: before ?? null,
      payload: {
        undo: {
          before: before ?? null,
        } satisfies EntityRoleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<EntityRoleUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await requireCustomerEntity(
      em,
      before.role.entityId,
      before.role.entityType,
      'Customer not found',
    )
    ensureSameScope(entity, before.role.organizationId, before.role.tenantId)

    let role = await findOneWithDecryption(
      em,
      CustomerEntityRole,
      { id: before.role.id },
      undefined,
      { tenantId: before.role.tenantId, organizationId: before.role.organizationId },
    )
    if (!role) {
      role = em.create(CustomerEntityRole, {
        id: before.role.id,
        entityType: before.role.entityType,
        entityId: before.role.entityId,
        userId: before.role.userId,
        roleType: before.role.roleType,
        organizationId: before.role.organizationId,
        tenantId: before.role.tenantId,
      })
      em.persist(role)
    } else {
      role.userId = before.role.userId
      role.roleType = before.role.roleType
    }
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'created',
      entity: role,
      identifiers: getRoleIdentifiers(role),
      syncOrigin: ctx.syncOrigin,
      events: entityRoleCrudEvents,
      indexer: { entityType: 'customers:entity_role' },
    })
  },
}

registerCommand(createEntityRoleCommand)
registerCommand(updateEntityRoleCommand)
registerCommand(deleteEntityRoleCommand)
