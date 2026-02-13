import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, buildChanges, requireId } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { StaffTeamMemberJobHistory } from '../data/entities'
import {
  staffTeamMemberJobHistoryCreateSchema,
  staffTeamMemberJobHistoryUpdateSchema,
  type StaffTeamMemberJobHistoryCreateInput,
  type StaffTeamMemberJobHistoryUpdateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  extractUndoPayload,
  requireTeamMember,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'

const jobHistoryCrudIndexer: CrudIndexerConfig<StaffTeamMemberJobHistory> = {
  entityType: E.staff.staff_team_member_job_history,
}

type JobHistorySnapshot = {
  id: string
  organizationId: string
  tenantId: string
  memberId: string
  name: string
  companyName: string | null
  description: string | null
  startDate: string
  endDate: string | null
}

type JobHistoryUndoPayload = {
  before?: JobHistorySnapshot | null
  after?: JobHistorySnapshot | null
}

async function loadJobHistorySnapshot(em: EntityManager, id: string): Promise<JobHistorySnapshot | null> {
  const record = await em.findOne(StaffTeamMemberJobHistory, { id })
  if (!record) return null
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    memberId: typeof record.member === 'string' ? record.member : record.member.id,
    name: record.name,
    companyName: record.companyName ?? null,
    description: record.description ?? null,
    startDate: record.startDate.toISOString(),
    endDate: record.endDate ? record.endDate.toISOString() : null,
  }
}

