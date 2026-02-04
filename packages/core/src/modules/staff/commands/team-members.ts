import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { buildCustomFieldResetMap, diffCustomFieldChanges, loadCustomFieldSnapshot, type CustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { StaffTeam, StaffTeamMember, StaffTeamRole } from '../data/entities'
import {
  staffTeamMemberCreateSchema,
  staffTeamMemberUpdateSchema,
  type StaffTeamMemberCreateInput,
  type StaffTeamMemberUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { E } from '#generated/entities.ids.generated'

const teamMemberCrudIndexer: CrudIndexerConfig<StaffTeamMember> = {
  entityType: E.staff.staff_team_member,
}

type TeamMemberSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  teamId: string | null
  displayName: string
  description: string | null
  userId: string | null
  roleIds: string[]
  tags: string[]
  isActive: boolean
  deletedAt: string | null
}

type TeamMemberUndoPayload = {
  before?: TeamMemberSnapshot | null
  after?: TeamMemberSnapshot | null
  customBefore?: CustomFieldSnapshot | null
  customAfter?: CustomFieldSnapshot | null
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const set = new Set<string>()
  value.forEach((entry) => {
    if (typeof entry === 'string') {
      const trimmed = entry.trim()
      if (trimmed.length) set.add(trimmed)
    }
  })
  return Array.from(set)
}

async function loadTeamMemberSnapshot(em: EntityManager, id: string): Promise<TeamMemberSnapshot | null> {
  const member = await findOneWithDecryption(em, StaffTeamMember, { id }, undefined, { tenantId: null, organizationId: null })
  if (!member) return null
  return {
    id: member.id,
    tenantId: member.tenantId,
    organizationId: member.organizationId,
    teamId: member.teamId ?? null,
    displayName: member.displayName,
    description: member.description ?? null,
    userId: member.userId ?? null,
    roleIds: Array.isArray(member.roleIds) ? member.roleIds : [],
    tags: Array.isArray(member.tags) ? member.tags : [],
    isActive: member.isActive ?? true,
    deletedAt: member.deletedAt ? member.deletedAt.toISOString() : null,
  }
}

async function loadTeamMemberCustomSnapshot(
  em: EntityManager,
  snapshot: TeamMemberSnapshot,
): Promise<CustomFieldSnapshot> {
  return loadCustomFieldSnapshot(em, {
    entityId: E.staff.staff_team_member,
    recordId: snapshot.id,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
  })
}

async function ensureRolesExist(em: EntityManager, roleIds: string[], tenantId: string, organizationId: string): Promise<void> {
  if (!roleIds.length) return
  const roles = await findWithDecryption(
    em,
    StaffTeamRole,
    { id: { $in: roleIds }, tenantId, organizationId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  if (roles.length !== roleIds.length) {
    throw new CrudHttpError(400, { error: 'One or more team roles were not found.' })
  }
}

async function ensureUserExists(em: EntityManager, userId: string, tenantId: string, organizationId: string): Promise<void> {
  const user = await findOneWithDecryption(
    em,
    User,
    { id: userId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  if (!user) throw new CrudHttpError(400, { error: 'User not found.' })
  if (user.tenantId && user.tenantId !== tenantId) {
    throw new CrudHttpError(400, { error: 'User does not belong to this tenant.' })
  }
  if (user.organizationId && user.organizationId !== organizationId) {
    throw new CrudHttpError(400, { error: 'User does not belong to this organization.' })
  }
}

async function ensureTeamExists(em: EntityManager, teamId: string, tenantId: string, organizationId: string): Promise<void> {
  const team = await findOneWithDecryption(
    em,
    StaffTeam,
    { id: teamId, tenantId, organizationId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  if (!team) throw new CrudHttpError(400, { error: 'Team not found.' })
}

const createTeamMemberCommand: CommandHandler<StaffTeamMemberCreateInput, { memberId: string }> = {
  id: 'staff.team-members.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(staffTeamMemberCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const roleIds = normalizeStringList(parsed.roleIds)
    const tags = normalizeStringList(parsed.tags)
    if (parsed.userId) {
      await ensureUserExists(em, parsed.userId, parsed.tenantId, parsed.organizationId)
    }
    if (parsed.teamId) {
      await ensureTeamExists(em, parsed.teamId, parsed.tenantId, parsed.organizationId)
    }
    await ensureRolesExist(em, roleIds, parsed.tenantId, parsed.organizationId)

    const now = new Date()
    const member = em.create(StaffTeamMember, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      teamId: parsed.teamId ?? null,
      displayName: parsed.displayName,
      description: parsed.description ?? null,
      userId: parsed.userId ?? null,
      roleIds,
      tags,
      availabilityRuleSetId: parsed.availabilityRuleSetId ?? null,
      isActive: parsed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(member)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.staff.staff_team_member,
      recordId: member.id,
      tenantId: member.tenantId,
      organizationId: member.organizationId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: member,
      identifiers: {
        id: member.id,
        organizationId: member.organizationId,
        tenantId: member.tenantId,
      },
      indexer: teamMemberCrudIndexer,
    })

    return { memberId: member.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadTeamMemberSnapshot(em, result.memberId)
    if (!snapshot) return null
    const custom = await loadTeamMemberCustomSnapshot(em, snapshot)
    return { snapshot, custom }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTeamMemberSnapshot(em, result.memberId)
    if (!snapshot) return null
    const custom = await loadTeamMemberCustomSnapshot(em, snapshot)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.teamMembers.create', 'Create team member'),
      resourceKind: 'staff.teamMember',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
          customAfter: custom,
        } satisfies TeamMemberUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TeamMemberUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await em.findOne(StaffTeamMember, { id: after.id })
    if (member) {
      member.deletedAt = new Date()
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: member,
        identifiers: {
          id: member.id,
          organizationId: member.organizationId,
          tenantId: member.tenantId,
        },
        indexer: teamMemberCrudIndexer,
      })
    }
  },
}

const updateTeamMemberCommand: CommandHandler<StaffTeamMemberUpdateInput, { memberId: string }> = {
  id: 'staff.team-members.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(staffTeamMemberUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTeamMemberSnapshot(em, parsed.id)
    if (!snapshot) return {}
    const custom = await loadTeamMemberCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(staffTeamMemberUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await findOneWithDecryption(
      em,
      StaffTeamMember,
      { id: parsed.id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!member) throw new CrudHttpError(404, { error: 'Team member not found.' })
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)

    if (parsed.userId !== undefined) {
      if (parsed.userId) {
        await ensureUserExists(em, parsed.userId, member.tenantId, member.organizationId)
      }
      member.userId = parsed.userId ?? null
    }
    if (parsed.teamId !== undefined) {
      if (parsed.teamId) {
        await ensureTeamExists(em, parsed.teamId, member.tenantId, member.organizationId)
      }
      member.teamId = parsed.teamId ?? null
    }
    if (parsed.roleIds !== undefined) {
      const roleIds = normalizeStringList(parsed.roleIds)
      await ensureRolesExist(em, roleIds, member.tenantId, member.organizationId)
      member.roleIds = roleIds
    }
    if (parsed.tags !== undefined) member.tags = normalizeStringList(parsed.tags)
    if (parsed.availabilityRuleSetId !== undefined) member.availabilityRuleSetId = parsed.availabilityRuleSetId ?? null
    if (parsed.displayName !== undefined) member.displayName = parsed.displayName
    if (parsed.description !== undefined) member.description = parsed.description ?? null
    if (parsed.isActive !== undefined) member.isActive = parsed.isActive
    member.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.staff.staff_team_member,
      recordId: member.id,
      tenantId: member.tenantId,
      organizationId: member.organizationId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: member,
      identifiers: {
        id: member.id,
        organizationId: member.organizationId,
        tenantId: member.tenantId,
      },
      indexer: teamMemberCrudIndexer,
    })

    return { memberId: member.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as TeamMemberSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadTeamMemberSnapshot(em, before.id)
    if (!after) return null
    const customBefore = (snapshots as { customBefore?: CustomFieldSnapshot | null }).customBefore ?? undefined
    const customAfter = await loadTeamMemberCustomSnapshot(em, after)
    const changes = buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
      'teamId',
      'displayName',
      'description',
      'userId',
      'roleIds',
      'tags',
      'isActive',
      'deletedAt',
    ])
    const customChanges = diffCustomFieldChanges(customBefore, customAfter)
    if (Object.keys(customChanges).length) {
      changes.customFields = { from: customBefore ?? null, to: customAfter ?? null }
    }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.teamMembers.update', 'Update team member'),
      resourceKind: 'staff.teamMember',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      changes,
      payload: {
        undo: {
          before,
          after,
          customBefore: customBefore ?? null,
          customAfter,
        } satisfies TeamMemberUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TeamMemberUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await em.findOne(StaffTeamMember, { id: before.id })
    if (!member) return
    member.teamId = before.teamId ?? null
    member.displayName = before.displayName
    member.description = before.description ?? null
    member.userId = before.userId ?? null
    member.roleIds = Array.isArray(before.roleIds) ? before.roleIds : []
    member.tags = Array.isArray(before.tags) ? before.tags : []
    member.isActive = before.isActive
    member.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    member.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    if (payload.customBefore || payload.customAfter) {
      const reset = buildCustomFieldResetMap(payload.customBefore ?? undefined, payload.customAfter ?? undefined)
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: E.staff.staff_team_member,
        recordId: member.id,
        tenantId: member.tenantId,
        organizationId: member.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: member,
      identifiers: {
        id: member.id,
        organizationId: member.organizationId,
        tenantId: member.tenantId,
      },
      indexer: teamMemberCrudIndexer,
    })
  },
}

