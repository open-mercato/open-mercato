import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { PlannerAvailabilityRule } from '../data/entities'
import {
  plannerAvailabilityRuleCreateSchema,
  plannerAvailabilityRuleUpdateSchema,
  type PlannerAvailabilityRuleCreateInput,
  type PlannerAvailabilityRuleUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope } from './shared'
import type { PlannerAvailabilityKind, PlannerAvailabilitySubjectType } from '../data/entities'
import { extractUndoPayload } from './shared'

type AvailabilityRuleSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  subjectType: PlannerAvailabilitySubjectType
  subjectId: string
  timezone: string
  rrule: string
  exdates: string[]
  kind: PlannerAvailabilityKind
  note: string | null
  deletedAt: Date | null
}

type AvailabilityRuleUndoPayload = {
  before?: AvailabilityRuleSnapshot | null
  after?: AvailabilityRuleSnapshot | null
}

async function loadAvailabilityRuleSnapshot(em: EntityManager, id: string): Promise<AvailabilityRuleSnapshot | null> {
  const record = await em.findOne(PlannerAvailabilityRule, { id })
  if (!record) return null
  return {
    id: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    timezone: record.timezone,
    rrule: record.rrule,
    exdates: [...(record.exdates ?? [])],
    kind: record.kind,
    note: record.note ?? null,
    deletedAt: record.deletedAt ?? null,
  }
}

async function restoreAvailabilityRuleFromSnapshot(em: EntityManager, snapshot: AvailabilityRuleSnapshot): Promise<void> {
  let record = await em.findOne(PlannerAvailabilityRule, { id: snapshot.id })
  if (!record) {
    record = em.create(PlannerAvailabilityRule, {
      id: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      subjectType: snapshot.subjectType,
      subjectId: snapshot.subjectId,
      timezone: snapshot.timezone,
      rrule: snapshot.rrule,
      exdates: snapshot.exdates ?? [],
      kind: snapshot.kind ?? 'availability',
      note: snapshot.note ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(record)
  } else {
    record.subjectType = snapshot.subjectType
    record.subjectId = snapshot.subjectId
    record.timezone = snapshot.timezone
    record.rrule = snapshot.rrule
    record.exdates = snapshot.exdates ?? []
    record.kind = snapshot.kind ?? 'availability'
    record.note = snapshot.note ?? null
    record.deletedAt = snapshot.deletedAt ?? null
  }
}

const createAvailabilityRuleCommand: CommandHandler<PlannerAvailabilityRuleCreateInput, { ruleId: string }> = {
  id: 'planner.availability.create',
  async execute(input, ctx) {
    const parsed = plannerAvailabilityRuleCreateSchema.parse(input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const record = em.create(PlannerAvailabilityRule, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      timezone: parsed.timezone,
      rrule: parsed.rrule,
      exdates: parsed.exdates ?? [],
      kind: parsed.kind ?? 'availability',
      note: parsed.note ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(record)
    await em.flush()
    return { ruleId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return loadAvailabilityRuleSnapshot(em, result.ruleId)
  },
  buildLog: async ({ input, result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAvailabilityRuleSnapshot(em, result?.ruleId ?? '')
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('planner.audit.availability.create', 'Create availability rule'),
      resourceKind: 'planner.availability',
      resourceId: result?.ruleId ?? null,
      tenantId: input?.tenantId ?? ctx.auth?.tenantId ?? null,
      organizationId: input?.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot,
        } satisfies AvailabilityRuleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const ruleId = logEntry?.resourceId ?? null
    if (!ruleId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(PlannerAvailabilityRule, { id: ruleId })
    if (record) {
      record.deletedAt = new Date()
      await em.flush()
    }
  },
}

const updateAvailabilityRuleCommand: CommandHandler<PlannerAvailabilityRuleUpdateInput, { ruleId: string }> = {
  id: 'planner.availability.update',
  async prepare(input, ctx) {
    const parsed = plannerAvailabilityRuleUpdateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAvailabilityRuleSnapshot(em, parsed.id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const parsed = plannerAvailabilityRuleUpdateSchema.parse(input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(PlannerAvailabilityRule, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'Planner availability rule not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.subjectType !== undefined) record.subjectType = parsed.subjectType
    if (parsed.subjectId !== undefined) record.subjectId = parsed.subjectId
    if (parsed.timezone !== undefined) record.timezone = parsed.timezone
    if (parsed.rrule !== undefined) record.rrule = parsed.rrule
    if (parsed.exdates !== undefined) record.exdates = parsed.exdates
    if (parsed.kind !== undefined) record.kind = parsed.kind
    if (parsed.note !== undefined) record.note = parsed.note ?? null

    await em.flush()
    return { ruleId: record.id }
  },
  buildLog: async ({ snapshots, input, result, ctx }) => {
    const before = snapshots.before as AvailabilityRuleSnapshot | undefined
    const em = (ctx.container.resolve('em') as EntityManager)
    const afterSnapshot = before ? await loadAvailabilityRuleSnapshot(em, before.id) : null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('planner.audit.availability.update', 'Update availability rule'),
      resourceKind: 'planner.availability',
      resourceId: result?.ruleId ?? input?.id ?? null,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      snapshotBefore: before ?? null,
      snapshotAfter: afterSnapshot ?? null,
      payload: {
        undo: {
          before: before ?? null,
          after: afterSnapshot ?? null,
        } satisfies AvailabilityRuleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AvailabilityRuleUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await restoreAvailabilityRuleFromSnapshot(em, before)
    await em.flush()
  },
}

const deleteAvailabilityRuleCommand: CommandHandler<{ id?: string }, { ruleId: string }> = {
  id: 'planner.availability.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) return {}
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAvailabilityRuleSnapshot(em, id)
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Availability rule id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await em.findOne(PlannerAvailabilityRule, { id, deletedAt: null })
    if (!record) return { ruleId: id }
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await em.flush()
    return { ruleId: record.id }
  },
  buildLog: async ({ snapshots, input, result, ctx }) => {
    const before = snapshots.before as AvailabilityRuleSnapshot | undefined
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('planner.audit.availability.delete', 'Delete availability rule'),
      resourceKind: 'planner.availability',
      resourceId: result?.ruleId ?? input?.id ?? null,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null,
      snapshotBefore: before ?? null,
      payload: {
        undo: {
          before: before ?? null,
        } satisfies AvailabilityRuleUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AvailabilityRuleUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await restoreAvailabilityRuleFromSnapshot(em, { ...before, deletedAt: null })
    await em.flush()
  },
}

registerCommand(createAvailabilityRuleCommand)
registerCommand(updateAvailabilityRuleCommand)
registerCommand(deleteAvailabilityRuleCommand)