const createJobHistoryCommand: CommandHandler<StaffTeamMemberJobHistoryCreateInput, { jobHistoryId: string }> = {
  id: 'staff.team-member-job-histories.create',
  async execute(rawInput, ctx) {
    const parsed = staffTeamMemberJobHistoryCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const member = await requireTeamMember(em, parsed.entityId, 'Team member not found')
    ensureTenantScope(ctx, member.tenantId)
    ensureOrganizationScope(ctx, member.organizationId)

    const record = em.create(StaffTeamMemberJobHistory, {
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      member,
      name: parsed.name,
      companyName: parsed.companyName ?? null,
      description: parsed.description ?? null,
      startDate: parsed.startDate,
      endDate: parsed.endDate ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(record)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: jobHistoryCrudIndexer,
    })

    return { jobHistoryId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadJobHistorySnapshot(em, result.jobHistoryId)
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as JobHistorySnapshot | undefined
    return {
      actionLabel: translate('staff.audit.teamMemberJobHistories.create', 'Create job history entry'),
      resourceKind: 'staff.team_member_job_history',
      resourceId: result.jobHistoryId,
      parentResourceKind: 'staff.teamMember',
      parentResourceId: snapshot?.memberId ?? null,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies JobHistoryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const jobHistoryId = logEntry?.resourceId ?? null
    if (!jobHistoryId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(StaffTeamMemberJobHistory, { id: jobHistoryId })
    if (record) {
      em.remove(record)
      await em.flush()
    }
  },
}

const updateJobHistoryCommand: CommandHandler<StaffTeamMemberJobHistoryUpdateInput, { jobHistoryId: string }> = {
  id: 'staff.team-member-job-histories.update',
  async prepare(rawInput, ctx) {
    const parsed = staffTeamMemberJobHistoryUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadJobHistorySnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = staffTeamMemberJobHistoryUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(StaffTeamMemberJobHistory, { id: parsed.id })
    if (!record) throw new CrudHttpError(404, { error: 'Job history entry not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.entityId !== undefined) {
      const member = await requireTeamMember(em, parsed.entityId, 'Team member not found')
      ensureTenantScope(ctx, member.tenantId)
      ensureOrganizationScope(ctx, member.organizationId)
      record.member = member
    }
    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.companyName !== undefined) record.companyName = parsed.companyName ?? null
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.startDate !== undefined) record.startDate = parsed.startDate
    if (parsed.endDate !== undefined) record.endDate = parsed.endDate ?? null

    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: jobHistoryCrudIndexer,
    })

    return { jobHistoryId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    return await loadJobHistorySnapshot(em, result.jobHistoryId)
  },
  buildLog: async ({ snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as JobHistorySnapshot | undefined
    if (!before) return null
    const afterSnapshot = snapshots.after as JobHistorySnapshot | undefined
    const changes =
      afterSnapshot && before
        ? buildChanges(
            before as unknown as Record<string, unknown>,
            afterSnapshot as unknown as Record<string, unknown>,
            ['memberId', 'name', 'companyName', 'description', 'startDate', 'endDate'],
          )
        : {}
    return {
      actionLabel: translate('staff.audit.teamMemberJobHistories.update', 'Update job history entry'),
      resourceKind: 'staff.team_member_job_history',
      resourceId: before.id,
      parentResourceKind: 'staff.teamMember',
      parentResourceId: before.memberId ?? null,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: afterSnapshot ?? null,
      changes,
      payload: {
        undo: {
          before,
          after: afterSnapshot ?? null,
        } satisfies JobHistoryUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<JobHistoryUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await em.findOne(StaffTeamMemberJobHistory, { id: before.id })
    const member = await requireTeamMember(em, before.memberId, 'Team member not found')

    if (!record) {
      record = em.create(StaffTeamMemberJobHistory, {
        id: before.id,
        organizationId: before.organizationId,
        tenantId: before.tenantId,
        member,
        name: before.name,
        companyName: before.companyName,
        description: before.description,
        startDate: new Date(before.startDate),
        endDate: before.endDate ? new Date(before.endDate) : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(record)
    } else {
      record.member = member
      record.name = before.name
      record.companyName = before.companyName
      record.description = before.description
      record.startDate = new Date(before.startDate)
      record.endDate = before.endDate ? new Date(before.endDate) : null
    }
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: jobHistoryCrudIndexer,
    })
  },
}

const deleteJobHistoryCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { jobHistoryId: string }> =
  {
    id: 'staff.team-member-job-histories.delete',
    async prepare(input, ctx) {
      const id = requireId(input, 'Job history id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadJobHistorySnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Job history id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const record = await em.findOne(StaffTeamMemberJobHistory, { id })
      if (!record) throw new CrudHttpError(404, { error: 'Job history entry not found' })
      ensureTenantScope(ctx, record.tenantId)
      ensureOrganizationScope(ctx, record.organizationId)
      em.remove(record)
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
        indexer: jobHistoryCrudIndexer,
      })
      return { jobHistoryId: record.id }
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as JobHistorySnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('staff.audit.teamMemberJobHistories.delete', 'Delete job history entry'),
        resourceKind: 'staff.team_member_job_history',
        resourceId: before.id,
        parentResourceKind: 'staff.teamMember',
        parentResourceId: before.memberId ?? null,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            before,
          } satisfies JobHistoryUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<JobHistoryUndoPayload>(logEntry)
      const before = payload?.before
      if (!before) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const member = await requireTeamMember(em, before.memberId, 'Team member not found')
      let record = await em.findOne(StaffTeamMemberJobHistory, { id: before.id })
      if (!record) {
        record = em.create(StaffTeamMemberJobHistory, {
          id: before.id,
          organizationId: before.organizationId,
          tenantId: before.tenantId,
          member,
          name: before.name,
          companyName: before.companyName,
          description: before.description,
          startDate: new Date(before.startDate),
          endDate: before.endDate ? new Date(before.endDate) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        em.persist(record)
      } else {
        record.member = member
        record.name = before.name
        record.companyName = before.companyName
        record.description = before.description
        record.startDate = new Date(before.startDate)
        record.endDate = before.endDate ? new Date(before.endDate) : null
      }
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'created',
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
        indexer: jobHistoryCrudIndexer,
      })
    },
  }

registerCommand(createJobHistoryCommand)
registerCommand(updateJobHistoryCommand)
registerCommand(deleteJobHistoryCommand)
