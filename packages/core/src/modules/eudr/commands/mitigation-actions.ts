import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { RequiredEntityData } from '@mikro-orm/core'
import {
  parseWithCustomFields,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  requireId,
  setCustomFieldsIfAny,
  snapshotsEqual,
} from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { makeCreateRedo } from '@open-mercato/shared/lib/commands/redo'
import { runCrudCommandWrite } from '@open-mercato/shared/lib/commands/runCrudCommandWrite'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { emitEudrLifecycleEvent } from './lifecycle-events'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { EudrMitigationAction, EudrRiskAssessment } from '../data/entities'
import {
  mitigationActionCreateSchema,
  mitigationActionUpdateSchema,
  type MitigationActionCreateInput,
  type MitigationActionUpdateInput,
} from '../data/validators'

const MITIGATION_ACTION_ENTITY_ID = 'eudr:eudr_mitigation_action'

type ScopedCommandInput = {
  tenantId: string
  organizationId: string
}

type MitigationActionSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  riskAssessmentId: string
  actionType: string
  title: string
  description: string | null
  status: string
  dueDate: string | null
  completedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  custom?: Record<string, unknown> | null
}

type MitigationActionUndoPayload = {
  before?: MitigationActionSnapshot | null
  after?: MitigationActionSnapshot | null
}

type ScopedMitigationActionCreateInput = MitigationActionCreateInput & ScopedCommandInput
type ScopedMitigationActionUpdateInput = MitigationActionUpdateInput & Partial<ScopedCommandInput>

type MitigationActionCommandResult = {
  entityId: string
  updatedAt?: Date
}

const scopedCommandInputSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

const mitigationActionCrudIndexer: CrudIndexerConfig<EudrMitigationAction> = {
  entityType: E.eudr.eudr_mitigation_action,
}

const mitigationActionCrudEvents: CrudEventsConfig<EudrMitigationAction> = {
  module: 'eudr',
  entity: 'mitigation_action',
  persistent: true,
  buildPayload: (emitContext) => ({
    id: emitContext.identifiers.id,
    entityId: emitContext.entity?.id ?? emitContext.identifiers.id,
    organizationId: emitContext.identifiers.organizationId,
    tenantId: emitContext.identifiers.tenantId,
  }),
}

function parseScopedCommandInput(input: unknown): ScopedCommandInput {
  return scopedCommandInputSchema.parse(input)
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

async function requireRiskAssessmentInScope(
  em: EntityManager,
  riskAssessmentId: string,
  scope: ScopedCommandInput,
): Promise<EudrRiskAssessment> {
  const assessment = await findOneWithDecryption(
    em,
    EudrRiskAssessment,
    {
      id: riskAssessmentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!assessment) throw new CrudHttpError(400, { error: 'eudr.errors.riskAssessmentNotFound' })
  return assessment
}

function mitigationActionSeedFromSnapshot(snapshot: MitigationActionSnapshot): RequiredEntityData<EudrMitigationAction> {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    riskAssessmentId: snapshot.riskAssessmentId,
    actionType: snapshot.actionType,
    title: snapshot.title,
    description: snapshot.description,
    status: snapshot.status,
    dueDate: toDate(snapshot.dueDate),
    completedAt: toDate(snapshot.completedAt),
    notes: snapshot.notes,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: toDate(snapshot.deletedAt),
  }
}

async function findMitigationAction(
  em: EntityManager,
  entityId: string,
  includeDeleted = true,
): Promise<EudrMitigationAction | null> {
  return includeDeleted
    ? findOneWithDecryption(em, EudrMitigationAction, { id: entityId })
    : findOneWithDecryption(em, EudrMitigationAction, { id: entityId, deletedAt: null })
}

async function loadMitigationActionSnapshot(em: EntityManager, entityId: string): Promise<MitigationActionSnapshot | null> {
  const record = await findMitigationAction(em, entityId)
  if (!record) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: MITIGATION_ACTION_ENTITY_ID,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    riskAssessmentId: record.riskAssessmentId,
    actionType: record.actionType,
    title: record.title,
    description: record.description ?? null,
    status: record.status,
    dueDate: record.dueDate ? record.dueDate.toISOString() : null,
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    notes: record.notes ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
    custom: Object.keys(custom).length ? custom : null,
  }
}

