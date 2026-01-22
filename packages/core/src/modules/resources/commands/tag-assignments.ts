import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { ResourcesResource, ResourcesResourceTag, ResourcesResourceTagAssignment } from '../data/entities'
import {
  resourcesResourceTagAssignmentSchema,
  type ResourcesResourceTagAssignmentInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'

type ResourceTagAssignmentSnapshot = {
  tagId: string
  resourceId: string
  tenantId: string
  organizationId: string
}

type ResourceTagAssignmentUndoPayload = {
  before?: ResourceTagAssignmentSnapshot | null
}

const assignResourceTagCommand: CommandHandler<ResourcesResourceTagAssignmentInput, { assignmentId: string }> = {
  id: 'resources.resourceTags.assign',
  async execute(rawInput, ctx) {
    const parsed = resourcesResourceTagAssignmentSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(ResourcesResourceTag, {
      id: parsed.tagId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found.' })
    const resource = await findOneWithDecryption(
      em,
      ResourcesResource,
      { id: parsed.resourceId, tenantId: parsed.tenantId, organizationId: parsed.organizationId, deletedAt: null },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!resource) throw new CrudHttpError(404, { error: 'Resource not found.' })
    const existing = await em.findOne(ResourcesResourceTagAssignment, {
      tag,
      resource,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (existing) throw new CrudHttpError(409, { error: 'Tag already assigned.' })
    const assignment = em.create(ResourcesResourceTagAssignment, {
      tag,
      resource,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(assignment)
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: assignment,
      identifiers: {
        id: assignment.id,
        tenantId: assignment.tenantId,
        organizationId: assignment.organizationId,
      },
    })

    return { assignmentId: assignment.id }
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
    const assignment = await findOneWithDecryption(
      em,
      ResourcesResourceTagAssignment,
      { id: result.assignmentId },
      { populate: ['tag', 'resource'] },
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null },
    )
    if (!assignment) return null
    const tagId = typeof assignment.tag === 'string' ? assignment.tag : assignment.tag.id
    const resourceId = typeof assignment.resource === 'string' ? assignment.resource : assignment.resource.id
    return {
      actionLabel: translate('resources.audit.resourceTags.assign', 'Assign resource tag'),
      resourceKind: 'resources.resourceTagAssignment',
      resourceId: assignment.id,
      tenantId: assignment.tenantId,
      organizationId: assignment.organizationId,
      payload: {
        undo: {
          before: {
            tagId,
            resourceId,
            tenantId: assignment.tenantId,
            organizationId: assignment.organizationId,
          } satisfies ResourceTagAssignmentSnapshot,
        } satisfies ResourceTagAssignmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceTagAssignmentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await em.nativeDelete(ResourcesResourceTagAssignment, {
      tag: before.tagId,
      resource: before.resourceId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
    })
  },
}

const unassignResourceTagCommand: CommandHandler<ResourcesResourceTagAssignmentInput, { assignmentId: string | null }> = {
  id: 'resources.resourceTags.unassign',
  async execute(rawInput, ctx) {
    const parsed = resourcesResourceTagAssignmentSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(ResourcesResourceTagAssignment, {
      tag: parsed.tagId,
      resource: parsed.resourceId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (!existing) throw new CrudHttpError(404, { error: 'Tag assignment not found.' })
    await em.remove(existing)
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: existing,
      identifiers: {
        id: existing.id,
        tenantId: existing.tenantId,
        organizationId: existing.organizationId,
      },
    })

    return { assignmentId: existing.id ?? null }
  },
  buildLog: async ({ input }) => {
    const { translate } = await resolveTranslations()
    const parsed = resourcesResourceTagAssignmentSchema.parse(input)
    return {
      actionLabel: translate('resources.audit.resourceTags.unassign', 'Unassign resource tag'),
      resourceKind: 'resources.resourceTagAssignment',
      resourceId: parsed.tagId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before: {
            tagId: parsed.tagId,
            resourceId: parsed.resourceId,
            tenantId: parsed.tenantId,
            organizationId: parsed.organizationId,
          } satisfies ResourceTagAssignmentSnapshot,
        } satisfies ResourceTagAssignmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ResourceTagAssignmentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(ResourcesResourceTag, { id: before.tagId })
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found.' })
    const resource = await findOneWithDecryption(
      em,
      ResourcesResource,
      { id: before.resourceId, deletedAt: null },
      undefined,
      { tenantId: before.tenantId, organizationId: before.organizationId },
    )
    if (!resource) throw new CrudHttpError(404, { error: 'Resource not found.' })
    const existing = await em.findOne(ResourcesResourceTagAssignment, {
      tag,
      resource,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
    })
    if (!existing) {
      const assignment = em.create(ResourcesResourceTagAssignment, {
        tag,
        resource,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(assignment)
      await em.flush()
    }

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: resource,
      identifiers: {
        id: resource.id,
        tenantId: resource.tenantId,
        organizationId: resource.organizationId,
      },
    })
  },
}

registerCommand(assignResourceTagCommand)
registerCommand(unassignResourceTagCommand)
