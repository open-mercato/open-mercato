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
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'
import { z } from 'zod'
import { EudrDueDiligenceStatement } from '../data/entities'
import {
  statementCreateSchema,
  statementUpdateSchema,
  type StatementCreateInput,
  type StatementUpdateInput,
} from '../data/validators'

const STATEMENT_ENTITY_ID = 'eudr:eudr_due_diligence_statement'

type ScopedCommandInput = {
  tenantId: string
  organizationId: string
}

type StatementSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  title: string
  commodity: string
  referenceNumber: string | null
  verificationNumber: string | null
  status: string
  quantityKg: string | null
  orderId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  custom?: Record<string, unknown> | null
}

type StatementUndoPayload = {
  before?: StatementSnapshot | null
  after?: StatementSnapshot | null
}

type ScopedStatementCreateInput = StatementCreateInput & ScopedCommandInput
type ScopedStatementUpdateInput = StatementUpdateInput & Partial<ScopedCommandInput>

type StatementCommandResult = {
  entityId: string
  updatedAt?: Date
}

const scopedCommandInputSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

const statementCrudIndexer: CrudIndexerConfig<EudrDueDiligenceStatement> = {
  entityType: E.eudr.eudr_due_diligence_statement,
}

const statementCrudEvents: CrudEventsConfig<EudrDueDiligenceStatement> = {
  module: 'eudr',
  entity: 'due_diligence_statement',
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

function toNumericString(value: number | null | undefined): string | null {
  return value == null ? null : String(value)
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null
}

function statementSeedFromSnapshot(snapshot: StatementSnapshot): RequiredEntityData<EudrDueDiligenceStatement> {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    title: snapshot.title,
    commodity: snapshot.commodity,
    referenceNumber: snapshot.referenceNumber,
    verificationNumber: snapshot.verificationNumber,
    status: snapshot.status,
    quantityKg: snapshot.quantityKg,
    orderId: snapshot.orderId,
    notes: snapshot.notes,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: toDate(snapshot.deletedAt),
  }
}

async function loadStatementSnapshot(em: EntityManager, entityId: string): Promise<StatementSnapshot | null> {
  const record = await em.findOne(EudrDueDiligenceStatement, { id: entityId })
  if (!record) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: STATEMENT_ENTITY_ID,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    title: record.title,
    commodity: record.commodity,
    referenceNumber: record.referenceNumber ?? null,
    verificationNumber: record.verificationNumber ?? null,
    status: record.status,
    quantityKg: record.quantityKg ?? null,
    orderId: record.orderId ?? null,
    notes: record.notes ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
    custom: Object.keys(custom).length ? custom : null,
  }
}

function applyStatementUpdate(record: EudrDueDiligenceStatement, parsed: StatementUpdateInput): void {
  if (parsed.title !== undefined) record.title = parsed.title
  if (parsed.commodity !== undefined) record.commodity = parsed.commodity
  if (parsed.referenceNumber !== undefined) record.referenceNumber = parsed.referenceNumber ?? null
  if (parsed.verificationNumber !== undefined) record.verificationNumber = parsed.verificationNumber ?? null
  if (parsed.status !== undefined) record.status = parsed.status
  if (parsed.quantityKg !== undefined) record.quantityKg = toNumericString(parsed.quantityKg)
  if (parsed.orderId !== undefined) record.orderId = parsed.orderId ?? null
  if (parsed.notes !== undefined) record.notes = parsed.notes ?? null
}

function restoreStatement(record: EudrDueDiligenceStatement, snapshot: StatementSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.title = snapshot.title
  record.commodity = snapshot.commodity
  record.referenceNumber = snapshot.referenceNumber
  record.verificationNumber = snapshot.verificationNumber
  record.status = snapshot.status
  record.quantityKg = snapshot.quantityKg
  record.orderId = snapshot.orderId
  record.notes = snapshot.notes
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = toDate(snapshot.deletedAt)
}

async function setStatementCustomFields(
  dataEngine: DataEngine,
  entityId: string,
  organizationId: string,
  tenantId: string,
  values: Record<string, unknown>,
): Promise<void> {
  await setCustomFieldsIfAny({
    dataEngine,
    entityId: STATEMENT_ENTITY_ID,
    recordId: entityId,
    organizationId,
    tenantId,
    values,
    notify: false,
  })
}

