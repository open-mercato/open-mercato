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
import { decryptEntitiesWithFallbackScope } from '@open-mercato/shared/lib/encryption/subscriber'
import { E } from '#generated/entities.ids.generated'
import { z } from 'zod'
import { EudrEvidenceSubmission } from '../data/entities'
import {
  evidenceSubmissionCreateSchema,
  evidenceSubmissionUpdateSchema,
  type EvidenceSubmissionCreateInput,
  type EvidenceSubmissionUpdateInput,
} from '../data/validators'
import { computeSubmissionCompleteness } from '../lib/completeness'

const EVIDENCE_SUBMISSION_ENTITY_ID = 'eudr:eudr_evidence_submission'

type ScopedCommandInput = {
  tenantId: string
  organizationId: string
}

type SupplierSnapshot = {
  displayName?: string | null
}

type EvidenceSubmissionSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  supplierEntityId: string
  supplierSnapshot: SupplierSnapshot | null
  commodity: string
  productMappingId: string | null
  statementId: string | null
  originCountry: string | null
  geolocation: Record<string, unknown> | null
  quantityKg: string | null
  batchNumber: string | null
  harvestFrom: string | null
  harvestTo: string | null
  producerName: string | null
  attachmentIds: string[]
  status: string
  completenessScore: number
  missingFields: string[]
  notes: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  custom?: Record<string, unknown> | null
}

type EvidenceSubmissionUndoPayload = {
  before?: EvidenceSubmissionSnapshot | null
  after?: EvidenceSubmissionSnapshot | null
}

type ScopedEvidenceSubmissionCreateInput = EvidenceSubmissionCreateInput & ScopedCommandInput
type ScopedEvidenceSubmissionUpdateInput = EvidenceSubmissionUpdateInput & Partial<ScopedCommandInput>

type EvidenceSubmissionCommandResult = {
  entityId: string
  updatedAt?: Date
}

const scopedCommandInputSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

const evidenceSubmissionCrudIndexer: CrudIndexerConfig<EudrEvidenceSubmission> = {
  entityType: E.eudr.eudr_evidence_submission,
}

const evidenceSubmissionCrudEvents: CrudEventsConfig<EudrEvidenceSubmission> = {
  module: 'eudr',
  entity: 'evidence_submission',
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

function evidenceSubmissionSeedFromSnapshot(snapshot: EvidenceSubmissionSnapshot): RequiredEntityData<EudrEvidenceSubmission> {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    supplierEntityId: snapshot.supplierEntityId,
    supplierSnapshot: snapshot.supplierSnapshot,
    commodity: snapshot.commodity,
    productMappingId: snapshot.productMappingId,
    statementId: snapshot.statementId,
    originCountry: snapshot.originCountry,
    geolocation: snapshot.geolocation,
    quantityKg: snapshot.quantityKg,
    batchNumber: snapshot.batchNumber,
    harvestFrom: toDate(snapshot.harvestFrom),
    harvestTo: toDate(snapshot.harvestTo),
    producerName: snapshot.producerName,
    attachmentIds: snapshot.attachmentIds,
    status: snapshot.status,
    completenessScore: snapshot.completenessScore,
    missingFields: snapshot.missingFields,
    notes: snapshot.notes,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: toDate(snapshot.deletedAt),
  }
}

async function findEvidenceSubmission(
  em: EntityManager,
  entityId: string,
  includeDeleted = true,
): Promise<EudrEvidenceSubmission | null> {
  const where = includeDeleted ? { id: entityId } : { id: entityId, deletedAt: null }
  const record = await em.findOne(EudrEvidenceSubmission, where)
  if (!record) return null
  await decryptEntitiesWithFallbackScope(record, {
    em,
    tenantId: record.tenantId ?? null,
    organizationId: record.organizationId ?? null,
  })
  return record
}

