import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode, type FilterQuery } from '@mikro-orm/core'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import { isUnrestrictedOrganizationScope } from '@open-mercato/shared/lib/auth/organizationAccess'
import { CustomerEntity, CustomerTag, CustomerTagAssignment } from '../data/entities'
import {
  tagCreateSchema,
  tagUpdateSchema,
  tagAssignmentSchema,
  type TagCreateInput,
  type TagUpdateInput,
  type TagAssignmentInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  requireCustomerEntity,
  ensureSameScope,
  loadEntityTagIds,
  emitQueryIndexUpsertEvents,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, forbidden, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { emitCustomersEvent } from '../events'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import { E } from '#generated/entities.ids.generated'

// The route (`api/tags/route.ts`) declares this same entity type and hands it down to the
// execute path, but an undo runs through `CommandBus.undo()` where no route declaration is
// active — so the undo marks carry the indexer explicitly, or a restored tag would stay
// invisible to every index-backed list until the next full rebuild (#5741).
const tagCrudIndexer: CrudIndexerConfig<CustomerTag> = {
  entityType: E.customers.customer_tag,
}

const tagCrudEvents: CrudEventsConfig = {
  module: 'customers',
  entity: 'tag',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}

type TagSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  slug: string
  label: string
  color: string | null
  description: string | null
  assignments?: TagMembershipSnapshot[]
}

type TagMembershipSnapshot = {
  id: string
  entityId: string
  organizationId: string
  tenantId: string
  createdAt: string
}

type TagUndoPayload = {
  before?: TagSnapshot | null
  after?: TagSnapshot | null
}

type TagAssignmentSnapshot = {
  tagId: string
  entityId: string
  organizationId: string
  tenantId: string
}

type TagAssignmentUndoPayload = {
  before?: TagAssignmentSnapshot | null
}

function tagDeleteLookup(id: string, ctx: CommandRuntimeContext) {
  const isSuperAdmin = ctx.auth?.isSuperAdmin === true
  const organizationScope = ctx.organizationScope
  const tenantId = ctx.auth ? (ctx.auth.tenantId ?? null) : (organizationScope?.tenantId ?? null)
  if (ctx.auth && !isSuperAdmin && (!tenantId || (organizationScope && !organizationScope.tenantId))) {
    throw forbidden()
  }
  let organizationIds: string[] | undefined
  if (organizationScope) {
    if (!isUnrestrictedOrganizationScope({ isSuperAdmin, allowedOrganizationIds: organizationScope.allowedIds })) {
      organizationIds = organizationScope.allowedIds ?? []
    }
  } else if (!isSuperAdmin) {
    const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
    if (organizationId) organizationIds = [organizationId]
  }
  return {
    where: buildScopedWhere({ id }, {
      tenantId: tenantId ?? undefined,
      organizationIds,
      softDeleteField: null,
    }) as FilterQuery<CustomerTag>,
    scope: { tenantId, organizationId: organizationIds?.length === 1 ? organizationIds[0] : null },
  }
}

async function loadTagSnapshot(
  em: EntityManager,
  id: string,
  lookup?: ReturnType<typeof tagDeleteLookup>,
): Promise<TagSnapshot | null> {
  const tag = lookup
    ? await findOneWithDecryption(em, CustomerTag, lookup.where, {}, lookup.scope)
    : await em.findOne(CustomerTag, { id })
  if (!tag) return null
  return {
    id: tag.id,
    organizationId: tag.organizationId,
    tenantId: tag.tenantId,
    slug: tag.slug,
    label: tag.label,
    color: tag.color ?? null,
    description: tag.description ?? null,
  }
}

async function loadTagAssignments(em: EntityManager, tag: CustomerTag) {
  const scope = { tenantId: tag.tenantId, organizationId: tag.organizationId }
  return findWithDecryption(em, CustomerTagAssignment, { tag: tag.id, ...scope }, {}, scope)
}

