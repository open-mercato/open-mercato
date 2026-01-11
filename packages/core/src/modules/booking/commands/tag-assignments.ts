import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import {
  BookingResource,
  BookingResourceTag,
  BookingResourceTagAssignment,
  BookingTeamMember,
} from '../data/entities'
import {
  bookingResourceTagAssignmentSchema,
  bookingTeamMemberTagAssignmentSchema,
  type BookingResourceTagAssignmentInput,
  type BookingTeamMemberTagAssignmentInput,
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

type TeamMemberTagAssignmentSnapshot = {
  tag: string
  memberId: string
  tenantId: string
  organizationId: string
}

type TeamMemberTagAssignmentUndoPayload = {
  before?: TeamMemberTagAssignmentSnapshot | null
}

function normalizeTagList(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>()
  values.forEach((value) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed.length > 0) set.add(trimmed)
  })
  return Array.from(set)
}

const assignResourceTagCommand: CommandHandler<BookingResourceTagAssignmentInput, { assignmentId: string }> = {
  id: 'booking.resourceTags.assign',
  async execute(rawInput, ctx) {
    const parsed = bookingResourceTagAssignmentSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const tag = await em.findOne(BookingResourceTag, {
      id: parsed.tagId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found.' })
    const resource = await findOneWithDecryption(
      em,
      BookingResource,
      { id: parsed.resourceId, tenantId: parsed.tenantId, organizationId: parsed.organizationId, deletedAt: null },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!resource) throw new CrudHttpError(404, { error: 'Resource not found.' })
    const existing = await em.findOne(BookingResourceTagAssignment, {
      tag,
      resource,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
    })
    if (existing) throw new CrudHttpError(409, { error: 'Tag already assigned.' })
    const assignment = em.create(BookingResourceTagAssignment, {
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
      BookingResourceTagAssignment,
      { id: result.assignmentId },
      { populate: ['tag', 'resource'] },
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null },
    )
    if (!assignment) return null
    const tagId = typeof assignment.tag === 'string' ? assignment.tag : assignment.tag.id
    const resourceId = typeof assignment.resource === 'string' ? assignment.resource : assignment.resource.id
    return {
      actionLabel: translate('booking.audit.resourceTags.assign', 'Assign resource tag'),
      resourceKind: 'booking.resourceTagAssignment',
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
    await em.nativeDelete(BookingResourceTagAssignment, {
      tag: before.tagId,
      resource: before.resourceId,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
    })
  },
}

const unassignResourceTagCommand: CommandHandler<BookingResourceTagAssignmentInput, { assignmentId: string | null }> = {
  id: 'booking.resourceTags.unassign',
  async execute(rawInput, ctx) {
    const parsed = bookingResourceTagAssignmentSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const existing = await em.findOne(BookingResourceTagAssignment, {
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
    const parsed = bookingResourceTagAssignmentSchema.parse(input)
    return {
      actionLabel: translate('booking.audit.resourceTags.unassign', 'Unassign resource tag'),
      resourceKind: 'booking.resourceTagAssignment',
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
    const tag = await em.findOne(BookingResourceTag, { id: before.tagId })
    if (!tag) throw new CrudHttpError(404, { error: 'Tag not found.' })
    const resource = await findOneWithDecryption(
      em,
      BookingResource,
      { id: before.resourceId, deletedAt: null },
      undefined,
      { tenantId: before.tenantId, organizationId: before.organizationId },
    )
    if (!resource) throw new CrudHttpError(404, { error: 'Resource not found.' })
    const existing = await em.findOne(BookingResourceTagAssignment, {
      tag,
      resource,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
    })
    if (!existing) {
      const assignment = em.create(BookingResourceTagAssignment, {
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
  },
}

const assignTeamMemberTagCommand: CommandHandler<BookingTeamMemberTagAssignmentInput, { memberId: string }> = {
  id: 'booking.team-members.tags.assign',
  async execute(rawInput, ctx) {
    const parsed = bookingTeamMemberTagAssignmentSchema.parse(rawInput)
    const tagValue = parsed.tag.trim()
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await findOneWithDecryption(
      em,
      BookingTeamMember,
      { id: parsed.memberId, deletedAt: null },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!member) throw new CrudHttpError(404, { error: 'Team member not found.' })
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)
    const currentTags = normalizeTagList(Array.isArray(member.tags) ? member.tags : [])
    if (currentTags.includes(tagValue)) {
      throw new CrudHttpError(409, { error: 'Tag already assigned.' })
    }
    member.tags = normalizeTagList([...currentTags, tagValue])
    member.updatedAt = new Date()
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: member,
      identifiers: {
        id: member.id,
        tenantId: member.tenantId,
        organizationId: member.organizationId,
      },
    })

    return { memberId: member.id }
  },
  buildLog: async ({ input }) => {
    const { translate } = await resolveTranslations()
    const parsed = bookingTeamMemberTagAssignmentSchema.parse(input)
    return {
      actionLabel: translate('booking.audit.teamMembers.tags.assign', 'Assign team member tag'),
      resourceKind: 'booking.teamMemberTagAssignment',
      resourceId: parsed.memberId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before: {
            tag: parsed.tag.trim(),
            memberId: parsed.memberId,
            tenantId: parsed.tenantId,
            organizationId: parsed.organizationId,
          } satisfies TeamMemberTagAssignmentSnapshot,
        } satisfies TeamMemberTagAssignmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TeamMemberTagAssignmentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await em.findOne(BookingTeamMember, { id: before.memberId })
    if (!member) return
    const nextTags = normalizeTagList(
      Array.isArray(member.tags) ? member.tags.filter((tag) => tag !== before.tag) : [],
    )
    member.tags = nextTags
    member.updatedAt = new Date()
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: member,
      identifiers: {
        id: member.id,
        tenantId: member.tenantId,
        organizationId: member.organizationId,
      },
    })
  },
}

const unassignTeamMemberTagCommand: CommandHandler<BookingTeamMemberTagAssignmentInput, { memberId: string }> = {
  id: 'booking.team-members.tags.unassign',
  async execute(rawInput, ctx) {
    const parsed = bookingTeamMemberTagAssignmentSchema.parse(rawInput)
    const tagValue = parsed.tag.trim()
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await findOneWithDecryption(
      em,
      BookingTeamMember,
      { id: parsed.memberId, deletedAt: null },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!member) throw new CrudHttpError(404, { error: 'Team member not found.' })
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)
    const currentTags = Array.isArray(member.tags) ? member.tags : []
    if (!currentTags.includes(tagValue)) {
      throw new CrudHttpError(404, { error: 'Tag assignment not found.' })
    }
    member.tags = normalizeTagList(currentTags.filter((tag) => tag !== tagValue))
    member.updatedAt = new Date()
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: member,
      identifiers: {
        id: member.id,
        tenantId: member.tenantId,
        organizationId: member.organizationId,
      },
    })

    return { memberId: member.id }
  },
  buildLog: async ({ input }) => {
    const { translate } = await resolveTranslations()
    const parsed = bookingTeamMemberTagAssignmentSchema.parse(input)
    return {
      actionLabel: translate('booking.audit.teamMembers.tags.unassign', 'Unassign team member tag'),
      resourceKind: 'booking.teamMemberTagAssignment',
      resourceId: parsed.memberId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      payload: {
        undo: {
          before: {
            tag: parsed.tag.trim(),
            memberId: parsed.memberId,
            tenantId: parsed.tenantId,
            organizationId: parsed.organizationId,
          } satisfies TeamMemberTagAssignmentSnapshot,
        } satisfies TeamMemberTagAssignmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TeamMemberTagAssignmentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await em.findOne(BookingTeamMember, { id: before.memberId })
    if (!member) return
    const currentTags = Array.isArray(member.tags) ? member.tags : []
    if (!currentTags.includes(before.tag)) {
      member.tags = normalizeTagList([...currentTags, before.tag])
      member.updatedAt = new Date()
      await em.flush()
    }

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: member,
      identifiers: {
        id: member.id,
        tenantId: member.tenantId,
        organizationId: member.organizationId,
      },
    })
  },
}

registerCommand(assignResourceTagCommand)
registerCommand(unassignResourceTagCommand)
registerCommand(assignTeamMemberTagCommand)
registerCommand(unassignTeamMemberTagCommand)