async function loadEvidenceSubmissionSnapshot(em: EntityManager, entityId: string): Promise<EvidenceSubmissionSnapshot | null> {
  const record = await findEvidenceSubmission(em, entityId)
  if (!record) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: EVIDENCE_SUBMISSION_ENTITY_ID,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    supplierEntityId: record.supplierEntityId,
    supplierSnapshot: record.supplierSnapshot ?? null,
    commodity: record.commodity,
    productMappingId: record.productMappingId ?? null,
    statementId: record.statementId ?? null,
    originCountry: record.originCountry ?? null,
    geolocation: record.geolocation ?? null,
    quantityKg: record.quantityKg ?? null,
    batchNumber: record.batchNumber ?? null,
    harvestFrom: record.harvestFrom ? record.harvestFrom.toISOString() : null,
    harvestTo: record.harvestTo ? record.harvestTo.toISOString() : null,
    producerName: record.producerName ?? null,
    attachmentIds: Array.isArray(record.attachmentIds) ? [...record.attachmentIds] : [],
    status: record.status,
    completenessScore: record.completenessScore,
    missingFields: Array.isArray(record.missingFields) ? [...record.missingFields] : [],
    notes: record.notes ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
    custom: Object.keys(custom).length ? custom : null,
  }
}

function refreshSubmissionCompleteness(record: EudrEvidenceSubmission): void {
  const completeness = computeSubmissionCompleteness({
    originCountry: record.originCountry ?? null,
    geolocation: record.geolocation ?? null,
    quantityKg: record.quantityKg ?? null,
    harvestFrom: record.harvestFrom ?? null,
    harvestTo: record.harvestTo ?? null,
    producerName: record.producerName ?? null,
    attachmentIds: record.attachmentIds ?? [],
  })
  record.completenessScore = completeness.score
  record.missingFields = [...completeness.missingFields]
}

function applySubmissionUpdate(record: EudrEvidenceSubmission, parsed: EvidenceSubmissionUpdateInput): void {
  if (parsed.supplierEntityId !== undefined) record.supplierEntityId = parsed.supplierEntityId
  if (parsed.supplierSnapshot !== undefined) record.supplierSnapshot = parsed.supplierSnapshot ?? null
  if (parsed.commodity !== undefined) record.commodity = parsed.commodity
  if (parsed.productMappingId !== undefined) record.productMappingId = parsed.productMappingId ?? null
  if (parsed.statementId !== undefined) record.statementId = parsed.statementId ?? null
  if (parsed.originCountry !== undefined) record.originCountry = parsed.originCountry ?? null
  if (parsed.geolocation !== undefined) record.geolocation = parsed.geolocation ?? null
  if (parsed.quantityKg !== undefined) record.quantityKg = toNumericString(parsed.quantityKg)
  if (parsed.batchNumber !== undefined) record.batchNumber = parsed.batchNumber ?? null
  if (parsed.harvestFrom !== undefined) record.harvestFrom = parsed.harvestFrom ?? null
  if (parsed.harvestTo !== undefined) record.harvestTo = parsed.harvestTo ?? null
  if (parsed.producerName !== undefined) record.producerName = parsed.producerName ?? null
  if (parsed.attachmentIds !== undefined) record.attachmentIds = [...parsed.attachmentIds]
  if (parsed.status !== undefined) record.status = parsed.status
  if (parsed.notes !== undefined) record.notes = parsed.notes ?? null
}

function restoreEvidenceSubmission(record: EudrEvidenceSubmission, snapshot: EvidenceSubmissionSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.supplierEntityId = snapshot.supplierEntityId
  record.supplierSnapshot = snapshot.supplierSnapshot
  record.commodity = snapshot.commodity
  record.productMappingId = snapshot.productMappingId
  record.statementId = snapshot.statementId
  record.originCountry = snapshot.originCountry
  record.geolocation = snapshot.geolocation
  record.quantityKg = snapshot.quantityKg
  record.batchNumber = snapshot.batchNumber
  record.harvestFrom = toDate(snapshot.harvestFrom)
  record.harvestTo = toDate(snapshot.harvestTo)
  record.producerName = snapshot.producerName
  record.attachmentIds = [...snapshot.attachmentIds]
  record.status = snapshot.status
  record.completenessScore = snapshot.completenessScore
  record.missingFields = [...snapshot.missingFields]
  record.notes = snapshot.notes
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = toDate(snapshot.deletedAt)
}