async function refreshTagMemberships(
  ctx: CommandRuntimeContext,
  tag: CustomerTag,
  assignments: CustomerTagAssignment[],
  action: 'created' | 'deleted',
) {
  const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
  for (const assignment of assignments) {
    await emitCrudSideEffects({
      dataEngine,
      action,
      entity: assignment,
      identifiers: { id: assignment.id, tenantId: tag.tenantId, organizationId: tag.organizationId },
      indexer: { entityType: E.customers.customer_tag_assignment },
    })
    await emitCustomersEvent(action === 'created' ? 'customers.tag.assigned' : 'customers.tag.removed', {
      id: assignment.id,
      tagId: tag.id,
      entityId: assignment.entity.id,
      organizationId: tag.organizationId,
      tenantId: tag.tenantId,
    }, { persistent: true })
  }
  await emitQueryIndexUpsertEvents(ctx, assignments.map((assignment) => ({
    entityType: E.customers.customer_entity,
    recordId: assignment.entity.id,
    tenantId: tag.tenantId,
    organizationId: tag.organizationId,
  })))
  await invalidateCrudCache(ctx.container, 'customers.tagAssignment', {
    tenantId: tag.tenantId,
    organizationId: tag.organizationId,
  }, tag.tenantId, `customers.tags.delete.${action}`, ['customers.person', 'customers.company'])
}

const createTagCommand: CommandHandler<TagCreateInput, { tagId: string }> = {
  id: 'customers.tags.create',
  async execute(rawInput, ctx) {
    const parsed = tagCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const duplicate = await em.findOne(CustomerTag, {
      slug: parsed.slug,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
    })
    if (duplicate) throw new CrudHttpError(409, { error: 'Tag slug already exists' })

    const tag = em.create(CustomerTag, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      slug: parsed.slug,
      label: parsed.label,
      color: parsed.color ?? null,
      description: parsed.description ?? null,
    })
    em.persist(tag)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: tag,
      identifiers: {
        id: tag.id,
        organizationId: tag.organizationId,
        tenantId: tag.tenantId,
      },
      events: tagCrudEvents,
    })

    return { tagId: tag.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadTagSnapshot(em, result.tagId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTagSnapshot(em, result.tagId)
    return {
      actionLabel: translate('customers.audit.tags.create', 'Create tag'),
      resourceKind: 'customers.tag',
      resourceId: result.tagId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies TagUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const tagId = logEntry?.resourceId ?? null
    if (!tagId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(CustomerTag, { id: tagId })
    if (tag) {
      await em.nativeDelete(CustomerTagAssignment, { tag })
      em.remove(tag)
      await em.flush()
    }
  },
  redo: makeCreateRedo<CustomerTag, TagSnapshot, TagCreateInput, { tagId: string }>({
    entityClass: CustomerTag,
    buildResult: (entity) => ({ tagId: entity.id }),
    events: tagCrudEvents,
  }),
}

const updateTagCommand: CommandHandler<TagUpdateInput, { tagId: string }> = {
  id: 'customers.tags.update',
  async prepare(rawInput, ctx) {
    const parsed = tagUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTagSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = tagUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(CustomerTag, { id: parsed.id })
    if (!tag) throw notFound('Tag not found')
    ensureTenantScope(ctx, tag.tenantId)
    ensureOrganizationScope(ctx, tag.organizationId)

    if (parsed.slug !== undefined && parsed.slug !== tag.slug) {
      const duplicate = await em.findOne(CustomerTag, {
        slug: parsed.slug,
        organizationId: tag.organizationId,
        tenantId: tag.tenantId,
        id: { $ne: tag.id },
      })
      if (duplicate) throw new CrudHttpError(409, { error: 'Tag slug already exists' })
      tag.slug = parsed.slug
    }
    if (parsed.label !== undefined) tag.label = parsed.label
    if (parsed.color !== undefined) tag.color = parsed.color ?? null
    if (parsed.description !== undefined) tag.description = parsed.description ?? null

    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: tag,
      identifiers: {
        id: tag.id,
        organizationId: tag.organizationId,
        tenantId: tag.tenantId,
      },
      events: tagCrudEvents,
    })

    return { tagId: tag.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as TagSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const afterSnapshot = await loadTagSnapshot(em, before.id)
    const changes =
      afterSnapshot && before
        ? buildChanges(
            before as unknown as Record<string, unknown>,
            afterSnapshot as unknown as Record<string, unknown>,
            ['slug', 'label', 'color', 'description']
          )
        : {}
    return {
      actionLabel: translate('customers.audit.tags.update', 'Update tag'),
      resourceKind: 'customers.tag',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies TagUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TagUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let tag = await em.findOne(CustomerTag, { id: before.id })
    if (!tag) {
      tag = em.create(CustomerTag, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        slug: before.slug,
        label: before.label,
        color: before.color,
        description: before.description,
      })
      em.persist(tag)
    } else {
      tag.slug = before.slug
      tag.label = before.label
      tag.color = before.color
      tag.description = before.description
    }
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: tag,
      identifiers: {
        id: tag.id,
        organizationId: tag.organizationId,
        tenantId: tag.tenantId,
      },
      events: tagCrudEvents,
      indexer: tagCrudIndexer,
    })
  },
}

const deleteTagCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { tagId: string }> = {
  id: 'customers.tags.delete',
  prepareSnapshotInsideTransaction: true,
  async prepare(input, ctx) {
    const id = requireId(input, 'Tag id required')
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTagSnapshot(em, id, tagDeleteLookup(id, ctx))
    if (!snapshot) return {}
    ensureTenantScope(ctx, snapshot.tenantId)
    ensureOrganizationScope(ctx, snapshot.organizationId)
    const assignments = await findWithDecryption(em, CustomerTagAssignment, {
      tag: id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
    }, {}, snapshot)
    snapshot.assignments = assignments.map((assignment) => ({
      id: assignment.id,
      entityId: assignment.entity.id,
      tenantId: assignment.tenantId,
      organizationId: assignment.organizationId,
      createdAt: assignment.createdAt.toISOString(),
    }))
    return { before: snapshot }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Tag id required')
    const lookup = tagDeleteLookup(id, ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let tag: CustomerTag | null = null
    let assignments: CustomerTagAssignment[] = []
    await withAtomicFlush(em, [
      async () => {
        tag = await findOneWithDecryption(em, CustomerTag, lookup.where, { lockMode: LockMode.PESSIMISTIC_WRITE }, lookup.scope)
        if (!tag) throw notFound('Tag not found')
        ensureTenantScope(ctx, tag.tenantId)
        ensureOrganizationScope(ctx, tag.organizationId)
        await ctx.beforeTransactionalWrite?.(em, input)
        assignments = await loadTagAssignments(em, tag)
        await em.nativeDelete(CustomerTagAssignment, { tag, tenantId: tag.tenantId, organizationId: tag.organizationId })
        em.remove(tag)
      },
    ], { transaction: true, label: 'customers.tags.delete' })
    if (!tag) throw notFound('Tag not found')
    const deletedTag = tag as CustomerTag

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: deletedTag,
      identifiers: {
        id: deletedTag.id,
        organizationId: deletedTag.organizationId,
        tenantId: deletedTag.tenantId,
      },
      events: tagCrudEvents,
      indexer: tagCrudIndexer,
    })
    await refreshTagMemberships(ctx, deletedTag, assignments, 'deleted')
    return { tagId: deletedTag.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TagSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('customers.audit.tags.delete', 'Delete tag'),
      resourceKind: 'customers.tag',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      context: { cacheAliases: ['customers.tagAssignment', 'customers.person', 'customers.company'] },
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies TagUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TagUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    ensureTenantScope(ctx, before.tenantId)
    ensureOrganizationScope(ctx, before.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: before.tenantId, organizationId: before.organizationId }
    const existingTag = await findOneWithDecryption(em, CustomerTag, { id: before.id, ...scope }, {}, scope)
    const tag = existingTag ?? em.create(CustomerTag, { id: before.id, ...scope, slug: before.slug, label: before.label })
    const restoredAssignments: CustomerTagAssignment[] = []
    await withAtomicFlush(em, [
      () => {
        tag.slug = before.slug
        tag.label = before.label
        tag.color = before.color
        tag.description = before.description
        em.persist(tag)
      },
      async () => {
        const assignments = (before.assignments ?? []).filter((assignment) =>
          assignment.tenantId === before.tenantId && assignment.organizationId === before.organizationId,
        )
        if (!assignments.length) return
        const customers = await findWithDecryption(em, CustomerEntity, {
          id: { $in: assignments.map((assignment) => assignment.entityId) },
          ...scope,
          deletedAt: null,
          kind: { $in: ['person', 'company'] },
        }, {}, scope)
        const existingAssignments = await loadTagAssignments(em, tag)
        const assignedEntityIds = new Set(existingAssignments.map((assignment) => assignment.entity.id))
        const customersById = new Map(customers.map((customer) => [customer.id, customer]))
        for (const snapshot of assignments) {
          const entity = customersById.get(snapshot.entityId)
          if (!entity || assignedEntityIds.has(entity.id)) continue
          const assignment = em.create(CustomerTagAssignment, {
            id: snapshot.id,
            tag,
            entity,
            ...scope,
            createdAt: new Date(snapshot.createdAt),
          })
          em.persist(assignment)
          restoredAssignments.push(assignment)
          assignedEntityIds.add(entity.id)
        }
      },
    ], { transaction: true, label: 'customers.tags.delete.undo' })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: tag,
      identifiers: {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
      },
      events: tagCrudEvents,
      indexer: tagCrudIndexer,
    })
    await refreshTagMemberships(ctx, tag, restoredAssignments, 'created')
  },
}

