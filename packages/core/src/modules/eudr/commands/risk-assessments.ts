import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
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
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import {
  EudrDueDiligenceStatement,
  EudrEvidenceSubmission,
  EudrMitigationAction,
  EudrRiskAssessment,
} from '../data/entities'
import {
  riskAssessmentCreateSchema,
  riskAssessmentUpdateSchema,
  type RiskAssessmentCreateInput,
  type RiskAssessmentUpdateInput,
} from '../data/validators'
import { getCountryRiskTier } from '../lib/reference-data'

const RISK_ASSESSMENT_ENTITY_ID = 'eudr:eudr_risk_assessment'

type ScopedCommandInput = {
  tenantId: string
  organizationId: string
}

type CountryRisk = {
  country: string
  tier: string
}

type RiskCriteriaEntry = {
  answer: string
  note?: string | null
}

type RiskCriteria = Record<string, RiskCriteriaEntry>

type RiskAssessmentSnapshot = {
  id: string
  organizationId: string
  tenantId: string
  statementId: string
  countryRisks: CountryRisk[]
  overallTier: string
  criteria: RiskCriteria
  conclusion: string
  isSimplified: boolean
  assessedAt: string
  assessedByName: string | null
  reviewDueAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  custom?: Record<string, unknown> | null
}

type RiskAssessmentUndoPayload = {
  before?: RiskAssessmentSnapshot | null
  after?: RiskAssessmentSnapshot | null
}

type ScopedRiskAssessmentCreateInput = RiskAssessmentCreateInput & ScopedCommandInput
type ScopedRiskAssessmentUpdateInput = RiskAssessmentUpdateInput & Partial<ScopedCommandInput>

type RiskAssessmentCommandResult = {
  entityId: string
  updatedAt?: Date
}

type RiskSummary = {
  countryRisks: CountryRisk[]
  overallTier: string
  isSimplified: boolean
}

const scopedCommandInputSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

const riskAssessmentCrudIndexer: CrudIndexerConfig<EudrRiskAssessment> = {
  entityType: E.eudr.eudr_risk_assessment,
}

const riskAssessmentCrudEvents: CrudEventsConfig<EudrRiskAssessment> = {
  module: 'eudr',
  entity: 'risk_assessment',
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

function cloneCountryRisks(value: CountryRisk[]): CountryRisk[] {
  return value.map((risk) => ({ country: risk.country, tier: risk.tier }))
}

function cloneCriteria(value: RiskCriteria): RiskCriteria {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      {
        answer: entry.answer,
        ...(entry.note !== undefined ? { note: entry.note } : {}),
      },
    ]),
  )
}

function defaultReviewDueAt(assessedAt: Date): Date {
  return new Date(Date.UTC(
    assessedAt.getUTCFullYear() + 1,
    assessedAt.getUTCMonth(),
    assessedAt.getUTCDate(),
  ))
}

function assertNotFuture(date: Date, errorKey: string): void {
  if (date.getTime() > Date.now()) {
    throw new CrudHttpError(400, { error: errorKey })
  }
}

