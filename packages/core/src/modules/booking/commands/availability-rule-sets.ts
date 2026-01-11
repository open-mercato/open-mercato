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
import { BookingAvailabilityRuleSet, BookingResource, BookingTeamMember } from '../data/entities'
import {
  bookingAvailabilityRuleSetCreateSchema,
  bookingAvailabilityRuleSetUpdateSchema,
  type BookingAvailabilityRuleSetCreateInput,
  type BookingAvailabilityRuleSetUpdateInput,
} from '../data/validators'
import { ensureOrganizationScope, ensureTenantScope, extractUndoPayload } from './shared'
import { E } from '@/generated/entities.ids.generated'

const availabilityRuleSetCrudIndexer: CrudIndexerConfig<BookingAvailabilityRuleSet> = {
  entityType: E.booking.booking_availability_rule_set,
}

type AvailabilityRuleSetSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  description: string | null
  timezone: string
  deletedAt: string | null
  custom?: CustomFieldSnapshot
}

type AvailabilityRuleSetUndoPayload = {
  before?: AvailabilityRuleSetSnapshot | null
  after?: AvailabilityRuleSetSnapshot | null
}

async function loadAvailabilityRuleSetSnapshot(
  em: EntityManager,
  id: string,
): Promise<AvailabilityRuleSetSnapshot | null> {
  const ruleSet = await findOneWithDecryption(
    em,
    BookingAvailabilityRuleSet,
    { id },
    undefined,
    { tenantId: null, organizationId: null },
  )
  if (!ruleSet) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: E.booking.booking_availability_rule_set,
    recordId: ruleSet.id,
    tenantId: ruleSet.tenantId,
    organizationId: ruleSet.organizationId,
  })
  return {
    id: ruleSet.id,
    tenantId: ruleSet.tenantId,
    organizationId: ruleSet.organizationId,
    name: ruleSet.name,
    description: ruleSet.description ?? null,
    timezone: ruleSet.timezone,
    deletedAt: ruleSet.deletedAt ? ruleSet.deletedAt.toISOString() : null,
    custom,
  }
}

const createAvailabilityRuleSetCommand: CommandHandler<BookingAvailabilityRuleSetCreateInput, { ruleSetId: string }> = {
  id: 'booking.availability-rule-sets.create',
  async execute(input, ctx) {
    const { parsed, custom } = parseWithCustomFields(bookingAvailabilityRuleSetCreateSchema, input)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const record = em.create(BookingAvailabilityRuleSet, {
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      name: parsed.name,
      description: parsed.description ?? null,
      timezone: parsed.timezone,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    em.persist(record)
    await em.flush()
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.booking.booking_availability_rule_set,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: custom,
    })
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: availabilityRuleSetCrudIndexer,
    })
    return { ruleSetId: record.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAvailabilityRuleSetSnapshot(em, result.ruleSetId)
    if (!snapshot) return null
    return snapshot
  },
  buildLog: async ({ result, ctx }) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAvailabilityRuleSetSnapshot(em, result.ruleSetId)
    if (!snapshot) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.availabilityRuleSets.create', 'Create availability schedule'),
      resourceKind: 'booking.availabilityRuleSet',
      resourceId: snapshot.id,
      tenantId: snapshot.tenantId,
      organizationId: snapshot.organizationId,
      snapshotAfter: snapshot,
      payload: {
        undo: {
          after: snapshot,
        } satisfies AvailabilityRuleSetUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AvailabilityRuleSetUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const ruleSet = await em.findOne(BookingAvailabilityRuleSet, { id: after.id })
    if (ruleSet) {
      ruleSet.deletedAt = new Date()
      ruleSet.updatedAt = new Date()
      await em.flush()

      const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine,
        action: 'deleted',
        entity: ruleSet,
        identifiers: {
          id: ruleSet.id,
          organizationId: ruleSet.organizationId,
          tenantId: ruleSet.tenantId,
        },
        indexer: availabilityRuleSetCrudIndexer,
      })
    }
  },
}

