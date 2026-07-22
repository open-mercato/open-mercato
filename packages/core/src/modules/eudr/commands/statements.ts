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
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitEudrLifecycleEvent } from './lifecycle-events'
import { E } from '#generated/entities.ids.generated'
import { sql } from 'kysely'
import { z } from 'zod'
import {
  EudrDueDiligenceStatement,
  EudrEvidenceSubmission,
  EudrMitigationAction,
  EudrRiskAssessment,
} from '../data/entities'
import {
  EUDR_STATEMENT_STATUSES,
  statementCreateSchema,
  statementUpdateSchema,
  type EudrStatementStatus,
  type StatementCreateInput,
  type StatementUpdateInput,
} from '../data/validators'
import {
  EUDR_AMEND_GUARDED_FIELDS,
  canTransition,
  evaluateSubmissionGate,
  isAmendWindowOpen,
  type GateAssessmentView,
  type GateSubmissionView,
} from '../lib/statement-lifecycle'

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
  activityType: string | null
  actorRole: string | null
  referencedStatements: Array<{ referenceNumber: string; verificationNumber?: string | null }>
  quantityKg: string | null
  supplementaryUnit: string | null
  supplementaryQuantity: string | null
  orderId: string | null
  submittedAt: string | null
  referenceIssuedAt: string | null
  orderSnapshot: { orderNumber?: string | null } | null
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
    activityType: snapshot.activityType,
    actorRole: snapshot.actorRole,
    referencedStatements: snapshot.referencedStatements.map((entry) => ({ ...entry })),
    quantityKg: snapshot.quantityKg,
    supplementaryUnit: snapshot.supplementaryUnit,
    supplementaryQuantity: snapshot.supplementaryQuantity,
    orderId: snapshot.orderId,
    submittedAt: toDate(snapshot.submittedAt),
    referenceIssuedAt: toDate(snapshot.referenceIssuedAt),
    orderSnapshot: snapshot.orderSnapshot,
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
    activityType: record.activityType ?? null,
    actorRole: record.actorRole ?? null,
    referencedStatements: Array.isArray(record.referencedStatements)
      ? record.referencedStatements.map((entry) => ({ ...entry }))
      : [],
    quantityKg: record.quantityKg ?? null,
    supplementaryUnit: record.supplementaryUnit ?? null,
    supplementaryQuantity: record.supplementaryQuantity ?? null,
    orderId: record.orderId ?? null,
    submittedAt: record.submittedAt ? record.submittedAt.toISOString() : null,
    referenceIssuedAt: record.referenceIssuedAt ? record.referenceIssuedAt.toISOString() : null,
    orderSnapshot: record.orderSnapshot ?? null,
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
  if (parsed.activityType !== undefined) record.activityType = parsed.activityType ?? null
  if (parsed.actorRole !== undefined) record.actorRole = parsed.actorRole ?? null
  if (parsed.referencedStatements !== undefined) {
    record.referencedStatements = parsed.referencedStatements.map((entry) => ({ ...entry }))
  }
  if (parsed.quantityKg !== undefined) record.quantityKg = toNumericString(parsed.quantityKg)
  if (parsed.supplementaryUnit !== undefined) record.supplementaryUnit = parsed.supplementaryUnit ?? null
  if (parsed.supplementaryQuantity !== undefined) record.supplementaryQuantity = toNumericString(parsed.supplementaryQuantity)
  if (parsed.orderId !== undefined) record.orderId = parsed.orderId ?? null
  if (parsed.referenceIssuedAt !== undefined) record.referenceIssuedAt = parsed.referenceIssuedAt
  if (parsed.orderSnapshot !== undefined) record.orderSnapshot = parsed.orderSnapshot ?? null
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
  record.activityType = snapshot.activityType
  record.actorRole = snapshot.actorRole
  record.referencedStatements = snapshot.referencedStatements.map((entry) => ({ ...entry }))
  record.quantityKg = snapshot.quantityKg
  record.supplementaryUnit = snapshot.supplementaryUnit
  record.supplementaryQuantity = snapshot.supplementaryQuantity
  record.orderId = snapshot.orderId
  record.submittedAt = toDate(snapshot.submittedAt)
  record.referenceIssuedAt = toDate(snapshot.referenceIssuedAt)
  record.orderSnapshot = snapshot.orderSnapshot
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

type PatchedStatementView = {
  referenceNumber: string | null
  verificationNumber: string | null
  actorRole: string | null
  referencedStatements: Array<{ referenceNumber: string; verificationNumber?: string | null }>
}

type StatementServerFields = {
  submittedAt?: Date
  referenceIssuedAt?: Date | null
}

const STATEMENT_STATUS_SET = new Set<string>(EUDR_STATEMENT_STATUSES)