function resolveActorDisplayName(ctx: CommandRuntimeContext): string | null {
  const auth = ctx.auth
  if (!auth) return null
  const record = auth as Record<string, unknown>
  for (const key of ['displayName', 'name', 'email']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

function hasConcernAnswer(criteria: RiskCriteria): boolean {
  return Object.values(criteria).some((entry) => entry.answer === 'concern')
}

function computeOverallTier(countryRisks: CountryRisk[]): string {
  if (countryRisks.length === 0) return 'unknown'
  const tiers = countryRisks.map((risk) => risk.tier)
  if (tiers.includes('unknown')) return 'unknown'
  if (tiers.includes('high')) return 'high'
  const uniqueTiers = new Set(tiers)
  if (uniqueTiers.size > 1) return 'mixed'
  return tiers[0] ?? 'unknown'
}

async function requireStatementInScope(
  em: EntityManager,
  statementId: string,
  scope: ScopedCommandInput,
): Promise<EudrDueDiligenceStatement> {
  const statement = await em.findOne(EudrDueDiligenceStatement, {
    id: statementId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!statement) throw new CrudHttpError(400, { error: 'eudr.errors.statementNotFound' })
  return statement
}

async function computeRiskSummary(
  em: EntityManager,
  statementId: string,
  scope: ScopedCommandInput,
): Promise<RiskSummary> {
  const submissions = await findWithDecryption(
    em,
    EudrEvidenceSubmission,
    {
      statementId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  const countries = Array.from(
    new Set(
      submissions
        .map((submission) => submission.originCountry?.trim().toUpperCase() ?? '')
        .filter((country) => country.length > 0),
    ),
  ).sort((left, right) => left.localeCompare(right))
  const countryRisks = countries.map((country) => ({
    country,
    tier: getCountryRiskTier(country),
  }))

  return {
    countryRisks,
    overallTier: computeOverallTier(countryRisks),
    isSimplified: countryRisks.length > 0 && countryRisks.every((risk) => risk.tier === 'low'),
  }
}

async function assertCompletedMitigationIfRequired(
  em: EntityManager,
  assessmentId: string,
  scope: ScopedCommandInput,
  criteria: RiskCriteria,
  conclusion: string,
): Promise<void> {
  if (conclusion !== 'negligible' || !hasConcernAnswer(criteria)) return
  const completedCount = await em.count(EudrMitigationAction, {
    riskAssessmentId: assessmentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    status: 'completed',
    deletedAt: null,
  })
  if (completedCount < 1) {
    throw new CrudHttpError(400, { error: 'eudr.errors.mitigationRequired' })
  }
}

function riskAssessmentSeedFromSnapshot(snapshot: RiskAssessmentSnapshot): RequiredEntityData<EudrRiskAssessment> {
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    tenantId: snapshot.tenantId,
    statementId: snapshot.statementId,
    countryRisks: cloneCountryRisks(snapshot.countryRisks),
    overallTier: snapshot.overallTier,
    criteria: cloneCriteria(snapshot.criteria),
    conclusion: snapshot.conclusion,
    isSimplified: snapshot.isSimplified,
    assessedAt: new Date(snapshot.assessedAt),
    assessedByName: snapshot.assessedByName,
    reviewDueAt: toDate(snapshot.reviewDueAt),
    notes: snapshot.notes,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
    deletedAt: toDate(snapshot.deletedAt),
  }
}

async function findRiskAssessment(
  em: EntityManager,
  entityId: string,
  includeDeleted = true,
): Promise<EudrRiskAssessment | null> {
  return includeDeleted
    ? findOneWithDecryption(em, EudrRiskAssessment, { id: entityId })
    : findOneWithDecryption(em, EudrRiskAssessment, { id: entityId, deletedAt: null })
}

async function loadRiskAssessmentSnapshot(em: EntityManager, entityId: string): Promise<RiskAssessmentSnapshot | null> {
  const record = await findRiskAssessment(em, entityId)
  if (!record) return null
  const custom = await loadCustomFieldSnapshot(em, {
    entityId: RISK_ASSESSMENT_ENTITY_ID,
    recordId: record.id,
    tenantId: record.tenantId,
    organizationId: record.organizationId,
  })
  return {
    id: record.id,
    organizationId: record.organizationId,
    tenantId: record.tenantId,
    statementId: record.statementId,
    countryRisks: cloneCountryRisks(record.countryRisks),
    overallTier: record.overallTier,
    criteria: cloneCriteria(record.criteria),
    conclusion: record.conclusion,
    isSimplified: record.isSimplified,
    assessedAt: record.assessedAt.toISOString(),
    assessedByName: record.assessedByName ?? null,
    reviewDueAt: record.reviewDueAt ? record.reviewDueAt.toISOString() : null,
    notes: record.notes ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt ? record.deletedAt.toISOString() : null,
    custom: Object.keys(custom).length ? custom : null,
  }
}

function restoreRiskAssessment(record: EudrRiskAssessment, snapshot: RiskAssessmentSnapshot): void {
  record.organizationId = snapshot.organizationId
  record.tenantId = snapshot.tenantId
  record.statementId = snapshot.statementId
  record.countryRisks = cloneCountryRisks(snapshot.countryRisks)
  record.overallTier = snapshot.overallTier
  record.criteria = cloneCriteria(snapshot.criteria)
  record.conclusion = snapshot.conclusion
  record.isSimplified = snapshot.isSimplified
  record.assessedAt = new Date(snapshot.assessedAt)
  record.assessedByName = snapshot.assessedByName
  record.reviewDueAt = toDate(snapshot.reviewDueAt)
  record.notes = snapshot.notes
  record.createdAt = new Date(snapshot.createdAt)
  record.updatedAt = new Date(snapshot.updatedAt)
  record.deletedAt = toDate(snapshot.deletedAt)
}

async function setRiskAssessmentCustomFields(
  dataEngine: DataEngine,
  entityId: string,
  organizationId: string,
  tenantId: string,
  values: Record<string, unknown>,
): Promise<void> {
  await setCustomFieldsIfAny({
    dataEngine,
    entityId: RISK_ASSESSMENT_ENTITY_ID,
    recordId: entityId,
    organizationId,
    tenantId,
    values,
    notify: false,
  })
}

const createRiskAssessmentCommand: CommandHandler<ScopedRiskAssessmentCreateInput, RiskAssessmentCommandResult> = {
  id: 'eudr.risk_assessments.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(riskAssessmentCreateSchema, rawInput)
    const scope = parseScopedCommandInput(rawInput)
    ensureTenantScope(ctx, scope.tenantId)
    ensureOrganizationScope(ctx, scope.organizationId)

    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record!: EudrRiskAssessment
    let statementTitle = ''

    await runCrudCommandWrite({
      ctx,
      em: entityManager,
      entityId: RISK_ASSESSMENT_ENTITY_ID,
      action: 'created',
      scope,
      customFields: custom,
      events: riskAssessmentCrudEvents,
      indexer: riskAssessmentCrudIndexer,
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
          const statement = await requireStatementInScope(entityManager, parsed.statementId, scope)
          statementTitle = statement.title
          const summary = await computeRiskSummary(entityManager, parsed.statementId, scope)
          const assessedAt = parsed.assessedAt ?? new Date()
          assertNotFuture(assessedAt, 'eudr.errors.assessedAtInFuture')
          if (parsed.conclusion === 'negligible' && hasConcernAnswer(parsed.criteria)) {
            throw new CrudHttpError(400, { error: 'eudr.errors.mitigationRequired' })
          }
          record = entityManager.create(EudrRiskAssessment, {
            id: randomUUID(),
            organizationId: scope.organizationId,
            tenantId: scope.tenantId,
            statementId: parsed.statementId,
            countryRisks: summary.countryRisks,
            overallTier: summary.overallTier,
            criteria: cloneCriteria(parsed.criteria),
            conclusion: parsed.conclusion,
            isSimplified: summary.isSimplified,
            assessedAt,
            assessedByName: resolveActorDisplayName(ctx),
            reviewDueAt: parsed.reviewDueAt ?? defaultReviewDueAt(assessedAt),
            notes: parsed.notes ?? null,
          })
          entityManager.persist(record)
        },
      ],
    })

    await emitEudrLifecycleEvent(ctx.container, 'eudr.risk_assessment.concluded', {
      id: record.id,
      tenantId: record.tenantId,
      organizationId: record.organizationId,
      statementId: record.statementId,
      statementTitle,
      conclusion: record.conclusion,
    })

    return { entityId: record.id }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    return loadRiskAssessmentSnapshot(entityManager, result.entityId)
  },
  buildLog: async ({ snapshots }) => {
    const after = snapshots.after as RiskAssessmentSnapshot | undefined
    if (!after) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.risk_assessments.create', 'Create EUDR risk assessment'),
      resourceKind: 'eudr.risk_assessment',
      resourceId: after.id,
      tenantId: after.tenantId,
      organizationId: after.organizationId,
      snapshotAfter: after,
      payload: {
        undo: { after } satisfies RiskAssessmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<RiskAssessmentUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findRiskAssessment(entityManager, after.id)
    if (!record) return
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    record.deletedAt = new Date()
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(undefined, after.custom ?? undefined)
    await setRiskAssessmentCustomFields(dataEngine, after.id, after.organizationId, after.tenantId, resetValues)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: riskAssessmentCrudIndexer,
      events: riskAssessmentCrudEvents,
    })
  },
  redo: makeCreateRedo<EudrRiskAssessment, RiskAssessmentSnapshot, ScopedRiskAssessmentCreateInput, RiskAssessmentCommandResult>({
    entityClass: EudrRiskAssessment,
    seedFromSnapshot: riskAssessmentSeedFromSnapshot,
    buildResult: (entity) => ({ entityId: entity.id }),
    indexer: riskAssessmentCrudIndexer,
    events: riskAssessmentCrudEvents,
    findRow: ({ em, id }) => findRiskAssessment(em, id),
    afterRestore: async ({ ctx, entity, snapshot }) => {
      if (!snapshot.custom || !Object.keys(snapshot.custom).length) return
      await setRiskAssessmentCustomFields(
        ctx.container.resolve('dataEngine') as DataEngine,
        entity.id,
        entity.organizationId,
        entity.tenantId,
        snapshot.custom,
      )
    },
  }),
}