const createStatementCommand: CommandHandler<ScopedStatementCreateInput, StatementCommandResult> = {
  id: 'eudr.statements.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(statementCreateSchema, rawInput)
    const scope = parseScopedCommandInput(rawInput)
    ensureTenantScope(ctx, scope.tenantId)
    ensureOrganizationScope(ctx, scope.organizationId)

    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record!: EudrDueDiligenceStatement

    await runCrudCommandWrite({
      ctx,
      em: entityManager,
      entityId: STATEMENT_ENTITY_ID,
      action: 'created',
      scope,
      customFields: custom,
      events: statementCrudEvents,
      indexer: statementCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
      }),
      phases: [
        () => {
          record = entityManager.create(EudrDueDiligenceStatement, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            title: parsed.title,
            commodity: parsed.commodity,
            referenceNumber: parsed.referenceNumber ?? null,
            verificationNumber: parsed.verificationNumber ?? null,
            status: parsed.status ?? 'draft',
            quantityKg: toNumericString(parsed.quantityKg),
            orderId: parsed.orderId ?? null,
            notes: parsed.notes ?? null,
          })
          entityManager.persist(record)
        },
      ],
    })

    return { entityId: record.id }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    return loadStatementSnapshot(entityManager, result.entityId)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as StatementSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.statements.create', 'Create EUDR due diligence statement'),
      resourceKind: 'eudr.due_diligence_statement',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies StatementUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<StatementUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await entityManager.findOne(EudrDueDiligenceStatement, { id: after.id })
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    await setStatementCustomFields(dataEngine, after.id, after.organizationId, after.tenantId, resetValues)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: statementCrudIndexer,
      events: statementCrudEvents,
    })
  },
  redo: makeCreateRedo<EudrDueDiligenceStatement, StatementSnapshot, ScopedStatementCreateInput, StatementCommandResult>({
    entityClass: EudrDueDiligenceStatement,
    seedFromSnapshot: statementSeedFromSnapshot,
    buildResult: (entity) => ({ entityId: entity.id }),
    indexer: statementCrudIndexer,
    events: statementCrudEvents,
    afterRestore: async ({ ctx, entity, snapshot }) => {
      if (!snapshot.custom || !Object.keys(snapshot.custom).length) return
      await setStatementCustomFields(
        ctx.container.resolve('dataEngine') as DataEngine,
        entity.id,
        entity.organizationId,
        entity.tenantId,
        snapshot.custom,
      )
    },
  }),
}

const updateStatementCommand: CommandHandler<ScopedStatementUpdateInput, StatementCommandResult> = {
  id: 'eudr.statements.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(statementUpdateSchema, rawInput)
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadStatementSnapshot(entityManager, parsed.id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(statementUpdateSchema, rawInput)
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await entityManager.findOne(EudrDueDiligenceStatement, { id: parsed.id, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'EUDR due diligence statement not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    await runCrudCommandWrite({
      ctx,
      em: entityManager,
      entityId: STATEMENT_ENTITY_ID,
      action: 'updated',
      scope: { tenantId: record.tenantId, organizationId: record.organizationId },
      customFields: custom,
      events: statementCrudEvents,
      indexer: statementCrudIndexer,
      sideEffect: () => ({
        entity: record,
        identifiers: {
          id: record.id,
          organizationId: record.organizationId,
          tenantId: record.tenantId,
        },
      }),
      phases: [
        () => {
          applyStatementUpdate(record, parsed)
        },
      ],
    })

    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    return loadStatementSnapshot(entityManager, result.entityId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as StatementSnapshot | undefined
    const after = snapshots.after as StatementSnapshot | undefined
    if (!before) return null
    if (after && snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.statements.update', 'Update EUDR due diligence statement'),
      resourceKind: 'eudr.due_diligence_statement',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: {
        undo: { before, after: after ?? null } satisfies StatementUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<StatementUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await entityManager.findOne(EudrDueDiligenceStatement, { id: before.id })
    if (!record) {
      record = entityManager.create(EudrDueDiligenceStatement, statementSeedFromSnapshot(before))
      entityManager.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreStatement(record, before)
    }
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    await setStatementCustomFields(dataEngine, before.id, before.organizationId, before.tenantId, resetValues)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: statementCrudIndexer,
      events: statementCrudEvents,
    })
  },
}

const deleteStatementCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, StatementCommandResult> = {
  id: 'eudr.statements.delete',
  async prepare(input, ctx) {
    const entityId = requireId(input, 'EUDR due diligence statement id required')
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadStatementSnapshot(entityManager, entityId)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const entityId = requireId(input, 'EUDR due diligence statement id required')
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await entityManager.findOne(EudrDueDiligenceStatement, { id: entityId, deletedAt: null })
    if (!record) throw new CrudHttpError(404, { error: 'EUDR due diligence statement not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    const snapshot = await loadStatementSnapshot(entityManager, entityId)
    record.deletedAt = new Date()
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (snapshot?.custom) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      await setStatementCustomFields(dataEngine, snapshot.id, snapshot.organizationId, snapshot.tenantId, resetValues)
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
      indexer: statementCrudIndexer,
      events: statementCrudEvents,
    })
    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as StatementSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.statements.delete', 'Delete EUDR due diligence statement'),
      resourceKind: 'eudr.due_diligence_statement',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies StatementUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<StatementUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await entityManager.findOne(EudrDueDiligenceStatement, { id: before.id })
    if (!record) {
      record = entityManager.create(EudrDueDiligenceStatement, statementSeedFromSnapshot(before))
      entityManager.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreStatement(record, before)
    }
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (before.custom) {
      await setStatementCustomFields(dataEngine, before.id, before.organizationId, before.tenantId, before.custom)
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
      indexer: statementCrudIndexer,
      events: statementCrudEvents,
    })
  },
}

registerCommand(createStatementCommand)
registerCommand(updateStatementCommand)
registerCommand(deleteStatementCommand)
