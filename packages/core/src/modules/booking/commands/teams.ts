import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects, parseWithCustomFields, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { buildCustomFieldResetMap, diffCustomFieldChanges, loadCustomFieldSnapshot, type CustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { BookingTeam } from '../data/entities'
import {
  bookingTeamCreateSchema,
  bookingTeamUpdateSchema,
  type BookingTeamCreateInput,
  type BookingTeamUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { E } from '@/generated/entities.ids.generated'

type TeamSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  description: string | null
  isActive: boolean
  deletedAt: string | null
}

type TeamUndoPayload = {
  before?: TeamSnapshot | null
  after?: TeamSnapshot | null
  customBefore?: CustomFieldSnapshot | null
  customAfter?: CustomFieldSnapshot | null
}

async function loadTeamSnapshot(em: EntityManager, id: string): Promise<TeamSnapshot | null> {
  const team = await findOneWithDecryption(em, BookingTeam, { id }, undefined, { tenantId: null, organizationId: null })
  if (!team) return null
  return {
    id: team.id,
    tenantId: team.tenantId,
    organizationId: team.organizationId,
    name: team.name,
    description: team.description ?? null,
    isActive: team.isActive ?? true,
    deletedAt: team.deletedAt ? team.deletedAt.toISOString() : null,
  }
}

async function loadTeamCustomSnapshot(em: EntityManager, snapshot: TeamSnapshot): Promise<CustomFieldSnapshot> {
  return loadCustomFieldSnapshot(em, {
    entityId: E.booking.booking_team,
    recordId: snapshot.id,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
  })
}

const createTeamCommand: CommandHandler<BookingTeamCreateInput, { teamId: string }> = {
  id: 'booking.teams.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(bookingTeamCreateSchema, rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const team = em.create(BookingTeam, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      name: parsed.name,
      description: parsed.description ?? null,
      isActive: parsed.isActive ?? true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(team)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.booking.booking_team,
      recordId: team.id,
      tenantId: team.tenantId,
      organizationId: team.organizationId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: team,
      identifiers: {
        id: team.id,
        organizationId: team.organizationId,
        tenantId: team.tenantId,
      },
    })

    return { teamId: team.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTeamSnapshot(em, result.teamId)
    if (!snapshot) return null
    const custom = await loadTeamCustomSnapshot(em, snapshot)
    return { snapshot, custom }
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTeamSnapshot(em, result.teamId)
    if (!snapshot) return null
    const custom = await loadTeamCustomSnapshot(em, snapshot)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.teams.create', 'Create team'),
      resourceKind: 'booking.team',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
          customAfter: custom,
        } satisfies TeamUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TeamUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const team = await em.findOne(BookingTeam, { id: after.id })
    if (team) {
      team.deletedAt = new Date()
      await em.flush()
    }
  },
}

const updateTeamCommand: CommandHandler<BookingTeamUpdateInput, { teamId: string }> = {
  id: 'booking.teams.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(bookingTeamUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTeamSnapshot(em, parsed.id)
    if (!snapshot) return {}
    const custom = await loadTeamCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(bookingTeamUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const team = await findOneWithDecryption(
      em,
      BookingTeam,
      { id: parsed.id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!team) throw new CrudHttpError(404, { error: 'Team not found.' })
    ensureTenantScope(ctx, team.tenantId)
    ensureOrganizationScope(ctx, team.organizationId)

    if (parsed.name !== undefined) team.name = parsed.name
    if (parsed.description !== undefined) team.description = parsed.description ?? null
    if (parsed.isActive !== undefined) team.isActive = parsed.isActive
    team.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.booking.booking_team,
      recordId: team.id,
      tenantId: team.tenantId,
      organizationId: team.organizationId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: team,
      identifiers: {
        id: team.id,
        organizationId: team.organizationId,
        tenantId: team.tenantId,
      },
    })

    return { teamId: team.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as TeamSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadTeamSnapshot(em, before.id)
    if (!after) return null
    const customBefore = snapshots.customBefore as CustomFieldSnapshot | undefined
    const customAfter = await loadTeamCustomSnapshot(em, after)
    const changes = buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
      'name',
      'description',
      'isActive',
      'deletedAt',
    ])
    const customChanges = diffCustomFieldChanges(customBefore, customAfter)
    if (Object.keys(customChanges).length) {
      changes.customFields = { from: customBefore ?? null, to: customAfter ?? null }
    }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.teams.update', 'Update team'),
      resourceKind: 'booking.team',
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
        } satisfies TeamUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TeamUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const team = await em.findOne(BookingTeam, { id: before.id })
    if (!team) return
    team.name = before.name
    team.description = before.description ?? null
    team.isActive = before.isActive
    team.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    team.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    if (payload.customBefore || payload.customAfter) {
      const reset = buildCustomFieldResetMap(payload.customBefore ?? undefined, payload.customAfter ?? undefined)
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: E.booking.booking_team,
        recordId: team.id,
        tenantId: team.tenantId,
        organizationId: team.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: team,
      identifiers: {
        id: team.id,
        organizationId: team.organizationId,
        tenantId: team.tenantId,
      },
    })
  },
}

const deleteTeamCommand: CommandHandler<{ id?: string }, { teamId: string }> = {
  id: 'booking.teams.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Team id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTeamSnapshot(em, id)
    if (!snapshot) return {}
    const custom = await loadTeamCustomSnapshot(em, snapshot)
    return { before: snapshot, customBefore: custom }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Team id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const team = await findOneWithDecryption(
      em,
      BookingTeam,
      { id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!team) throw new CrudHttpError(404, { error: 'Team not found.' })
    ensureTenantScope(ctx, team.tenantId)
    ensureOrganizationScope(ctx, team.organizationId)
    team.deletedAt = new Date()
    team.updatedAt = new Date()
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: team,
      identifiers: {
        id: team.id,
        organizationId: team.organizationId,
        tenantId: team.tenantId,
      },
    })
    return { teamId: team.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as TeamSnapshot | undefined
    if (!before) return null
    const customBefore = snapshots.customBefore as CustomFieldSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.teams.delete', 'Delete team'),
      resourceKind: 'booking.team',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
          customBefore: customBefore ?? null,
        } satisfies TeamUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<TeamUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let team = await em.findOne(BookingTeam, { id: before.id })
    if (!team) {
      team = em.create(BookingTeam, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        name: before.name,
        description: before.description ?? null,
        isActive: before.isActive,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(team)
    } else {
      team.name = before.name
      team.description = before.description ?? null
      team.isActive = before.isActive
      team.deletedAt = null
      team.updatedAt = new Date()
    }
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    if (payload.customBefore) {
      const reset = buildCustomFieldResetMap(payload.customBefore, undefined)
      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: E.booking.booking_team,
        recordId: team.id,
        tenantId: team.tenantId,
        organizationId: team.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'created',
      entity: team,
      identifiers: {
        id: team.id,
        organizationId: team.organizationId,
        tenantId: team.tenantId,
      },
    })
  },
}

registerCommand(createTeamCommand)
registerCommand(updateTeamCommand)
registerCommand(deleteTeamCommand)