const assignTagCommand: CommandHandler<TagAssignmentInput, { assignmentId: string }> = {
  id: 'customers.tags.assign',
  async execute(rawInput, ctx) {
    const parsed = tagAssignmentSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
  const tag = await em.findOne(CustomerTag, { id: parsed.tagId, tenantId: parsed.tenantId, organizationId: parsed.organizationId })
  if (!tag) throw notFound('Tag not found')
  const entity = await requireCustomerEntity(em, parsed.entityId, { tenantId: parsed.tenantId, organizationId: parsed.organizationId }, undefined, 'Customer not found')
  ensureSameScope(entity, parsed.organizationId, parsed.tenantId)
  const tagIds = await loadEntityTagIds(em, entity)
    if (tagIds.includes(parsed.tagId)) {
      throw new CrudHttpError(409, { error: 'Tag already assigned' })
    }

    const assignment = em.create(CustomerTagAssignment, {
      tag,
      entity,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
    })
    em.persist(assignment)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: assignment,
      identifiers: {
        id: String(assignment.id),
        organizationId: parsed.organizationId,
        tenantId: parsed.tenantId,
      },
    })

    await emitCustomersEvent('customers.tag.assigned', {
      id: String(assignment.id),
      tagId: parsed.tagId,
      entityId: parsed.entityId,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
    }, { persistent: true })

    return { assignmentId: assignment.id }
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const assignment = await findOneWithDecryption(
      em,
      CustomerTagAssignment,
      { id: result.assignmentId },
      { populate: ['tag', 'entity'] },
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null },
    )
    if (!assignment) return null
    const tagId = typeof assignment.tag === 'string' ? assignment.tag : assignment.tag.id
    const entityId = typeof assignment.entity === 'string' ? assignment.entity : assignment.entity.id
    return {
      actionLabel: translate('customers.audit.tags.assign', 'Assign tag'),
      resourceKind: 'customers.tagAssignment',
      resourceId: result.assignmentId,
      tenantId: assignment.tenantId,
      organizationId: assignment.organizationId,
      payload: {
        undo: {
          before: {
            tagId,
            entityId,
            tenantId: assignment.tenantId,
            organizationId: assignment.organizationId,
          } satisfies TagAssignmentSnapshot,
        } satisfies TagAssignmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TagAssignmentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await em.nativeDelete(CustomerTagAssignment, {
      tag: before.tagId,
      entity: before.entityId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
    })
  },
  redo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TagAssignmentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for tag assign' })
    }
    const assignmentId = logEntry?.resourceId ?? null
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(CustomerTag, { id: before.tagId })
    if (!tag) throw notFound('Tag not found')
    const entity = await requireCustomerEntity(em, before.entityId, { tenantId: before.tenantId, organizationId: before.organizationId }, undefined, 'Customer not found')
    ensureSameScope(entity, before.organizationId, before.tenantId)

    let assignment = await em.findOne(CustomerTagAssignment, {
      tag,
      entity,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
    })
    if (!assignment) {
      assignment = em.create(CustomerTagAssignment, {
        ...(assignmentId ? { id: assignmentId } : {}),
        tag,
        entity,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
      })
      em.persist(assignment)
      await em.flush()
    }

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: assignment,
      identifiers: {
        id: String(assignment.id),
        organizationId: before.organizationId,
        tenantId: before.tenantId,
      },
    })

    await emitCustomersEvent('customers.tag.assigned', {
      id: String(assignment.id),
      tagId: before.tagId,
      entityId: before.entityId,
      organizationId: before.organizationId,
      tenantId: before.tenantId,
    }, { persistent: true })

    return { assignmentId: assignment.id }
  },
}