async function setEvidenceSubmissionCustomFields(
  dataEngine: DataEngine,
  entityId: string,
  organizationId: string,
  tenantId: string,
  values: Record<string, unknown>,
): Promise<void> {
  await setCustomFieldsIfAny({
    dataEngine,
    entityId: EVIDENCE_SUBMISSION_ENTITY_ID,
    recordId: entityId,
    organizationId,
    tenantId,
    values,
    notify: false,
  })
}

const createEvidenceSubmissionCommand: CommandHandler<ScopedEvidenceSubmissionCreateInput, EvidenceSubmissionCommandResult> = {
  id: 'eudr.evidence_submissions.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(evidenceSubmissionCreateSchema, rawInput)
    const scope = parseScopedCommandInput(rawInput)
    ensureTenantScope(ctx, scope.tenantId)
    ensureOrganizationScope(ctx, scope.organizationId)

    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record!: EudrEvidenceSubmission

    await runCrudCommandWrite({
      ctx,
      em: entityManager,
      entityId: EVIDENCE_SUBMISSION_ENTITY_ID,
      action: 'created',
      scope,
      customFields: custom,
      events: evidenceSubmissionCrudEvents,
      indexer: evidenceSubmissionCrudIndexer,
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
          record = entityManager.create(EudrEvidenceSubmission, {
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            supplierEntityId: parsed.supplierEntityId,
            supplierSnapshot: parsed.supplierSnapshot ?? null,
            commodity: parsed.commodity,
            productMappingId: parsed.productMappingId ?? null,
            statementId: parsed.statementId ?? null,
            originCountry: parsed.originCountry ?? null,
            geolocation: parsed.geolocation ?? null,
            quantityKg: toNumericString(parsed.quantityKg),
            batchNumber: parsed.batchNumber ?? null,
            harvestFrom: parsed.harvestFrom ?? null,
            harvestTo: parsed.harvestTo ?? null,
            producerName: parsed.producerName ?? null,
            attachmentIds: parsed.attachmentIds ? [...parsed.attachmentIds] : [],
            status: parsed.status ?? 'draft',
            notes: parsed.notes ?? null,
          })
          refreshSubmissionCompleteness(record)
          entityManager.persist(record)
        },
      ],
    })

    return { entityId: record.id }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    return loadEvidenceSubmissionSnapshot(entityManager, result.entityId)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as EvidenceSubmissionSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.evidence_submissions.create', 'Create EUDR evidence submission'),
      resourceKind: 'eudr.evidence_submission',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies EvidenceSubmissionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<EvidenceSubmissionUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findEvidenceSubmission(entityManager, after.id)
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    await setEvidenceSubmissionCustomFields(dataEngine, after.id, after.organizationId, after.tenantId, resetValues)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: evidenceSubmissionCrudIndexer,
      events: evidenceSubmissionCrudEvents,
    })
  },
  redo: makeCreateRedo<EudrEvidenceSubmission, EvidenceSubmissionSnapshot, ScopedEvidenceSubmissionCreateInput, EvidenceSubmissionCommandResult>({
    entityClass: EudrEvidenceSubmission,
    seedFromSnapshot: evidenceSubmissionSeedFromSnapshot,
    buildResult: (entity) => ({ entityId: entity.id }),
    indexer: evidenceSubmissionCrudIndexer,
    events: evidenceSubmissionCrudEvents,
    findRow: ({ em, id }) => findEvidenceSubmission(em, id),
    afterRestore: async ({ ctx, entity, snapshot }) => {
      if (!snapshot.custom || !Object.keys(snapshot.custom).length) return
      await setEvidenceSubmissionCustomFields(
        ctx.container.resolve('dataEngine') as DataEngine,
        entity.id,
        entity.organizationId,
        entity.tenantId,
        snapshot.custom,
      )
    },
  }),
}