const STATEMENT_UPDATE_FIELDS = [
  'title',
  'commodity',
  'referenceNumber',
  'verificationNumber',
  'status',
  'activityType',
  'actorRole',
  'referencedStatements',
  'quantityKg',
  'supplementaryUnit',
  'supplementaryQuantity',
  'orderId',
  'referenceIssuedAt',
  'orderSnapshot',
  'notes',
] as const

type StatementUpdateField = (typeof STATEMENT_UPDATE_FIELDS)[number]

function isStatementStatus(value: string): value is EudrStatementStatus {
  return STATEMENT_STATUS_SET.has(value)
}

function isNonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function dateValuesEqual(left: Date | null | undefined, right: Date | null | undefined): boolean {
  const leftTime = left ? left.getTime() : null
  const rightTime = right ? right.getTime() : null
  return leftTime === rightTime
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

// PG numeric columns read back scale-padded ('100.000'); compare numerically so
// an unchanged echo from a whole-document save is not treated as an amendment.
function numericValuesEqual(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftNumber = left === null || left === undefined || left === '' ? null : Number(left)
  const rightNumber = right === null || right === undefined || right === '' ? null : Number(right)
  if (leftNumber === null || rightNumber === null) return leftNumber === rightNumber
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber
}

function referencedStatementsEqual(
  left: Array<{ referenceNumber: string; verificationNumber?: string | null }> | null | undefined,
  right: Array<{ referenceNumber: string; verificationNumber?: string | null }> | null | undefined,
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? [])
}

function statementFieldChanged(
  record: EudrDueDiligenceStatement,
  parsed: StatementUpdateInput,
  field: StatementUpdateField,
): boolean {
  switch (field) {
    case 'title':
      return parsed.title !== undefined && parsed.title !== record.title
    case 'commodity':
      return parsed.commodity !== undefined && parsed.commodity !== record.commodity
    case 'referenceNumber':
      return parsed.referenceNumber !== undefined && (parsed.referenceNumber ?? null) !== (record.referenceNumber ?? null)
    case 'verificationNumber':
      return parsed.verificationNumber !== undefined && (parsed.verificationNumber ?? null) !== (record.verificationNumber ?? null)
    case 'status':
      return parsed.status !== undefined && parsed.status !== record.status
    case 'activityType':
      return parsed.activityType !== undefined && (parsed.activityType ?? null) !== (record.activityType ?? null)
    case 'actorRole':
      return parsed.actorRole !== undefined && (parsed.actorRole ?? null) !== (record.actorRole ?? null)
    case 'referencedStatements':
      return parsed.referencedStatements !== undefined && !referencedStatementsEqual(parsed.referencedStatements, record.referencedStatements)
    case 'quantityKg':
      return parsed.quantityKg !== undefined && !numericValuesEqual(toNumericString(parsed.quantityKg), record.quantityKg ?? null)
    case 'supplementaryUnit':
      return parsed.supplementaryUnit !== undefined && (parsed.supplementaryUnit ?? null) !== (record.supplementaryUnit ?? null)
    case 'supplementaryQuantity':
      return parsed.supplementaryQuantity !== undefined && !numericValuesEqual(toNumericString(parsed.supplementaryQuantity), record.supplementaryQuantity ?? null)
    case 'orderId':
      return parsed.orderId !== undefined && (parsed.orderId ?? null) !== (record.orderId ?? null)
    case 'referenceIssuedAt':
      return parsed.referenceIssuedAt !== undefined && !dateValuesEqual(parsed.referenceIssuedAt, record.referenceIssuedAt ?? null)
    case 'orderSnapshot':
      return parsed.orderSnapshot !== undefined && !jsonValuesEqual(parsed.orderSnapshot ?? null, record.orderSnapshot ?? null)
    case 'notes':
      return parsed.notes !== undefined && (parsed.notes ?? null) !== (record.notes ?? null)
  }
}

function hasStatementFieldChanges(record: EudrDueDiligenceStatement, parsed: StatementUpdateInput): boolean {
  return STATEMENT_UPDATE_FIELDS.some((field) => statementFieldChanged(record, parsed, field))
}

function buildPatchedStatementView(record: EudrDueDiligenceStatement, parsed: StatementUpdateInput): PatchedStatementView {
  return {
    referenceNumber: parsed.referenceNumber !== undefined ? parsed.referenceNumber ?? null : record.referenceNumber ?? null,
    verificationNumber: parsed.verificationNumber !== undefined ? parsed.verificationNumber ?? null : record.verificationNumber ?? null,
    actorRole: parsed.actorRole !== undefined ? parsed.actorRole ?? null : record.actorRole ?? null,
    referencedStatements: parsed.referencedStatements !== undefined
      ? parsed.referencedStatements.map((entry) => ({ ...entry }))
      : Array.isArray(record.referencedStatements)
        ? record.referencedStatements.map((entry) => ({ ...entry }))
        : [],
  }
}