function restoreMitigationAction(record: EudrMitigationAction, snapshot: MitigationActionSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.riskAssessmentId = snapshot.riskAssessmentId
  record.actionType = snapshot.actionType
  record.title = snapshot.title
  record.description = snapshot.description
  record.status = snapshot.status
  record.dueDate = toDate(snapshot.dueDate)
  record.completedAt = toDate(snapshot.completedAt)
  record.notes = snapshot.notes
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = toDate(snapshot.deletedAt)
}

async function setMitigationActionCustomFields(
  dataEngine: DataEngine,
  entityId: string,
  organizationId: string,
  tenantId: string,
  values: Record<string, unknown>,
): Promise<void> {
  await setCustomFieldsIfAny({
    dataEngine,
    entityId: MITIGATION_ACTION_ENTITY_ID,
    recordId: entityId,
    organizationId,
    tenantId,
    values,
    notify: false,
  })
}

const createMitigationActionCommand: CommandHandler<ScopedMitigationActionCreateInput, MitigationActionCommandResult> = {
  id: 'eudr.mitigation_actions.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(mitigationActionCreateSchema, rawInput)
    const scope = parseScopedCommandInput(rawInput)
    ensureTenantScope(ctx, scope.tenantId)
    ensureOrganizationScope(ctx, scope.organizationId)

    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record!: EudrMitigationAction

    await runCrudCommandWrite({
      ctx,
      em: entityManager,
      entityId: MITIGATION_ACTION_ENTITY_ID,
      action: 'created',
      scope,
      customFields: custom,
      events: mitigationActionCrudEvents,
      indexer: mitigationActionCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
      }),
      phases: [
        async () => {
          await requireRiskAssessmentInScope(entityManager, parsed.riskAssessmentId, scope)
          const status = parsed.status ?? 'planned'
          record = entityManager.create(EudrMitigationAction, {
            id: randomUUID(),
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            riskAssessmentId: parsed.riskAssessmentId,
            actionType: parsed.actionType ?? 'other',
            title: parsed.title,
            description: parsed.description ?? null,
            status,
            dueDate: parsed.dueDate ?? null,
            completedAt: status === 'completed' ? new Date() : null,
            notes: parsed.notes ?? null,
          })
          entityManager.persist(record)
        },
      ],
    })

    if (record.status === 'completed') {
      await emitEudrLifecycleEvent(ctx.container, 'eudr.mitigation_action.completed', {
        id: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
        title: record.title,
        riskAssessmentId: record.riskAssessmentId,
      })
    }

    return { entityId: record.id }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    return loadMitigationActionSnapshot(entityManager, result.entityId)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as MitigationActionSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.mitigation_actions.create', 'Create EUDR mitigation action'),
      resourceKind: 'eudr.mitigation_action',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies MitigationActionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<MitigationActionUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findMitigationAction(entityManager, after.id)
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    await setMitigationActionCustomFields(dataEngine, after.id, after.organizationId, after.tenantId, resetValues)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: mitigationActionCrudIndexer,
      events: mitigationActionCrudEvents,
    })
  },
  redo: makeCreateRedo<EudrMitigationAction, MitigationActionSnapshot, ScopedMitigationActionCreateInput, MitigationActionCommandResult>({
    entityClass: EudrMitigationAction,
    seedFromSnapshot: mitigationActionSeedFromSnapshot,
    buildResult: (entity) => ({ entityId: entity.id }),
    indexer: mitigationActionCrudIndexer,
    events: mitigationActionCrudEvents,
    findRow: ({ em, id }) => findMitigationAction(em, id),
    afterRestore: async ({ ctx, entity, snapshot }) => {
      if (!snapshot.custom || !Object.keys(snapshot.custom).length) return
      await setMitigationActionCustomFields(
        ctx.container.resolve('dataEngine') as DataEngine,
        entity.id,
        entity.organizationId,
        entity.tenantId,
        snapshot.custom,
      )
    },
  }),
}