const deleteTeamMemberCommand: CommandHandler<{ id?: string }, { memberId: string }> = {
  id: 'staff.team-members.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Member id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTeamMemberSnapshot(em, id)
    if (!snapshot) return {}
    const custom = await loadTeamMemberCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Member id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await findOneWithDecryption(
      em,
      StaffTeamMember,
      { id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!member) throw new CrudHttpError(404, { error: 'Team member not found.' })
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)
    member.deletedAt = new Date()
    member.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: member,
      identifiers: {
        id: member.id,
        organizationId: member.organizationId,
        tenantId: member.tenantId,
      },
      indexer: teamMemberCrudIndexer,
    })

    return { memberId: member.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TeamMemberSnapshot | undefined
    if (!before) return null
    const customBefore = (snapshots as { customBefore?: CustomFieldSnapshot | null }).customBefore ?? undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.teamMembers.delete', 'Delete team member'),
      resourceKind: 'staff.teamMember',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
          customBefore: customBefore ?? null,
        } satisfies TeamMemberUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TeamMemberUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let member = await em.findOne(StaffTeamMember, { id: before.id })
    if (!member) {
      member = em.create(StaffTeamMember, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        teamId: before.teamId ?? null,
        displayName: before.displayName,
        description: before.description ?? null,
        userId: before.userId ?? null,
        roleIds: before.roleIds ?? [],
        tags: before.tags ?? [],
        isActive: before.isActive,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(member)
    } else {
      member.teamId = before.teamId ?? null
      member.displayName = before.displayName
      member.description = before.description ?? null
      member.userId = before.userId ?? null
      member.roleIds = before.roleIds ?? []
      member.tags = before.tags ?? []
      member.isActive = before.isActive
      member.deletedAt = null
      member.updatedAt = new Date()
    }
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    if (payload.customBefore) {
      const reset = buildCustomFieldResetMap(payload.customBefore, undefined)
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: E.staff.staff_team_member,
        recordId: member.id,
        tenantId: member.tenantId,
        organizationId: member.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: member,
      identifiers: {
        id: member.id,
        organizationId: member.organizationId,
        tenantId: member.tenantId,
      },
      indexer: teamMemberCrudIndexer,
    })
  },
}

registerCommand(createTeamMemberCommand)
registerCommand(updateTeamMemberCommand)
registerCommand(deleteTeamMemberCommand)