function hasChangedAmendGuardedField(record: EudrDueDiligenceStatement, parsed: StatementUpdateInput): boolean {
  return EUDR_AMEND_GUARDED_FIELDS.some((field) => statementFieldChanged(record, parsed, field))
}

function hasConcernAnswers(criteria: Record<string, { answer: string; note?: string | null }>): boolean {
  return Object.values(criteria).some((entry) => entry.answer === 'concern')
}

async function loadStatementSubmissionsForGate(
  em: EntityManager,
  record: EudrDueDiligenceStatement,
): Promise<GateSubmissionView[]> {
  const submissions = await findWithDecryption(
    em,
    EudrEvidenceSubmission,
    {
      statementId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: record.tenantId, organizationId: record.organizationId },
  )
  return submissions.map((submission) => ({
    status: submission.status,
    completenessScore: submission.completenessScore,
    originCountry: submission.originCountry ?? null,
  }))
}

async function loadLatestAssessmentForGate(
  em: EntityManager,
  record: EudrDueDiligenceStatement,
): Promise<GateAssessmentView> {
  const assessments = await findWithDecryption(
    em,
    EudrRiskAssessment,
    {
      statementId: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      deletedAt: null,
    },
    {
      orderBy: { assessedAt: 'desc', createdAt: 'desc' },
      limit: 1,
    },
    { tenantId: record.tenantId, organizationId: record.organizationId },
  )
  const assessment = assessments[0]
  if (!assessment) return null
  const completedMitigationCount = await em.count(EudrMitigationAction, {
    riskAssessmentId: assessment.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
    status: 'completed',
    deletedAt: null,
  })
  return {
    conclusion: assessment.conclusion,
    countryRisks: assessment.countryRisks.map((risk) => ({ country: risk.country, tier: risk.tier })),
    reviewDueAt: assessment.reviewDueAt ?? null,
    hasConcernAnswers: hasConcernAnswers(assessment.criteria),
    hasCompletedMitigation: completedMitigationCount > 0,
  }
}

async function assertNoDownstreamReferences(
  em: EntityManager,
  record: EudrDueDiligenceStatement,
): Promise<void> {
  const referenceNumber = record.referenceNumber?.trim().toUpperCase() ?? ''
  if (!referenceNumber) return
  const db = em.getKysely<{
    eudr_due_diligence_statements: {
      id: string
      tenant_id: string
      organization_id: string
      deleted_at: Date | null
      referenced_statements: unknown
    }
  }>()
  const containment = JSON.stringify([{ referenceNumber }])
  const downstreamRow = await db
    .selectFrom('eudr_due_diligence_statements')
    .select(sql<number>`count(*)`.as('total'))
    .where('tenant_id', '=', record.tenantId)
    .where('organization_id', '=', record.organizationId)
    .where('deleted_at', 'is', null)
    .where('id', '!=', record.id)
    .where(sql<boolean>`referenced_statements @> ${containment}::jsonb`)
    .executeTakeFirst()
  if (Number(downstreamRow?.total ?? 0) > 0) {
    throw new CrudHttpError(400, { error: 'eudr.errors.referencedDownstream' })
  }
}

