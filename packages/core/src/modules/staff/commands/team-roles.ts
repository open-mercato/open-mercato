import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { buildCustomFieldResetMap, diffCustomFieldChanges, loadCustomFieldSnapshot, type CustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { StaffTeam, StaffTeamMember, StaffTeamRole } from '../data/entities'
import {
  staffTeamRoleCreateSchema,
  staffTeamRoleUpdateSchema,
  type StaffTeamRoleCreateInput,
  type StaffTeamRoleUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { E } from '#generated/entities.ids.generated'

const teamRoleCrudIndexer: CrudIndexerConfig<StaffTeamRole> = {
  entityType: E.staff.staff_team_role,
}

type TeamRoleSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  teamId: string | null
  name: string
  description: string | null
  appearanceIcon: string | null
  appearanceColor: string | null
  deletedAt: string | null
}

type TeamRoleUndoPayload = {
  before?: TeamRoleSnapshot | null
  after?: TeamRoleSnapshot | null
  customBefore?: CustomFieldSnapshot | null
  customAfter?: CustomFieldSnapshot | null
}

async function loadTeamRoleSnapshot(em: EntityManager, id: string): Promise<TeamRoleSnapshot | null> {
  const role = await findOneWithDecryption(em, StaffTeamRole, { id }, undefined, { tenantId: null, organizationId: null })
  if (!role) return null
  return {
    id: role.id,
    tenantId: role.tenantId,
    organizationId: role.organizationId,
    teamId: role.teamId ?? null,
    name: role.name,
    description: role.description ?? null,
    appearanceIcon: role.appearanceIcon ?? null,
    appearanceColor: role.appearanceColor ?? null,
    deletedAt: role.deletedAt ? role.deletedAt.toISOString() : null,
  }
}

async function loadTeamRoleCustomSnapshot(
  em: EntityManager,
  snapshot: TeamRoleSnapshot,
): Promise<CustomFieldSnapshot> {
  return loadCustomFieldSnapshot(em, {
    entityId: E.staff.staff_team_role,
    recordId: snapshot.id,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
  })
}

async function ensureTeamExists(
  em: EntityManager,
  teamId: string,
  tenantId: string,
  organizationId: string,
): Promise<void> {
  const team = await findOneWithDecryption(
    em,
    StaffTeam,
    { id: teamId, tenantId, organizationId, deletedAt: null },
    undefined,
    { tenantId, organizationId },
  )
  if (!team) throw new CrudHttpError(400, { error: 'Team not found.' })
}

const createTeamRoleCommand: CommandHandler<StaffTeamRoleCreateInput, { roleId: string }> = {
  id: 'staff.team-roles.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(staffTeamRoleCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    if (parsed.teamId) {
      await ensureTeamExists(em, parsed.teamId, parsed.tenantId, parsed.organizationId)
    }
    const now = new Date()
    const role = em.create(StaffTeamRole, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      teamId: parsed.teamId ?? null,
      name: parsed.name,
      description: parsed.description ?? null,
      appearanceIcon: parsed.appearanceIcon ?? null,
      appearanceColor: parsed.appearanceColor ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(role)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.staff.staff_team_role,
      recordId: role.id,
      tenantId: role.tenantId,
      organizationId: role.organizationId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: role,
      identifiers: {
        id: role.id,
        organizationId: role.organizationId,
        tenantId: role.tenantId,
      },
      indexer: teamRoleCrudIndexer,
    })

    return { roleId: role.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTeamRoleSnapshot(em, result.roleId)
    if (!snapshot) return null
    const custom = await loadTeamRoleCustomSnapshot(em, snapshot)
    return { snapshot, custom }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTeamRoleSnapshot(em, result.roleId)
    if (!snapshot) return null
    const custom = await loadTeamRoleCustomSnapshot(em, snapshot)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.teamRoles.create', 'Create team role'),
      resourceKind: 'staff.teamRole',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
          customAfter: custom,
        } satisfies TeamRoleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TeamRoleUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const role = await em.findOne(StaffTeamRole, { id: after.id })
    if (role) {
      role.deletedAt = new Date()
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: role,
        identifiers: {
          id: role.id,
          organizationId: role.organizationId,
          tenantId: role.tenantId,
        },
        indexer: teamRoleCrudIndexer,
      })
    }
  },
}

