import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { StaffTeamMember } from '../data/entities'
import {
  staffTeamMemberTagAssignmentSchema,
  type StaffTeamMemberTagAssignmentInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'

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

const assignTeamMemberTagCommand: CommandHandler<StaffTeamMemberTagAssignmentInput, { memberId: string }> = {
  id: 'staff.team-members.tags.assign',
  async execute(rawInput, ctx) {
    const parsed = staffTeamMemberTagAssignmentSchema.parse(rawInput)
    const tagValue = parsed.tag.trim()
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await findOneWithDecryption(
      em,
      StaffTeamMember,
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
    const parsed = staffTeamMemberTagAssignmentSchema.parse(input)
    return {
      actionLabel: translate('staff.audit.teamMembers.tags.assign', 'Assign team member tag'),
      resourceKind: 'staff.teamMemberTagAssignment',
      resourceId: parsed.memberId,
      parentResourceKind: 'staff.teamMember',
      parentResourceId: parsed.memberId,
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
    const member = await em.findOne(StaffTeamMember, { id: before.memberId })
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

const unassignTeamMemberTagCommand: CommandHandler<StaffTeamMemberTagAssignmentInput, { memberId: string }> = {
  id: 'staff.team-members.tags.unassign',
  async execute(rawInput, ctx) {
    const parsed = staffTeamMemberTagAssignmentSchema.parse(rawInput)
    const tagValue = parsed.tag.trim()
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await findOneWithDecryption(
      em,
      StaffTeamMember,
      { id: parsed.memberId, deletedAt: null },
      undefined,
      { tenantId: parsed.tenantId, organizationId: parsed.organizationId },
    )
    if (!member) throw new CrudHttpError(404, { error: 'Team member not found.' })
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)
    const currentTags = normalizeTagList(Array.isArray(member.tags) ? member.tags : [])
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
    const parsed = staffTeamMemberTagAssignmentSchema.parse(input)
    return {
      actionLabel: translate('staff.audit.teamMembers.tags.unassign', 'Unassign team member tag'),
      resourceKind: 'staff.teamMemberTagAssignment',
      resourceId: parsed.memberId,
      parentResourceKind: 'staff.teamMember',
      parentResourceId: parsed.memberId,
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
    const member = await em.findOne(StaffTeamMember, { id: before.memberId })
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

registerCommand(assignTeamMemberTagCommand)
registerCommand(unassignTeamMemberTagCommand)