const updateEvidenceSubmissionCommand: CommandHandler<ScopedEvidenceSubmissionUpdateInput, EvidenceSubmissionCommandResult> = {
  id: 'eudr.evidence_submissions.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(evidenceSubmissionUpdateSchema, rawInput)
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadEvidenceSubmissionSnapshot(entityManager, parsed.id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(evidenceSubmissionUpdateSchema, rawInput)
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findEvidenceSubmission(entityManager, parsed.id, false)
    if (!record) throw new CrudHttpError(404, { error: 'EUDR evidence submission not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    await runCrudCommandWrite({
      ctx,
      em: entityManager,
      entityId: EVIDENCE_SUBMISSION_ENTITY_ID,
      action: 'updated',
      scope: { tenantId: record.tenantId, organizationId: record.organizationId },
      customFields: custom,
      events: evidenceSubmissionCrudEvents,
      indexer: evidenceSubmissionCrudIndexer,
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
          applySubmissionUpdate(record, parsed)
          refreshSubmissionCompleteness(record)
        },
      ],
    })

    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    return loadEvidenceSubmissionSnapshot(entityManager, result.entityId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as EvidenceSubmissionSnapshot | undefined
    const after = snapshots.after as EvidenceSubmissionSnapshot | undefined
    if (!before) return null
    if (after && snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.evidence_submissions.update', 'Update EUDR evidence submission'),
      resourceKind: 'eudr.evidence_submission',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: {
        undo: { before, after: after ?? null } satisfies EvidenceSubmissionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<EvidenceSubmissionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await findEvidenceSubmission(entityManager, before.id)
    if (!record) {
      record = entityManager.create(EudrEvidenceSubmission, evidenceSubmissionSeedFromSnapshot(before))
      entityManager.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreEvidenceSubmission(record, before)
    }
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    await setEvidenceSubmissionCustomFields(dataEngine, before.id, before.organizationId, before.tenantId, resetValues)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: evidenceSubmissionCrudIndexer,
      events: evidenceSubmissionCrudEvents,
    })
  },
}

const deleteEvidenceSubmissionCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, EvidenceSubmissionCommandResult> = {
  id: 'eudr.evidence_submissions.delete',
  async prepare(input, ctx) {
    const entityId = requireId(input, 'EUDR evidence submission id required')
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadEvidenceSubmissionSnapshot(entityManager, entityId)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const entityId = requireId(input, 'EUDR evidence submission id required')
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findEvidenceSubmission(entityManager, entityId, false)
    if (!record) throw new CrudHttpError(404, { error: 'EUDR evidence submission not found' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    const snapshot = await loadEvidenceSubmissionSnapshot(entityManager, entityId)
    record.deletedAt = new Date()
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (snapshot?.custom) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      await setEvidenceSubmissionCustomFields(dataEngine, snapshot.id, snapshot.organizationId, snapshot.tenantId, resetValues)
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
      indexer: evidenceSubmissionCrudIndexer,
      events: evidenceSubmissionCrudEvents,
    })
    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as EvidenceSubmissionSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.evidence_submissions.delete', 'Delete EUDR evidence submission'),
      resourceKind: 'eudr.evidence_submission',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies EvidenceSubmissionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<EvidenceSubmissionUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await findEvidenceSubmission(entityManager, before.id)
    if (!record) {
      record = entityManager.create(EudrEvidenceSubmission, evidenceSubmissionSeedFromSnapshot(before))
      entityManager.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreEvidenceSubmission(record, before)
    }
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (before.custom) {
      await setEvidenceSubmissionCustomFields(dataEngine, before.id, before.organizationId, before.tenantId, before.custom)
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
      indexer: evidenceSubmissionCrudIndexer,
      events: evidenceSubmissionCrudEvents,
    })
  },
}

registerCommand(createEvidenceSubmissionCommand)
registerCommand(updateEvidenceSubmissionCommand)
registerCommand(deleteEvidenceSubmissionCommand)