const updateTeamRoleCommand: CommandHandler<StaffTeamRoleUpdateInput, { roleId: string }> = {
  id: 'staff.team-roles.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(staffTeamRoleUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTeamRoleSnapshot(em, parsed.id)
    if (!snapshot) return {}
    const custom = await loadTeamRoleCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(staffTeamRoleUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const role = await findOneWithDecryption(
      em,
      StaffTeamRole,
      { id: parsed.id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!role) throw new CrudHttpError(404, { error: 'Team role not found.' })
    ensureTenantScope(ctx, role.tenantId)
    ensureOrganizationScope(ctx, role.organizationId)

    if (parsed.teamId !== undefined) {
      if (parsed.teamId) {
        await ensureTeamExists(em, parsed.teamId, role.tenantId, role.organizationId)
      }
      role.teamId = parsed.teamId ?? null
    }
    if (parsed.name !== undefined) role.name = parsed.name
    if (parsed.description !== undefined) role.description = parsed.description ?? null
    if (parsed.appearanceIcon !== undefined) role.appearanceIcon = parsed.appearanceIcon ?? null
    if (parsed.appearanceColor !== undefined) role.appearanceColor = parsed.appearanceColor ?? null
    role.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.staff.staff_team_role,
      recordId: role.id,
      tenantId: role.tenantId,
      organizationId: role.organizationId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: role,
      identifiers: {
        id: role.id,
        organizationId: role.organizationId,
        tenantId: role.tenantId,
      },
      indexer: teamRoleCrudIndexer,
    })

    return { roleId: role.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as TeamRoleSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadTeamRoleSnapshot(em, before.id)
    if (!after) return null
    const customBefore = (snapshots as { customBefore?: CustomFieldSnapshot | null }).customBefore ?? undefined
    const customAfter = await loadTeamRoleCustomSnapshot(em, after)
    const changes = buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
      'teamId',
      'name',
      'description',
      'appearanceIcon',
      'appearanceColor',
      'deletedAt',
    ])
    const customChanges = diffCustomFieldChanges(customBefore, customAfter)
    if (Object.keys(customChanges).length) {
      changes.customFields = { from: customBefore ?? null, to: customAfter ?? null }
    }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.teamRoles.update', 'Update team role'),
      resourceKind: 'staff.teamRole',
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
        } satisfies TeamRoleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TeamRoleUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const role = await em.findOne(StaffTeamRole, { id: before.id })
    if (!role) return
    role.teamId = before.teamId ?? null
    role.name = before.name
    role.description = before.description ?? null
    role.appearanceIcon = before.appearanceIcon ?? null
    role.appearanceColor = before.appearanceColor ?? null
    role.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    role.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    if (payload.customBefore || payload.customAfter) {
      const reset = buildCustomFieldResetMap(payload.customBefore ?? undefined, payload.customAfter ?? undefined)
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: E.staff.staff_team_role,
        recordId: role.id,
        tenantId: role.tenantId,
        organizationId: role.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: role,
      identifiers: {
        id: role.id,
        organizationId: role.organizationId,
        tenantId: role.tenantId,
      },
      indexer: teamRoleCrudIndexer,
    })
  },
}

const deleteTeamRoleCommand: CommandHandler<{ id?: string }, { roleId: string }> = {
  id: 'staff.team-roles.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Role id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTeamRoleSnapshot(em, id)
    if (!snapshot) return {}
    const custom = await loadTeamRoleCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Role id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const role = await findOneWithDecryption(
      em,
      StaffTeamRole,
      { id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!role) throw new CrudHttpError(404, { error: 'Team role not found.' })
    ensureTenantScope(ctx, role.tenantId)
    ensureOrganizationScope(ctx, role.organizationId)
    const assignedMember = await findOneWithDecryption(
      em,
      StaffTeamMember,
      {
        tenantId: role.tenantId,
        organizationId: role.organizationId,
        deletedAt: null,
        roleIds: { $contains: [role.id] },
      },
      undefined,
      { tenantId: role.tenantId, organizationId: role.organizationId },
    )
    if (assignedMember) {
      const { translate } = await resolveTranslations()
      throw new CrudHttpError(409, {
        error: translate(
          'staff.teamRoles.errors.assignedMembers',
          'Team role has assigned team members. Remove them before deleting.',
        ),
      })
    }
    role.deletedAt = new Date()
    role.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: role,
      identifiers: {
        id: role.id,
        organizationId: role.organizationId,
        tenantId: role.tenantId,
      },
      indexer: teamRoleCrudIndexer,
    })
    return { roleId: role.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TeamRoleSnapshot | undefined
    if (!before) return null
    const customBefore = (snapshots as { customBefore?: CustomFieldSnapshot | null }).customBefore ?? undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('staff.audit.teamRoles.delete', 'Delete team role'),
      resourceKind: 'staff.teamRole',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
          customBefore: customBefore ?? null,
        } satisfies TeamRoleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TeamRoleUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let role = await em.findOne(StaffTeamRole, { id: before.id })
    if (!role) {
      role = em.create(StaffTeamRole, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        teamId: before.teamId ?? null,
        name: before.name,
        description: before.description ?? null,
        appearanceIcon: before.appearanceIcon ?? null,
        appearanceColor: before.appearanceColor ?? null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(role)
    } else {
      role.teamId = before.teamId ?? null
      role.name = before.name
      role.description = before.description ?? null
      role.appearanceIcon = before.appearanceIcon ?? null
      role.appearanceColor = before.appearanceColor ?? null
      role.deletedAt = null
      role.updatedAt = new Date()
    }
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    if (payload.customBefore) {
      const reset = buildCustomFieldResetMap(payload.customBefore, undefined)
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: E.staff.staff_team_role,
        recordId: role.id,
        tenantId: role.tenantId,
        organizationId: role.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: role,
      identifiers: {
        id: role.id,
        organizationId: role.organizationId,
        tenantId: role.tenantId,
      },
      indexer: teamRoleCrudIndexer,
    })
  },
}

registerCommand(createTeamRoleCommand)
registerCommand(updateTeamRoleCommand)
registerCommand(deleteTeamRoleCommand)