const updateMitigationActionCommand: CommandHandler<ScopedMitigationActionUpdateInput, MitigationActionCommandResult> = {
  id: 'eudr.mitigation_actions.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(mitigationActionUpdateSchema, rawInput)
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadMitigationActionSnapshot(entityManager, parsed.id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(mitigationActionUpdateSchema, rawInput)
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findMitigationAction(entityManager, parsed.id, false)
    if (!record) throw new CrudHttpError(404, { error: 'eudr.errors.mitigationActionNotFound' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const scope = { tenantId: record.tenantId, organizationId: record.organizationId }
    const wasCompleted = record.status === 'completed'

    await runCrudCommandWrite({
      ctx,
      em: entityManager,
      entityId: MITIGATION_ACTION_ENTITY_ID,
      action: 'updated',
      scope,
      customFields: custom,
      events: mitigationActionCrudEvents,
      indexer: mitigationActionCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
      }),
      phases: [
        async () => {
          const nextRiskAssessmentId = parsed.riskAssessmentId ?? record.riskAssessmentId
          await requireRiskAssessmentInScope(entityManager, nextRiskAssessmentId, scope)
          if (parsed.riskAssessmentId !== undefined) record.riskAssessmentId = parsed.riskAssessmentId
          if (parsed.actionType !== undefined) record.actionType = parsed.actionType ?? 'other'
          if (parsed.title !== undefined) record.title = parsed.title
          if (parsed.description !== undefined) record.description = parsed.description ?? null
          if (parsed.status !== undefined) {
            const previousStatus = record.status
            record.status = parsed.status
            if (record.status === 'completed' && previousStatus !== 'completed') {
              record.completedAt = new Date()
            } else if (record.status !== 'completed') {
              record.completedAt = null
            }
          }
          if (parsed.dueDate !== undefined) record.dueDate = parsed.dueDate ?? null
          if (parsed.notes !== undefined) record.notes = parsed.notes ?? null
        },
      ],
    })

    if (record.status === 'completed' && !wasCompleted) {
      await emitEudrLifecycleEvent(ctx.container, 'eudr.mitigation_action.completed', {
        id: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
        title: record.title,
        riskAssessmentId: record.riskAssessmentId,
      })
    }

    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    return loadMitigationActionSnapshot(entityManager, result.entityId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as MitigationActionSnapshot | undefined
    const after = snapshots.after as MitigationActionSnapshot | undefined
    if (!before) return null
    if (after && snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.mitigation_actions.update', 'Update EUDR mitigation action'),
      resourceKind: 'eudr.mitigation_action',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: {
        undo: { before, after: after ?? null } satisfies MitigationActionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<MitigationActionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await findMitigationAction(entityManager, before.id)
    if (!record) {
      record = entityManager.create(EudrMitigationAction, mitigationActionSeedFromSnapshot(before))
      entityManager.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreMitigationAction(record, before)
    }
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    await setMitigationActionCustomFields(dataEngine, before.id, before.organizationId, before.tenantId, resetValues)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: mitigationActionCrudIndexer,
      events: mitigationActionCrudEvents,
    })
  },
}

const deleteMitigationActionCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, MitigationActionCommandResult> = {
  id: 'eudr.mitigation_actions.delete',
  async prepare(input, ctx) {
    const entityId = requireId(input, 'eudr.errors.mitigationActionIdRequired')
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadMitigationActionSnapshot(entityManager, entityId)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const entityId = requireId(input, 'eudr.errors.mitigationActionIdRequired')
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findMitigationAction(entityManager, entityId, false)
    if (!record) throw new CrudHttpError(404, { error: 'eudr.errors.mitigationActionNotFound' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    const snapshot = await loadMitigationActionSnapshot(entityManager, entityId)
    record.deletedAt = new Date()
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (snapshot?.custom) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      await setMitigationActionCustomFields(dataEngine, snapshot.id, snapshot.organizationId, snapshot.tenantId, resetValues)
    }
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: mitigationActionCrudIndexer,
      events: mitigationActionCrudEvents,
    })
    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as MitigationActionSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.mitigation_actions.delete', 'Delete EUDR mitigation action'),
      resourceKind: 'eudr.mitigation_action',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies MitigationActionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<MitigationActionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await findMitigationAction(entityManager, before.id)
    if (!record) {
      record = entityManager.create(EudrMitigationAction, mitigationActionSeedFromSnapshot(before))
      entityManager.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreMitigationAction(record, before)
    }
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (before.custom) {
      await setMitigationActionCustomFields(dataEngine, before.id, before.organizationId, before.tenantId, before.custom)
    }
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'created',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: mitigationActionCrudIndexer,
      events: mitigationActionCrudEvents,
    })
  },
}

registerCommand(createMitigationActionCommand)
registerCommand(updateMitigationActionCommand)
registerCommand(deleteMitigationActionCommand)
