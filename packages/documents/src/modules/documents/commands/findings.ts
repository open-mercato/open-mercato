import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { assertOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Document, DocumentFinding, type DocumentFindingStatus } from '../data/entities'
import { findingIngestCommandSchema } from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { loadDocumentContent } from '../lib/contentService'
import { createFindingAnchorer } from '../lib/findingAnchors'
import {
  countFindingsBySeverity,
  countLatestReviewOpenBlocking,
  countOpenBlockingFindings,
  countOpenFindings,
  isReviewClearedTransition,
  serializeDocumentFinding,
  type DocumentFindingSeverityCounts,
  type SerializedDocumentFinding,
} from '../lib/findingSummary'
import { DOCUMENTS_MAX_OPEN_FINDINGS_PER_DOCUMENT } from '../lib/resourceLimits'
import { nextDocumentVersion, readCommandRedoInput } from './mutation-helpers'
import type { DocumentsProjectionDescriptor } from './projection-types'
import {
  assertDocumentCommandCapability,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandScope,
} from './shared'

type CommandContext = Parameters<CommandHandler['execute']>[1]
type FindingScope = { tenantId: string; organizationId: string }
type DecisionKind = 'apply' | 'keep' | 'reopen'

const RECORD_CHANGED_ERROR = 'Record changed by another user'

const findingStateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['open', 'applied', 'kept', 'superseded']),
  appliedText: z.string().nullable(),
  decisionNote: z.string().nullable(),
  decidedByUserId: z.string().uuid().nullable(),
  decidedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
})

const findingVersionSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().datetime(),
})

export const findingIngestCommandInputSchema = findingIngestCommandSchema.extend({
  tenantId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  findingIds: z.array(z.string().uuid()).optional(),
}).superRefine((input, context) => {
  if (input.findingIds && input.findingIds.length !== input.findings.length) {
    context.addIssue({ code: 'custom', path: ['findingIds'], message: 'documents.validation.finding.identityMismatch' })
  }
})

const findingDecisionBaseSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  documentId: z.string().uuid(),
  findingId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).nullable().optional(),
  redoExpectation: findingStateSchema.optional(),
})

export const findingApplyCommandSchema = findingDecisionBaseSchema.extend({
  appliedText: z.string().max(4000),
})

export const findingKeepCommandSchema = findingDecisionBaseSchema.extend({
  note: z.string().trim().max(2000).nullable().optional(),
})

export const findingReopenCommandSchema = findingDecisionBaseSchema

export type FindingIngestCommandInput = z.input<typeof findingIngestCommandInputSchema>
export type FindingApplyCommandInput = z.infer<typeof findingApplyCommandSchema>
export type FindingKeepCommandInput = z.infer<typeof findingKeepCommandSchema>
export type FindingReopenCommandInput = z.infer<typeof findingReopenCommandSchema>
export type FindingState = z.infer<typeof findingStateSchema>
type FindingVersion = z.infer<typeof findingVersionSchema>

type ResolvedIngestInput = z.infer<typeof findingIngestCommandInputSchema> & {
  tenantId: string
  organizationId: string
  reviewId: string
  findingIds: string[]
}

type FindingIngestUndoPayload = {
  created: FindingVersion[]
  superseded: FindingVersion[]
  projectionsAfterUndo?: DocumentsProjectionDescriptor[]
}

export type FindingIngestCommandResult = {
  reviewId: string
  created: number
  superseded: number
  unlocated: number
  counts: DocumentFindingSeverityCounts
  findingIds: string[]
  resolvedInput: ResolvedIngestInput
  reviewCleared: boolean
  projections: DocumentsProjectionDescriptor[]
  undo: FindingIngestUndoPayload
}

type FindingDecisionUndoPayload = {
  before: FindingState
  after: FindingState
  projectionsAfterUndo?: DocumentsProjectionDescriptor[]
}

export type FindingDecisionCommandResult = {
  id: string
  reviewId: string
  finding: SerializedDocumentFinding
  reviewCleared: boolean
  before: FindingState
  after: FindingState
  projections: DocumentsProjectionDescriptor[]
}

function resolveEntityManager(ctx: CommandContext): EntityManager {
  return ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
}