const unassignTagCommand: CommandHandler<TagAssignmentInput, { assignmentId: string | null }> = {
  id: 'customers.tags.unassign',
  async execute(rawInput, ctx) {
    const parsed = tagAssignmentSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(CustomerTagAssignment, {
      tag: parsed.tagId,
      entity: parsed.entityId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (!existing) throw notFound('Tag assignment not found')
    await em.remove(existing).flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: existing,
      identifiers: {
        id: String(existing.id),
        organizationId: existing.organizationId,
        tenantId: existing.tenantId,
      },
    })

    await emitCustomersEvent('customers.tag.removed', {
      id: String(existing.id),
      tagId: parsed.tagId,
      entityId: parsed.entityId,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
    }, { persistent: true })

    return { assignmentId: existing.id ?? null }
  },
  buildLog: async ({ snapshots, input }) => {
    const { translate } = await resolveTranslations()
    const parsed = tagAssignmentSchema.parse(input)
    return {
      actionLabel: translate('customers.audit.tags.unassign', 'Unassign tag'),
      resourceKind: 'customers.tagAssignment',
      resourceId: parsed.tagId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before: {
            tagId: parsed.tagId,
            entityId: parsed.entityId,
            tenantId: parsed.tenantId,
            organizationId: parsed.organizationId,
          } satisfies TagAssignmentSnapshot,
        } satisfies TagAssignmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TagAssignmentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(CustomerTag, { id: before.tagId })
    const entity = await requireCustomerEntity(em, before.entityId, { tenantId: before.tenantId, organizationId: before.organizationId }, undefined, 'Customer not found')
    ensureSameScope(entity, before.organizationId, before.tenantId)
    if (!tag) throw notFound('Tag not found')
    const existing = await em.findOne(CustomerTagAssignment, {
      tag,
      entity,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
    })
    if (!existing) {
      const assignment = em.create(CustomerTagAssignment, {
        tag,
        entity,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
      })
      em.persist(assignment)
      await em.flush()
    }
  },
}

registerCommand(createTagCommand)
registerCommand(updateTagCommand)
registerCommand(deleteTagCommand)
registerCommand(assignTagCommand)
registerCommand(unassignTagCommand)
