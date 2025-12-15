import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerTag, CustomerTagAssignment } from '../data/entities'
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
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type TagSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  slug: string
  label: string
  color: string | null
  description: string | null
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

async function loadTagSnapshot(em: EntityManager, id: string): Promise<TagSnapshot | null> {
  const tag = await em.findOne(CustomerTag, { id })
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

const createTagCommand: CommandHandler<TagCreateInput, { tagId: string }> = {
  id: 'customers.tags.create',
  async execute(rawInput, ctx) {
    const parsed = tagCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
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
    })

    return { tagId: tag.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return await loadTagSnapshot(em, result.tagId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
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
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const tag = await em.findOne(CustomerTag, { id: tagId })
    if (tag) {
      await em.nativeDelete(CustomerTagAssignment, { tag })
      em.remove(tag)
      await em.flush()
    }
  },
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
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const tag = await em.findOne(CustomerTag, { id: parsed.id })
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found' })
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
    })

    return { tagId: tag.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as TagSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
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
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
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
    })
  },
}

const deleteTagCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { tagId: string }> = {
  id: 'customers.tags.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Tag id required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTagSnapshot(em, id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Tag id required')
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const tag = await em.findOne(CustomerTag, { id })
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found' })
    ensureTenantScope(ctx, tag.tenantId)
    ensureOrganizationScope(ctx, tag.organizationId)
    await em.nativeDelete(CustomerTagAssignment, { tag })
    em.remove(tag)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: tag,
      identifiers: {
        id: tag.id,
        organizationId: tag.organizationId,
        tenantId: tag.tenantId,
      },
    })
    return { tagId: tag.id }
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
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
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
      action: 'created',
      entity: tag,
      identifiers: {
        id: tag.id,
        organizationId: tag.organizationId,
        tenantId: tag.tenantId,
      },
    })
  },
}

const assignTagCommand: CommandHandler<TagAssignmentInput, { assignmentId: string }> = {
  id: 'customers.tags.assign',
  async execute(rawInput, ctx) {
    const parsed = tagAssignmentSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
  const tag = await em.findOne(CustomerTag, { id: parsed.tagId, tenantId: parsed.tenantId, organizationId: parsed.organizationId })
  if (!tag) throw new CrudHttpError(404, { error: 'Tag not found' })
  const entity = await requireCustomerEntity(em, parsed.entityId, undefined, 'Customer not found')
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

    return { assignmentId: assignment.id }
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
    const assignment = await em.findOne(CustomerTagAssignment, { id: result.assignmentId }, { populate: ['tag', 'entity'] })
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
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    await em.nativeDelete(CustomerTagAssignment, {
      tag: before.tagId,
      entity: before.entityId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
    })
  },
}

const unassignTagCommand: CommandHandler<TagAssignmentInput, { assignmentId: string | null }> = {
  id: 'customers.tags.unassign',
  async execute(rawInput, ctx) {
    const parsed = tagAssignmentSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const existing = await em.findOne(CustomerTagAssignment, {
      tag: parsed.tagId,
      entity: parsed.entityId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (!existing) throw new CrudHttpError(404, { error: 'Tag assignment not found' })
    await em.remove(existing)
    await em.flush()

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
    const em = (ctx.container.resolve('em') as EntityManager).fork({ useContext: true })
    const tag = await em.findOne(CustomerTag, { id: before.tagId })
    const entity = await requireCustomerEntity(em, before.entityId, undefined, 'Customer not found')
    ensureSameScope(entity, before.organizationId, before.tenantId)
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found' })
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