async function validateStatementUpdate(
  em: EntityManager,
  record: EudrDueDiligenceStatement,
  parsed: StatementUpdateInput,
  custom: Record<string, unknown>,
): Promise<StatementServerFields> {
  if (!isStatementStatus(record.status)) {
    throw new CrudHttpError(400, { error: 'eudr.errors.invalidTransition' })
  }

  const requestedStatus = parsed.status
  const statusChanged = requestedStatus !== undefined && requestedStatus !== record.status
  if (statusChanged && (!isStatementStatus(requestedStatus) || !canTransition(record.status, requestedStatus))) {
    throw new CrudHttpError(400, { error: 'eudr.errors.invalidTransition' })
  }

  const hasBaseChanges = hasStatementFieldChanges(record, parsed)
  if (record.status === 'archived' && (hasBaseChanges || Object.keys(custom).length > 0)) {
    throw new CrudHttpError(400, { error: 'eudr.errors.archivedReadOnly' })
  }

  const patched = buildPatchedStatementView(record, parsed)
  const serverFields: StatementServerFields = {}
  const isSubmittedToAvailable = record.status === 'submitted' && requestedStatus === 'available'

  if (statusChanged) {
    if (record.status === 'draft' && requestedStatus === 'submitted') {
      const submissions = await loadStatementSubmissionsForGate(em, record)
      const latestAssessment = await loadLatestAssessmentForGate(em, record)
      const gate = evaluateSubmissionGate({
        actorRole: patched.actorRole,
        referencedStatementsCount: patched.referencedStatements.length,
        submissions,
        latestAssessment,
      })
      if (!gate.allowed) {
        throw new CrudHttpError(400, {
          error: 'eudr.errors.gateFailed',
          details: {
            reasons: gate.reasons.map((reason) => `eudr.gate.${reason}`),
          },
        })
      }
      serverFields.submittedAt = new Date()
    }

    if (isSubmittedToAvailable) {
      if (!isNonEmpty(patched.referenceNumber) || !isNonEmpty(patched.verificationNumber)) {
        throw new CrudHttpError(400, {
          error: 'eudr.errors.referenceNumbersRequired',
          details: {
            reasons: ['eudr.gate.referenceNumbersRequired'],
          },
        })
      }
      const issuedAt = parsed.referenceIssuedAt ?? new Date()
      if (issuedAt.getTime() > Date.now()) {
        throw new CrudHttpError(400, { error: 'eudr.errors.referenceIssuedAtInvalid' })
      }
      serverFields.referenceIssuedAt = issuedAt
    }

    if (record.status === 'available' && requestedStatus === 'withdrawn') {
      if (!isAmendWindowOpen(record.referenceIssuedAt ?? null)) {
        throw new CrudHttpError(400, { error: 'eudr.errors.amendWindowElapsed' })
      }
      await assertNoDownstreamReferences(em, record)
    }
  }

  if (
    parsed.referenceIssuedAt !== undefined
    && !isSubmittedToAvailable
    && !dateValuesEqual(parsed.referenceIssuedAt, record.referenceIssuedAt ?? null)
  ) {
    throw new CrudHttpError(400, { error: 'eudr.errors.referenceIssuedAtImmutable' })
  }

  // Guarded fields freeze once the amend window elapses, regardless of any
  // status transition requested in the same call (available→archived must not
  // smuggle in a quantity/commodity change).
  if (
    record.status === 'available'
    && !isAmendWindowOpen(record.referenceIssuedAt ?? null)
    && hasChangedAmendGuardedField(record, parsed)
  ) {
    throw new CrudHttpError(400, { error: 'eudr.errors.amendWindowElapsed' })
  }

  return serverFields
}

const createStatementCommand: CommandHandler<ScopedStatementCreateInput, StatementCommandResult> = {
  id: 'eudr.statements.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(statementCreateSchema, rawInput)
    const scope = parseScopedCommandInput(rawInput)
    ensureTenantScope(ctx, scope.tenantId)
    ensureOrganizationScope(ctx, scope.organizationId)
    if (parsed.status !== undefined && parsed.status !== 'draft') {
      throw new CrudHttpError(400, { error: 'eudr.errors.invalidTransition' })
    }
    if (parsed.referenceIssuedAt !== undefined) {
      throw new CrudHttpError(400, { error: 'eudr.errors.referenceIssuedAtImmutable' })
    }

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
            activityType: parsed.activityType ?? null,
            actorRole: parsed.actorRole ?? null,
            referencedStatements: parsed.referencedStatements ? parsed.referencedStatements.map((entry) => ({ ...entry })) : [],
            quantityKg: toNumericString(parsed.quantityKg),
            supplementaryUnit: parsed.supplementaryUnit ?? null,
            supplementaryQuantity: toNumericString(parsed.supplementaryQuantity),
            orderId: parsed.orderId ?? null,
            referenceIssuedAt: null,
            orderSnapshot: parsed.orderSnapshot ?? null,
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
    const previousStatus = record.status

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
        async () => {
          const serverFields = await validateStatementUpdate(entityManager, record, parsed, custom)
          applyStatementUpdate(record, parsed)
          if (serverFields.submittedAt !== undefined) record.submittedAt = serverFields.submittedAt
          if (serverFields.referenceIssuedAt !== undefined) record.referenceIssuedAt = serverFields.referenceIssuedAt
        },
      ],
    })

    const lifecycleEventId = record.status === previousStatus
      ? null
      : previousStatus === 'draft' && record.status === 'submitted'
        ? 'eudr.due_diligence_statement.submitted'
        : previousStatus === 'submitted' && record.status === 'available'
          ? 'eudr.due_diligence_statement.reference_issued'
          : previousStatus === 'available' && record.status === 'withdrawn'
            ? 'eudr.due_diligence_statement.withdrawn'
            : null
    if (lifecycleEventId) {
      await emitEudrLifecycleEvent(ctx.container, lifecycleEventId, {
        id: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
        title: record.title,
        referenceNumber: record.referenceNumber ?? null,
      })
    }

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
    if (record.status === 'archived') {
      throw new CrudHttpError(400, { error: 'eudr.errors.archivedReadOnly' })
    }
    if (record.status === 'available') {
      if (!isAmendWindowOpen(record.referenceIssuedAt ?? null)) {
        throw new CrudHttpError(400, { error: 'eudr.errors.amendWindowElapsed' })
      }
      await assertNoDownstreamReferences(entityManager, record)
    }

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