function captureFindingState(finding: DocumentFinding): FindingState {
  return {
    id: finding.id,
    status: finding.status,
    appliedText: finding.appliedText ?? null,
    decisionNote: finding.decisionNote ?? null,
    decidedByUserId: finding.decidedByUserId ?? null,
    decidedAt: finding.decidedAt?.toISOString() ?? null,
    deletedAt: finding.deletedAt?.toISOString() ?? null,
    updatedAt: finding.updatedAt.toISOString(),
  }
}

function findingStateMatches(finding: DocumentFinding, expected: FindingState): boolean {
  const current = captureFindingState(finding)
  return current.id === expected.id
    && current.status === expected.status
    && current.appliedText === expected.appliedText
    && current.decisionNote === expected.decisionNote
    && current.decidedByUserId === expected.decidedByUserId
    && current.decidedAt === expected.decidedAt
    && current.deletedAt === expected.deletedAt
}

function assertFindingUnchanged(finding: DocumentFinding | null, expected: FindingState): asserts finding is DocumentFinding {
  if (!finding) throw new CrudHttpError(409, { error: RECORD_CHANGED_ERROR })
  assertOptimisticLock({
    resourceKind: DOCUMENTS_ENTITY_IDS.documentFinding,
    resourceId: expected.id,
    current: finding.updatedAt,
    expected: expected.updatedAt,
    envValue: 'all',
  })
  if (!findingStateMatches(finding, expected)) {
    throw new CrudHttpError(409, { error: RECORD_CHANGED_ERROR })
  }
}

function assertVersionUnchanged(
  finding: DocumentFinding | null,
  expected: FindingVersion,
  status: DocumentFindingStatus,
): asserts finding is DocumentFinding {
  if (
    !finding
    || finding.deletedAt
    || finding.status !== status
    || finding.updatedAt.toISOString() !== expected.updatedAt
  ) {
    throw new CrudHttpError(409, { error: 'documents.findings.undoConflict' })
  }
}

function restoreFindingState(finding: DocumentFinding, state: FindingState): void {
  finding.status = state.status
  finding.appliedText = state.appliedText
  finding.decisionNote = state.decisionNote
  finding.decidedByUserId = state.decidedByUserId
  finding.decidedAt = state.decidedAt ? new Date(state.decidedAt) : null
  finding.deletedAt = state.deletedAt ? new Date(state.deletedAt) : null
  finding.updatedAt = nextDocumentVersion(finding.updatedAt)
}