const updateAvailabilityRuleSetCommand: CommandHandler<BookingAvailabilityRuleSetUpdateInput, { ruleSetId: string }> = {
  id: 'booking.availability-rule-sets.update',
  async prepare(input, ctx) {
    const { parsed } = parseWithCustomFields(bookingAvailabilityRuleSetUpdateSchema, input)
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAvailabilityRuleSetSnapshot(em, parsed.id)
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(input, ctx) {
    const { parsed, custom } = parseWithCustomFields(bookingAvailabilityRuleSetUpdateSchema, input)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(
      em,
      BookingAvailabilityRuleSet,
      { id: parsed.id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!record) throw new CrudHttpError(404, { error: 'Booking availability rule set not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.description !== undefined) record.description = parsed.description ?? null
    if (parsed.timezone !== undefined) record.timezone = parsed.timezone
    record.updatedAt = new Date()
    await em.flush()
    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await setCustomFieldsIfAny({
      dataEngine,
      entityId: E.booking.booking_availability_rule_set,
      recordId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      values: custom,
    })
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: availabilityRuleSetCrudIndexer,
    })
    return { ruleSetId: record.id }
  },
  buildLog: async ({ snapshots, ctx }) => {
    const before = snapshots.before as AvailabilityRuleSetSnapshot | undefined
    if (!before) return null
    const em = (ctx.container.resolve('em') as EntityManager)
    const after = await loadAvailabilityRuleSetSnapshot(em, before.id)
    if (!after) return null
    const changes = buildChanges(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, [
      'name',
      'description',
      'timezone',
      'deletedAt',
    ])
    const customChanges = diffCustomFieldChanges(before.custom, after.custom)
    if (Object.keys(customChanges).length) {
      changes.custom = customChanges
    }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.availabilityRuleSets.update', 'Update availability schedule'),
      resourceKind: 'booking.availabilityRuleSet',
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
        } satisfies AvailabilityRuleSetUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AvailabilityRuleSetUndoPayload>(logEntry)
    const before = payload?.before ?? (logEntry?.snapshotBefore as AvailabilityRuleSetSnapshot | null | undefined)
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const ruleSet = await em.findOne(BookingAvailabilityRuleSet, { id: before.id })
    if (!ruleSet) return
    ruleSet.name = before.name
    ruleSet.description = before.description ?? null
    ruleSet.timezone = before.timezone
    ruleSet.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
    ruleSet.updatedAt = new Date()
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    const afterSnapshot = payload?.after ?? (logEntry?.snapshotAfter as AvailabilityRuleSetSnapshot | null | undefined)
    if (before.custom || afterSnapshot?.custom) {
      const reset = buildCustomFieldResetMap(before.custom, afterSnapshot?.custom)
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.booking.booking_availability_rule_set,
        recordId: ruleSet.id,
        tenantId: ruleSet.tenantId,
        organizationId: ruleSet.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: ruleSet,
      identifiers: {
        id: ruleSet.id,
        organizationId: ruleSet.organizationId,
        tenantId: ruleSet.tenantId,
      },
      indexer: availabilityRuleSetCrudIndexer,
    })
  },
}

const deleteAvailabilityRuleSetCommand: CommandHandler<{ id?: string }, { ruleSetId: string }> = {
  id: 'booking.availability-rule-sets.delete',
  async prepare(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Availability rule set id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadAvailabilityRuleSetSnapshot(em, id)
    if (!snapshot) return {}
    return { before: snapshot }
  },
  async execute(input, ctx) {
    const id = input?.id
    if (!id) throw new CrudHttpError(400, { error: 'Availability rule set id is required.' })
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findOneWithDecryption(
      em,
      BookingAvailabilityRuleSet,
      { id, deletedAt: null },
      undefined,
      { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.auth?.orgId ?? null },
    )
    if (!record) throw new CrudHttpError(404, { error: 'Booking availability rule set not found.' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    const assignedResourceCount = await em.count(BookingResource, {
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      availabilityRuleSetId: record.id,
      deletedAt: null,
    })
    const assignedMemberCount = await em.count(BookingTeamMember, {
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      availabilityRuleSetId: record.id,
      deletedAt: null,
    })
    if (assignedResourceCount > 0 || assignedMemberCount > 0) {
      const { t } = await resolveTranslations()
      throw new CrudHttpError(409, {
        error: t(
          'booking.availabilityRuleSets.errors.assigned',
          'Schedule is assigned to a resource or team member and cannot be deleted.',
        ),
      })
    }

    record.deletedAt = new Date()
    record.updatedAt = new Date()
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: availabilityRuleSetCrudIndexer,
    })
    return { ruleSetId: record.id }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as AvailabilityRuleSetSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('booking.audit.availabilityRuleSets.delete', 'Delete availability schedule'),
      resourceKind: 'booking.availabilityRuleSet',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: {
          before,
        } satisfies AvailabilityRuleSetUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<AvailabilityRuleSetUndoPayload>(logEntry)
    const before = payload?.before ?? (logEntry?.snapshotBefore as AvailabilityRuleSetSnapshot | null | undefined)
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    let ruleSet = await em.findOne(BookingAvailabilityRuleSet, { id: before.id })
    if (!ruleSet) {
      ruleSet = em.create(BookingAvailabilityRuleSet, {
        id: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        name: before.name,
        description: before.description ?? null,
        timezone: before.timezone,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(ruleSet)
    } else {
      ruleSet.name = before.name
      ruleSet.description = before.description ?? null
      ruleSet.timezone = before.timezone
      ruleSet.deletedAt = null
      ruleSet.updatedAt = new Date()
    }
    await em.flush()

    const dataEngine = (ctx.container.resolve('dataEngine') as DataEngine)
    if (before.custom) {
      const reset = buildCustomFieldResetMap(before.custom, undefined)
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.booking.booking_availability_rule_set,
        recordId: ruleSet.id,
        tenantId: ruleSet.tenantId,
        organizationId: ruleSet.organizationId,
        values: reset,
      })
    }

    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'created',
      entity: ruleSet,
      identifiers: {
        id: ruleSet.id,
        organizationId: ruleSet.organizationId,
        tenantId: ruleSet.tenantId,
      },
      indexer: availabilityRuleSetCrudIndexer,
    })
  },
}

registerCommand(createAvailabilityRuleSetCommand)
registerCommand(updateAvailabilityRuleSetCommand)
registerCommand(deleteAvailabilityRuleSetCommand)