const updateRiskAssessmentCommand: CommandHandler<ScopedRiskAssessmentUpdateInput, RiskAssessmentCommandResult> = {
  id: 'eudr.risk_assessments.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(riskAssessmentUpdateSchema, rawInput)
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadRiskAssessmentSnapshot(entityManager, parsed.id)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(riskAssessmentUpdateSchema, rawInput)
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findRiskAssessment(entityManager, parsed.id, false)
    if (!record) throw new CrudHttpError(404, { error: 'eudr.errors.riskAssessmentNotFound' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)
    const scope = { tenantId: record.tenantId, organizationId: record.organizationId }
    const previousConclusion = record.conclusion
    let statementTitle = ''

    await runCrudCommandWrite({
      ctx,
      em: entityManager,
      entityId: RISK_ASSESSMENT_ENTITY_ID,
      action: 'updated',
      scope,
      customFields: custom,
      events: riskAssessmentCrudEvents,
      indexer: riskAssessmentCrudIndexer,
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
          const nextStatementId = parsed.statementId ?? record.statementId
          const statement = await requireStatementInScope(entityManager, nextStatementId, scope)
          statementTitle = statement.title
          const summary = await computeRiskSummary(entityManager, nextStatementId, scope)
          const nextCriteria = parsed.criteria ? cloneCriteria(parsed.criteria) : cloneCriteria(record.criteria)
          const nextConclusion = parsed.conclusion ?? record.conclusion
          const nextAssessedAt = parsed.assessedAt ?? record.assessedAt
          assertNotFuture(nextAssessedAt, 'eudr.errors.assessedAtInFuture')
          await assertCompletedMitigationIfRequired(entityManager, record.id, scope, nextCriteria, nextConclusion)

          record.statementId = nextStatementId
          record.countryRisks = summary.countryRisks
          record.overallTier = summary.overallTier
          record.criteria = nextCriteria
          record.conclusion = nextConclusion
          record.isSimplified = summary.isSimplified
          record.assessedAt = nextAssessedAt
          record.assessedByName = resolveActorDisplayName(ctx)
          if (parsed.reviewDueAt !== undefined) {
            record.reviewDueAt = parsed.reviewDueAt
          } else if (parsed.assessedAt !== undefined || !record.reviewDueAt) {
            record.reviewDueAt = defaultReviewDueAt(nextAssessedAt)
          }
          if (parsed.notes !== undefined) record.notes = parsed.notes ?? null
        },
      ],
    })

    if (record.conclusion !== previousConclusion) {
      await emitEudrLifecycleEvent(ctx.container, 'eudr.risk_assessment.concluded', {
        id: record.id,
        tenantId: record.tenantId,
        organizationId: record.organizationId,
        statementId: record.statementId,
        statementTitle,
        conclusion: record.conclusion,
      })
    }

    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  captureAfter: async (_rawInput, result, ctx) => {
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    return loadRiskAssessmentSnapshot(entityManager, result.entityId)
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as RiskAssessmentSnapshot | undefined
    const after = snapshots.after as RiskAssessmentSnapshot | undefined
    if (!before) return null
    if (after && snapshotsEqual(before, after)) return { skipLog: true }
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.risk_assessments.update', 'Update EUDR risk assessment'),
      resourceKind: 'eudr.risk_assessment',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      snapshotAfter: after ?? null,
      payload: {
        undo: { before, after: after ?? null } satisfies RiskAssessmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<RiskAssessmentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await findRiskAssessment(entityManager, before.id)
    if (!record) {
      record = entityManager.create(EudrRiskAssessment, riskAssessmentSeedFromSnapshot(before))
      entityManager.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreRiskAssessment(record, before)
    }
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    const resetValues = buildCustomFieldResetMap(before.custom ?? undefined, payload?.after?.custom ?? undefined)
    await setRiskAssessmentCustomFields(dataEngine, before.id, before.organizationId, before.tenantId, resetValues)
    await emitCrudUndoSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId,
        tenantId: record.tenantId,
      },
      indexer: riskAssessmentCrudIndexer,
      events: riskAssessmentCrudEvents,
    })
  },
}

const deleteRiskAssessmentCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, RiskAssessmentCommandResult> = {
  id: 'eudr.risk_assessments.delete',
  async prepare(input, ctx) {
    const entityId = requireId(input, 'eudr.errors.riskAssessmentIdRequired')
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const snapshot = await loadRiskAssessmentSnapshot(entityManager, entityId)
    if (snapshot) {
      ensureTenantScope(ctx, snapshot.tenantId)
      ensureOrganizationScope(ctx, snapshot.organizationId)
    }
    return snapshot ? { before: snapshot } : {}
  },
  async execute(input, ctx) {
    const entityId = requireId(input, 'eudr.errors.riskAssessmentIdRequired')
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    const record = await findRiskAssessment(entityManager, entityId, false)
    if (!record) throw new CrudHttpError(404, { error: 'eudr.errors.riskAssessmentNotFound' })
    ensureTenantScope(ctx, record.tenantId)
    ensureOrganizationScope(ctx, record.organizationId)

    const snapshot = await loadRiskAssessmentSnapshot(entityManager, entityId)
    record.deletedAt = new Date()
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (snapshot?.custom) {
      const resetValues = buildCustomFieldResetMap(snapshot.custom, undefined)
      await setRiskAssessmentCustomFields(dataEngine, snapshot.id, snapshot.organizationId, snapshot.tenantId, resetValues)
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
      indexer: riskAssessmentCrudIndexer,
      events: riskAssessmentCrudEvents,
    })
    return { entityId: record.id, updatedAt: record.updatedAt }
  },
  buildLog: async ({ snapshots }) => {
    const before = snapshots.before as RiskAssessmentSnapshot | undefined
    if (!before) return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('eudr.audit.risk_assessments.delete', 'Delete EUDR risk assessment'),
      resourceKind: 'eudr.risk_assessment',
      resourceId: before.id,
      tenantId: before.tenantId,
      organizationId: before.organizationId,
      snapshotBefore: before,
      payload: {
        undo: { before } satisfies RiskAssessmentUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<RiskAssessmentUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const entityManager = (ctx.container.resolve('em') as EntityManager).fork()
    let record = await findRiskAssessment(entityManager, before.id)
    if (!record) {
      record = entityManager.create(EudrRiskAssessment, riskAssessmentSeedFromSnapshot(before))
      entityManager.persist(record)
    } else {
      ensureTenantScope(ctx, before.tenantId)
      ensureOrganizationScope(ctx, before.organizationId)
      restoreRiskAssessment(record, before)
    }
    await entityManager.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    if (before.custom) {
      await setRiskAssessmentCustomFields(dataEngine, before.id, before.organizationId, before.tenantId, before.custom)
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
      indexer: riskAssessmentCrudIndexer,
      events: riskAssessmentCrudEvents,
    })
  },
}

registerCommand(createRiskAssessmentCommand)
registerCommand(updateRiskAssessmentCommand)
registerCommand(deleteRiskAssessmentCommand)