function assertActor(input: { actorUserId: string }, ctx: CommandContext): void {
  if (resolveDocumentsCommandActor(ctx) !== input.actorUserId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

function resolveIngestScope(
  ctx: CommandContext,
  input: { tenantId?: string; organizationId?: string },
): FindingScope {
  const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) throw new CrudHttpError(403, { error: 'Forbidden' })
  return resolveDocumentsCommandScope(ctx, { tenantId, organizationId })
}

async function loadLockedDocument(
  em: EntityManager,
  scope: FindingScope,
  documentId: string,
): Promise<Document> {
  const document = await findOneWithDecryption(
    em,
    Document,
    { id: documentId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
    scope,
  )
  if (!document) throw new CrudHttpError(404, { error: 'Document not found' })
  return document
}

async function loadFinding(
  em: EntityManager,
  scope: FindingScope,
  documentId: string,
  findingId: string,
): Promise<DocumentFinding | null> {
  return findOneWithDecryption(
    em,
    DocumentFinding,
    { id: findingId, documentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE },
    scope,
  )
}

async function assertCanDecide(
  ctx: CommandContext,
  em: EntityManager,
  scope: FindingScope,
  documentId: string,
): Promise<void> {
  await assertDocumentCommandCapability(ctx, em, documentId, scope, 'canEdit')
}

function findingEventProjection(
  eventId: 'documents.finding.applied' | 'documents.finding.kept' | 'documents.finding.reopened',
  scope: FindingScope,
  finding: { id: string; documentId: string; reviewId: string; severity: string },
): DocumentsProjectionDescriptor {
  return {
    kind: 'event',
    eventId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    payload: {
      id: finding.id,
      documentId: finding.documentId,
      reviewId: finding.reviewId,
      severity: finding.severity,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
  }
}

function reviewClearedProjection(
  scope: FindingScope,
  input: { documentId: string; reviewId: string; decidedByUserId: string },
): DocumentsProjectionDescriptor {
  return {
    kind: 'event',
    eventId: 'documents.review.cleared',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    payload: {
      documentId: input.documentId,
      reviewId: input.reviewId,
      decidedByUserId: input.decidedByUserId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
  }
}

function emittedEventIds(projections: DocumentsProjectionDescriptor[]): string[] {
  return projections.flatMap((projection) => (projection.kind === 'event' ? [projection.eventId] : []))
}

function applyIngestFields(
  finding: DocumentFinding,
  input: ResolvedIngestInput,
  item: ResolvedIngestInput['findings'][number],
  anchor: ReturnType<ReturnType<typeof createFindingAnchorer>['locate']>,
  actorUserId: string,
): void {
  finding.reviewId = input.reviewId
  finding.source = input.source
  finding.sourceWorkflowInstanceId = input.origin.workflowInstanceId ?? null
  finding.sourceAgentRunId = input.origin.agentRunId ?? null
  finding.ruleCode = item.ruleCode ?? null
  finding.severity = item.severity
  finding.title = item.title
  finding.explanation = item.explanation
  finding.sectionLabel = item.sectionLabel ?? null
  finding.quote = item.quote
  finding.occurrence = item.occurrence
  finding.suggestedText = item.suggestedText ?? null
  finding.anchor = anchor.anchor
  finding.anchorStatus = anchor.anchorStatus
  finding.status = 'open'
  finding.appliedText = null
  finding.decisionNote = null
  finding.decidedByUserId = null
  finding.decidedAt = null
  finding.createdByUserId = actorUserId
  finding.deletedAt = null
}

export const ingestFindingsCommand: CommandHandler<FindingIngestCommandInput, FindingIngestCommandResult> = {
  id: 'documents.finding.ingest',
  async prepare(rawInput, ctx) {
    const input = findingIngestCommandInputSchema.parse(rawInput)
    const scope = resolveIngestScope(ctx, input)
    resolveDocumentsCommandActor(ctx)
    const em = ctx.container.resolve('em') as EntityManager
    await assertCanDecide(ctx, em, scope, input.documentId)
    return null
  },
  async execute(rawInput, ctx) {
    const parsed = findingIngestCommandInputSchema.parse(rawInput)
    const scope = resolveIngestScope(ctx, parsed)
    const actorUserId = resolveDocumentsCommandActor(ctx)
    const input: ResolvedIngestInput = {
      ...parsed,
      ...scope,
      reviewId: parsed.reviewId ?? randomUUID(),
      findingIds: parsed.findingIds ?? parsed.findings.map(() => randomUUID()),
    }
    const em = resolveEntityManager(ctx)
    const created: DocumentFinding[] = []
    const superseded: DocumentFinding[] = []
    let unlocated = 0
    let openBlockingAfter = 0
    await withAtomicFlush(em, [async () => {
      await loadLockedDocument(em, scope, input.documentId)
      await assertCanDecide(ctx, em, scope, input.documentId)
      const existing = input.findingIds.length > 0
        ? await findWithDecryption(
          em,
          DocumentFinding,
          { id: { $in: input.findingIds }, tenantId: scope.tenantId, organizationId: scope.organizationId },
          { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE },
          scope,
        )
        : []
      const existingById = new Map(existing.map((finding) => [finding.id, finding]))
      for (const finding of existing) {
        if (!finding.deletedAt || finding.documentId !== input.documentId || finding.reviewId !== input.reviewId) {
          throw new CrudHttpError(409, { error: RECORD_CHANGED_ERROR })
        }
      }
      const openBefore = await countOpenFindings(em, scope, input.documentId)
      if (input.supersede) {
        const previous = await findWithDecryption(
          em,
          DocumentFinding,
          {
            documentId: input.documentId,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            source: input.source,
            status: 'open',
            deletedAt: null,
          },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
          scope,
        )
        for (const finding of previous) {
          if (input.findingIds.includes(finding.id)) continue
          finding.status = 'superseded'
          finding.updatedAt = nextDocumentVersion(finding.updatedAt)
          superseded.push(finding)
        }
      }
      if (openBefore - superseded.length + input.findings.length > DOCUMENTS_MAX_OPEN_FINDINGS_PER_DOCUMENT) {
        throw new CrudHttpError(422, { error: 'documents.findings.openLimitExceeded' })
      }
      const content = await loadDocumentContent(em, input.documentId, scope)
      const anchorer = createFindingAnchorer(content?.yjsState ?? null)
      try {
        input.findings.forEach((item, position) => {
          const findingId = input.findingIds[position]
          if (!findingId) throw new Error('[internal] finding id missing for ingest item')
          const anchor = anchorer.locate({
            quote: item.quote,
            occurrence: item.occurrence,
            sectionLabel: item.sectionLabel ?? null,
          })
          if (anchor.anchorStatus === 'unlocated') unlocated += 1
          const revived = existingById.get(findingId)
          const finding = revived ?? em.create(DocumentFinding, {
            id: findingId,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            documentId: input.documentId,
            reviewId: input.reviewId,
            source: input.source,
            severity: item.severity,
            title: item.title,
            explanation: item.explanation,
            quote: item.quote,
            anchorStatus: anchor.anchorStatus,
            status: 'open',
            createdByUserId: actorUserId,
          })
          applyIngestFields(finding, input, item, anchor, actorUserId)
          finding.updatedAt = nextDocumentVersion(finding.updatedAt)
          if (!revived) em.persist(finding)
          created.push(finding)
        })
      } finally {
        anchorer.dispose()
      }
    }, async () => {
      openBlockingAfter = await countOpenBlockingFindings(em, scope, input.documentId, input.reviewId)
    }], { transaction: true, label: 'documents.finding.ingest' })

    const counts = countFindingsBySeverity(created)
    const reviewCleared = openBlockingAfter === 0
    const projections: DocumentsProjectionDescriptor[] = [
      {
        kind: 'event',
        eventId: 'documents.finding.ingested',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        payload: {
          documentId: input.documentId,
          reviewId: input.reviewId,
          counts,
          unlocatedCount: unlocated,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
      },
      ...(reviewCleared
        ? [reviewClearedProjection(scope, {
          documentId: input.documentId,
          reviewId: input.reviewId,
          decidedByUserId: actorUserId,
        })]
        : []),
    ]
    return {
      reviewId: input.reviewId,
      created: created.length,
      superseded: superseded.length,
      unlocated,
      counts,
      findingIds: created.map((finding) => finding.id),
      resolvedInput: input,
      reviewCleared,
      projections,
      undo: {
        created: created.map((finding) => ({ id: finding.id, updatedAt: finding.updatedAt.toISOString() })),
        superseded: superseded.map((finding) => ({ id: finding.id, updatedAt: finding.updatedAt.toISOString() })),
      },
    }
  },
  async buildLog({ result }) {
    const { translate } = await resolveTranslations()
    const input = result.resolvedInput
    return {
      actionLabel: translate('documents.audit.findingsIngested', 'Ingest review findings'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentFinding,
      resourceId: result.reviewId,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.document,
      parentResourceId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotAfter: {
        reviewId: result.reviewId,
        created: result.created,
        superseded: result.superseded,
        unlocated: result.unlocated,
        counts: result.counts,
      },
      context: { reviewId: result.reviewId, emittedEvents: emittedEventIds(result.projections) },
      payload: {
        undo: result.undo,
        __redoInput: {
          ...input,
          findingIds: result.findingIds,
        } satisfies FindingIngestCommandInput,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<FindingIngestUndoPayload>(logEntry)
    if (!undo) return
    const input = findingIngestCommandInputSchema.parse(readCommandRedoInput(logEntry))
    const scope = resolveIngestScope(ctx, input)
    const created = z.array(findingVersionSchema).parse(undo.created)
    const superseded = z.array(findingVersionSchema).parse(undo.superseded)
    const em = resolveEntityManager(ctx)
    await withAtomicFlush(em, [async () => {
      await loadLockedDocument(em, scope, input.documentId)
      await assertCanDecide(ctx, em, scope, input.documentId)
      for (const version of created) {
        const finding = await loadFinding(em, scope, input.documentId, version.id)
        assertVersionUnchanged(finding, version, 'open')
        const now = nextDocumentVersion(finding.updatedAt)
        finding.deletedAt = now
        finding.updatedAt = now
      }
      for (const version of superseded) {
        const finding = await loadFinding(em, scope, input.documentId, version.id)
        assertVersionUnchanged(finding, version, 'superseded')
        finding.status = 'open'
        finding.updatedAt = nextDocumentVersion(finding.updatedAt)
      }
    }], { transaction: true, label: 'documents.finding.ingest.undo' })
  },
}

type DecisionInput = FindingApplyCommandInput | FindingKeepCommandInput | FindingReopenCommandInput

const DECISION_EVENTS = {
  apply: 'documents.finding.applied',
  keep: 'documents.finding.kept',
  reopen: 'documents.finding.reopened',
} as const

const DECISION_AUDIT_LABELS = {
  apply: { key: 'documents.audit.findingApplied', fallback: 'Apply review finding' },
  keep: { key: 'documents.audit.findingKept', fallback: 'Keep text for review finding' },
  reopen: { key: 'documents.audit.findingReopened', fallback: 'Reopen review finding' },
} as const

function assertDecisionAllowed(kind: DecisionKind, finding: DocumentFinding, input: DecisionInput): void {
  if (kind === 'reopen') {
    if (finding.status !== 'applied' && finding.status !== 'kept') {
      throw new CrudHttpError(409, { error: 'documents.findings.notDecided' })
    }
    return
  }
  if (finding.status !== 'open') {
    throw new CrudHttpError(409, { error: 'documents.findings.notOpen' })
  }
  if (kind === 'apply' && !finding.suggestedText) {
    throw new CrudHttpError(422, { error: 'documents.findings.noSuggestion' })
  }
  if (kind === 'apply' && finding.anchorStatus === 'unlocated') {
    throw new CrudHttpError(422, { error: 'documents.findings.unlocated' })
  }
  if (kind === 'keep') {
    const note = 'note' in input && typeof input.note === 'string' ? input.note.trim() : ''
    if (finding.severity === 'blocking' && !note) {
      throw new CrudHttpError(422, { error: 'documents.findings.noteRequired' })
    }
  }
}

function applyDecision(
  kind: DecisionKind,
  finding: DocumentFinding,
  input: DecisionInput,
  now: Date,
): void {
  if (kind === 'reopen') {
    finding.status = 'open'
    finding.appliedText = null
    finding.decisionNote = null
    finding.decidedByUserId = null
    finding.decidedAt = null
  } else {
    finding.status = kind === 'apply' ? 'applied' : 'kept'
    finding.appliedText = kind === 'apply' && 'appliedText' in input ? input.appliedText : null
    const note = 'note' in input && typeof input.note === 'string' ? input.note.trim() : ''
    finding.decisionNote = kind === 'keep' && note ? note : null
    finding.decidedByUserId = input.actorUserId
    finding.decidedAt = now
  }
  finding.updatedAt = nextDocumentVersion(finding.updatedAt, now)
}

function buildDecisionCommand<TInput extends DecisionInput>(
  kind: DecisionKind,
  schema: z.ZodType<TInput>,
): CommandHandler<TInput, FindingDecisionCommandResult> {
  const commandId = `documents.finding.${kind}`
  return {
    id: commandId,
    async prepare(rawInput, ctx) {
      const input = schema.parse(rawInput)
      assertActor(input, ctx)
      resolveDocumentsCommandScope(ctx, input)
      const em = ctx.container.resolve('em') as EntityManager
      await assertCanDecide(ctx, em, input, input.documentId)
      return null
    },
    async execute(rawInput, ctx) {
      const input = schema.parse(rawInput)
      const scope = resolveDocumentsCommandScope(ctx, input)
      const em = resolveEntityManager(ctx)
      let finding: DocumentFinding | null = null
      let before: FindingState | null = null
      let after: FindingState | null = null
      let openBlockingBefore: number | null = null
      let openBlockingAfter = 0
      await withAtomicFlush(em, [async () => {
        await loadLockedDocument(em, scope, input.documentId)
        assertActor(input, ctx)
        await assertCanDecide(ctx, em, scope, input.documentId)
        finding = await loadFinding(em, scope, input.documentId, input.findingId)
        if (!finding || finding.deletedAt) throw new CrudHttpError(404, { error: 'documents.findings.notFound' })
        if (input.redoExpectation) {
          if (!findingStateMatches(finding, input.redoExpectation)) {
            throw new CrudHttpError(409, { error: RECORD_CHANGED_ERROR })
          }
        } else {
          assertOptimisticLock({
            resourceKind: DOCUMENTS_ENTITY_IDS.documentFinding,
            resourceId: finding.id,
            current: finding.updatedAt,
            expected: input.expectedUpdatedAt,
          })
        }
        assertDecisionAllowed(kind, finding, input)
        before = captureFindingState(finding)
        if (kind !== 'reopen') {
          openBlockingBefore = await countLatestReviewOpenBlocking(em, scope, input.documentId, finding.reviewId)
        }
        applyDecision(kind, finding, input, new Date())
      }, async () => {
        const decided = finding as DocumentFinding | null
        if (!decided) throw new Error('[internal] finding decision produced no row')
        after = captureFindingState(decided)
        if (openBlockingBefore !== null) {
          openBlockingAfter = await countOpenBlockingFindings(em, scope, input.documentId, decided.reviewId)
        }
      }], { transaction: true, label: commandId })
      const decided = finding as DocumentFinding | null
      const beforeState = before as FindingState | null
      const afterState = after as FindingState | null
      if (!decided || !beforeState || !afterState) throw new Error('[internal] finding decision produced no snapshot')
      const reviewCleared = isReviewClearedTransition(openBlockingBefore, openBlockingAfter)
      const projections: DocumentsProjectionDescriptor[] = [
        findingEventProjection(DECISION_EVENTS[kind], scope, decided),
        ...(reviewCleared
          ? [reviewClearedProjection(scope, {
            documentId: input.documentId,
            reviewId: decided.reviewId,
            decidedByUserId: input.actorUserId,
          })]
          : []),
      ]
      return {
        id: decided.id,
        reviewId: decided.reviewId,
        finding: serializeDocumentFinding(decided),
        reviewCleared,
        before: beforeState,
        after: afterState,
        projections,
      }
    },
    async buildLog({ input, result }) {
      const parsed = schema.parse(input)
      const before = findingStateSchema.parse(result.before)
      const after = findingStateSchema.parse(result.after)
      const { translate } = await resolveTranslations()
      const label = DECISION_AUDIT_LABELS[kind]
      return {
        actionLabel: translate(label.key, label.fallback),
        resourceKind: DOCUMENTS_ENTITY_IDS.documentFinding,
        resourceId: result.id,
        parentResourceKind: DOCUMENTS_ENTITY_IDS.document,
        parentResourceId: parsed.documentId,
        tenantId: parsed.tenantId,
        organizationId: parsed.organizationId,
        snapshotBefore: before,
        snapshotAfter: after,
        context: { reviewId: result.reviewId, emittedEvents: emittedEventIds(result.projections) },
        payload: {
          undo: { before, after } satisfies FindingDecisionUndoPayload,
          __redoInput: { ...parsed, expectedUpdatedAt: null, redoExpectation: before },
        },
      }
    },
    async undo({ logEntry, ctx }) {
      const undo = extractUndoPayload<FindingDecisionUndoPayload>(logEntry)
      if (!undo?.before || !undo.after) return
      const input = schema.parse(readCommandRedoInput(logEntry))
      const scope = resolveDocumentsCommandScope(ctx, input)
      const before = findingStateSchema.parse(undo.before)
      const after = findingStateSchema.parse(undo.after)
      const em = resolveEntityManager(ctx)
      await withAtomicFlush(em, [async () => {
        await loadLockedDocument(em, scope, input.documentId)
        await assertCanDecide(ctx, em, scope, input.documentId)
        const finding = await loadFinding(em, scope, input.documentId, after.id)
        assertFindingUnchanged(finding, after)
        restoreFindingState(finding, before)
      }], { transaction: true, label: `${commandId}.undo` })
    },
  }
}

export const applyFindingCommand = buildDecisionCommand('apply', findingApplyCommandSchema)
export const keepFindingCommand = buildDecisionCommand('keep', findingKeepCommandSchema)
export const reopenFindingCommand = buildDecisionCommand('reopen', findingReopenCommandSchema)

registerCommand(ingestFindingsCommand)
registerCommand(applyFindingCommand)
registerCommand(keepFindingCommand)
registerCommand(reopenFindingCommand)
