import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  assertOptimisticLock,
  enforceCommandOptimisticLock,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  DocumentReviewPlaybook,
  DocumentReviewPlaybookReference,
  DocumentReviewRule,
} from '../data/entities'
import {
  documentFindingSeveritySchema,
  reviewPlaybookCreateSchema,
  reviewPlaybookUpdateSchema,
  reviewRuleCreateSchema,
  reviewRuleUpdateSchema,
} from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import {
  DOCUMENTS_MAX_ACTIVE_RULES_PER_PLAYBOOK,
  DOCUMENTS_MAX_REFERENCES_PER_PLAYBOOK,
} from '../lib/resourceLimits'
import { nextDocumentVersion, readCommandRedoInput } from './mutation-helpers'
import {
  assertCommandFeature,
  assertDocumentCommandCapability,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandEntityManager,
  resolveDocumentsCommandFeatures,
  resolveDocumentsCommandScope,
  type DocumentsCommandScope,
} from './shared'

export const REVIEW_PLAYBOOKS_MANAGE_FEATURE = 'documents.review_playbooks.manage'

const RECORD_CHANGED_ERROR = 'Record changed by another user'

const scopeSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

const expectedUpdatedAtSchema = z.string().datetime({ offset: true }).nullable().optional()

export const reviewPlaybookCreateCommandSchema = scopeSchema.extend({
  playbookId: z.string().uuid(),
  playbook: reviewPlaybookCreateSchema,
})

export const reviewPlaybookUpdateCommandSchema = scopeSchema.extend({
  playbook: reviewPlaybookUpdateSchema,
})

export const reviewPlaybookDeleteCommandSchema = scopeSchema.extend({
  playbookId: z.string().uuid(),
  expectedUpdatedAt: expectedUpdatedAtSchema,
})

export const reviewRuleCreateCommandSchema = scopeSchema.extend({
  ruleId: z.string().uuid(),
  rule: reviewRuleCreateSchema,
})

export const reviewRuleUpdateCommandSchema = scopeSchema.extend({
  rule: reviewRuleUpdateSchema,
})

export const reviewRuleDeleteCommandSchema = scopeSchema.extend({
  ruleId: z.string().uuid(),
  expectedUpdatedAt: expectedUpdatedAtSchema,
})

export const reviewPlaybookReferenceCreateCommandSchema = scopeSchema.extend({
  referenceId: z.string().uuid(),
  playbookId: z.string().uuid(),
  documentId: z.string().uuid(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
})

export const reviewPlaybookReferenceDeleteCommandSchema = scopeSchema.extend({
  playbookId: z.string().uuid(),
  documentId: z.string().uuid(),
})

export type ReviewPlaybookCreateCommandInput = z.infer<typeof reviewPlaybookCreateCommandSchema>
export type ReviewPlaybookUpdateCommandInput = z.infer<typeof reviewPlaybookUpdateCommandSchema>
export type ReviewPlaybookDeleteCommandInput = z.infer<typeof reviewPlaybookDeleteCommandSchema>
export type ReviewRuleCreateCommandInput = z.infer<typeof reviewRuleCreateCommandSchema>
export type ReviewRuleUpdateCommandInput = z.infer<typeof reviewRuleUpdateCommandSchema>
export type ReviewRuleDeleteCommandInput = z.infer<typeof reviewRuleDeleteCommandSchema>
export type ReviewPlaybookReferenceCreateCommandInput = z.infer<typeof reviewPlaybookReferenceCreateCommandSchema>
export type ReviewPlaybookReferenceDeleteCommandInput = z.infer<typeof reviewPlaybookReferenceDeleteCommandSchema>

const playbookStateSchema = z.object({
  id: z.string().uuid(),
  existed: z.boolean(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  instructions: z.string().nullable(),
  version: z.number().int(),
  isActive: z.boolean(),
  deletedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const ruleStateSchema = z.object({
  id: z.string().uuid(),
  existed: z.boolean(),
  playbookId: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  topic: z.string().nullable(),
  position: z.string(),
  preferredWording: z.string().nullable(),
  severity: documentFindingSeveritySchema,
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  deletedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const referenceStateSchema = z.object({
  id: z.string().uuid(),
  existed: z.boolean(),
  playbookId: z.string().uuid(),
  documentId: z.string().uuid(),
  sortOrder: z.number().int(),
  deletedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type ReviewPlaybookState = z.infer<typeof playbookStateSchema>
export type ReviewRuleState = z.infer<typeof ruleStateSchema>
export type ReviewPlaybookReferenceState = z.infer<typeof referenceStateSchema>

type SnapshotUndoPayload<TState> = { before: TState; after: TState }

export type ReviewPlaybookCommandResult = {
  id: string
  updatedAt: string
  version: number
  before: ReviewPlaybookState
  after: ReviewPlaybookState
}

export type ReviewRuleCommandResult = {
  id: string
  playbookId: string
  updatedAt: string
  playbookVersion: number
  before: ReviewRuleState
  after: ReviewRuleState
}

export type ReviewPlaybookReferenceCommandResult = {
  id: string
  playbookId: string
  documentId: string
  before: ReviewPlaybookReferenceState
  after: ReviewPlaybookReferenceState
}

async function reviewError(status: number, key: string, fallback: string): Promise<CrudHttpError> {
  try {
    const { translate } = await resolveTranslations()
    return new CrudHttpError(status, { error: translate(key, fallback), code: key })
  } catch {
    return new CrudHttpError(status, { error: fallback, code: key })
  }
}

async function authorizeReviewPlaybookMutation(
  ctx: CommandRuntimeContext,
  input: DocumentsCommandScope,
): Promise<DocumentsCommandScope> {
  const scope = resolveDocumentsCommandScope(ctx, input)
  resolveDocumentsCommandActor(ctx)
  const features = await resolveDocumentsCommandFeatures(ctx, scope)
  assertCommandFeature(features, REVIEW_PLAYBOOKS_MANAGE_FEATURE)
  return scope
}

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function capturePlaybookState(playbook: DocumentReviewPlaybook, existed = true): ReviewPlaybookState {
  return {
    id: playbook.id,
    existed,
    code: playbook.code,
    name: playbook.name,
    description: playbook.description ?? null,
    instructions: playbook.instructions ?? null,
    version: playbook.version,
    isActive: playbook.isActive,
    deletedAt: isoOrNull(playbook.deletedAt),
    updatedAt: isoOrNull(playbook.updatedAt),
  }
}

function captureRuleState(rule: DocumentReviewRule, existed = true): ReviewRuleState {
  return {
    id: rule.id,
    existed,
    playbookId: rule.playbookId,
    code: rule.code,
    title: rule.title,
    topic: rule.topic ?? null,
    position: rule.position,
    preferredWording: rule.preferredWording ?? null,
    severity: rule.severity,
    sortOrder: rule.sortOrder,
    isActive: rule.isActive,
    deletedAt: isoOrNull(rule.deletedAt),
    updatedAt: isoOrNull(rule.updatedAt),
  }
}

function captureReferenceState(reference: DocumentReviewPlaybookReference, existed = true): ReviewPlaybookReferenceState {
  return {
    id: reference.id,
    existed,
    playbookId: reference.playbookId,
    documentId: reference.documentId,
    sortOrder: reference.sortOrder,
    deletedAt: isoOrNull(reference.deletedAt),
    updatedAt: isoOrNull(reference.updatedAt),
  }
}

function absentState<TState extends { existed: boolean; deletedAt: string | null; updatedAt: string | null }>(
  state: TState,
): TState {
  return { ...state, existed: false, deletedAt: null, updatedAt: null }
}

export async function loadReviewPlaybook(
  em: EntityManager,
  scope: DocumentsCommandScope,
  playbookId: string,
  lock = false,
): Promise<DocumentReviewPlaybook | null> {
  return findOneWithDecryption(
    em,
    DocumentReviewPlaybook,
    { id: playbookId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { filters: false, ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}) },
    scope,
  )
}

async function loadRule(
  em: EntityManager,
  scope: DocumentsCommandScope,
  ruleId: string,
  lock = false,
): Promise<DocumentReviewRule | null> {
  return findOneWithDecryption(
    em,
    DocumentReviewRule,
    { id: ruleId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { filters: false, ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}) },
    scope,
  )
}

async function loadReference(
  em: EntityManager,
  scope: DocumentsCommandScope,
  where: { id: string } | { playbookId: string; documentId: string; deletedAt: null },
): Promise<DocumentReviewPlaybookReference | null> {
  return findOneWithDecryption(
    em,
    DocumentReviewPlaybookReference,
    { ...where, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE },
    scope,
  )
}

async function requireActivePlaybook(
  em: EntityManager,
  scope: DocumentsCommandScope,
  playbookId: string,
): Promise<DocumentReviewPlaybook> {
  const playbook = await loadReviewPlaybook(em, scope, playbookId, true)
  if (!playbook || playbook.deletedAt) {
    throw await reviewError(404, 'documents.reviewPlaybooks.errors.notFound', 'Review playbook not found.')
  }
  return playbook
}

async function assertPlaybookCodeAvailable(
  em: EntityManager,
  scope: DocumentsCommandScope,
  code: string,
  playbookId: string,
): Promise<void> {
  const clash = await findOneWithDecryption(
    em,
    DocumentReviewPlaybook,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      code,
      deletedAt: null,
      id: { $ne: playbookId },
    },
    { fields: ['id'] },
    scope,
  )
  if (clash) {
    throw await reviewError(409, 'documents.reviewPlaybooks.errors.codeTaken', 'A playbook with this code already exists.')
  }
}

async function assertRuleCodeAvailable(
  em: EntityManager,
  scope: DocumentsCommandScope,
  playbookId: string,
  code: string,
  ruleId: string,
): Promise<void> {
  const clash = await findOneWithDecryption(
    em,
    DocumentReviewRule,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      playbookId,
      code,
      deletedAt: null,
      id: { $ne: ruleId },
    },
    { fields: ['id'] },
    scope,
  )
  if (clash) {
    throw await reviewError(409, 'documents.reviewPlaybooks.errors.ruleCodeTaken', 'This playbook already has a rule with this code.')
  }
}

async function assertActiveRuleCapacity(
  em: EntityManager,
  scope: DocumentsCommandScope,
  playbookId: string,
  ruleId: string,
): Promise<void> {
  const active = await em.count(DocumentReviewRule, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    playbookId,
    isActive: true,
    deletedAt: null,
    id: { $ne: ruleId },
  })
  if (active >= DOCUMENTS_MAX_ACTIVE_RULES_PER_PLAYBOOK) {
    throw await reviewError(422, 'documents.reviewPlaybooks.errors.ruleLimit', 'This playbook already has the maximum number of active rules.')
  }
}

async function assertReferenceCapacity(
  em: EntityManager,
  scope: DocumentsCommandScope,
  playbookId: string,
  documentId: string,
): Promise<void> {
  const existing = await findOneWithDecryption(
    em,
    DocumentReviewPlaybookReference,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, playbookId, documentId, deletedAt: null },
    { fields: ['id'] },
    scope,
  )
  if (existing) {
    throw await reviewError(409, 'documents.reviewPlaybooks.errors.referenceExists', 'This document is already linked to the playbook.')
  }
  const linked = await em.count(DocumentReviewPlaybookReference, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    playbookId,
    deletedAt: null,
  })
  if (linked >= DOCUMENTS_MAX_REFERENCES_PER_PLAYBOOK) {
    throw await reviewError(422, 'documents.reviewPlaybooks.errors.referenceLimit', 'This playbook already has the maximum number of guidance documents.')
  }
}

/**
 * Bumps the playbook version without touching its optimistic-lock token, so a
 * rule or guidance change does not invalidate an open playbook form.
 */
export async function bumpReviewPlaybookVersion(
  em: EntityManager,
  scope: DocumentsCommandScope,
  playbookId: string,
): Promise<number> {
  const playbook = await loadReviewPlaybook(em, scope, playbookId, true)
  if (!playbook) return 0
  const nextVersion = playbook.version + 1
  await em.nativeUpdate(
    DocumentReviewPlaybook,
    { id: playbookId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { version: nextVersion },
  )
  return nextVersion
}

function assertSnapshotUnchanged(
  entity: { id: string; updatedAt: Date; deletedAt?: Date | null } | null,
  expected: { id: string; updatedAt: string | null; deletedAt: string | null },
  resourceKind: string,
): asserts entity is { id: string; updatedAt: Date; deletedAt?: Date | null } {
  if (!entity || !expected.updatedAt) throw new CrudHttpError(409, { error: RECORD_CHANGED_ERROR })
  assertOptimisticLock({
    resourceKind,
    resourceId: expected.id,
    current: entity.updatedAt,
    expected: expected.updatedAt,
    envValue: 'all',
  })
  if (isoOrNull(entity.deletedAt) !== expected.deletedAt) {
    throw new CrudHttpError(409, { error: RECORD_CHANGED_ERROR })
  }
}

function resolveDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve('dataEngine') as DataEngine
}

async function bufferPlaybookSideEffect(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  playbook: DocumentReviewPlaybook,
  undo = false,
): Promise<void> {
  const emit = undo ? emitCrudUndoSideEffects : emitCrudSideEffects
  await emit({
    dataEngine: resolveDataEngine(ctx),
    action,
    entity: playbook,
    identifiers: { id: playbook.id, tenantId: playbook.tenantId, organizationId: playbook.organizationId },
    indexer: { entityType: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook },
    events: {
      module: 'documents',
      entity: 'review_playbook',
      buildPayload: () => ({
        id: playbook.id,
        tenantId: playbook.tenantId,
        organizationId: playbook.organizationId,
      }),
    },
  })
}

async function bufferRuleSideEffect(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  rule: DocumentReviewRule,
  undo = false,
): Promise<void> {
  const emit = undo ? emitCrudUndoSideEffects : emitCrudSideEffects
  await emit({
    dataEngine: resolveDataEngine(ctx),
    action,
    entity: rule,
    identifiers: { id: rule.id, tenantId: rule.tenantId, organizationId: rule.organizationId },
    indexer: { entityType: DOCUMENTS_ENTITY_IDS.documentReviewRule },
    events: {
      module: 'documents',
      entity: 'review_rule',
      buildPayload: () => ({
        id: rule.id,
        playbookId: rule.playbookId,
        tenantId: rule.tenantId,
        organizationId: rule.organizationId,
      }),
    },
  })
}

async function bufferReferenceSideEffect(
  ctx: CommandRuntimeContext,
  action: 'created' | 'deleted',
  reference: DocumentReviewPlaybookReference,
  undo = false,
): Promise<void> {
  const emit = undo ? emitCrudUndoSideEffects : emitCrudSideEffects
  await emit({
    dataEngine: resolveDataEngine(ctx),
    action,
    entity: reference,
    identifiers: { id: reference.id, tenantId: reference.tenantId, organizationId: reference.organizationId },
    events: {
      module: 'documents',
      entity: 'review_playbook_reference',
      buildPayload: () => ({
        playbookId: reference.playbookId,
        documentId: reference.documentId,
        tenantId: reference.tenantId,
        organizationId: reference.organizationId,
      }),
    },
  })
}

function readUndo<TState>(
  logEntry: Parameters<NonNullable<CommandHandler['undo']>>[0]['logEntry'],
  schema: z.ZodType<TState>,
): SnapshotUndoPayload<TState> | null {
  const undo = extractUndoPayload<{ before?: unknown; after?: unknown }>(logEntry)
  if (!undo?.before || !undo.after) return null
  return { before: schema.parse(undo.before), after: schema.parse(undo.after) }
}

function undoActionFor(before: { existed: boolean; deletedAt: string | null }): 'created' | 'updated' | 'deleted' {
  if (!before.existed || before.deletedAt) return 'deleted'
  return 'updated'
}

async function buildSnapshotLog<TState>(args: {
  labelKey: string
  labelFallback: string
  resourceKind: string
  resourceId: string
  parentResourceKind?: string
  parentResourceId?: string
  scope: DocumentsCommandScope
  before: TState
  after: TState
  redoInput?: unknown
}) {
  const { translate } = await resolveTranslations()
  return {
    actionLabel: translate(args.labelKey, args.labelFallback),
    resourceKind: args.resourceKind,
    resourceId: args.resourceId,
    ...(args.parentResourceKind ? { parentResourceKind: args.parentResourceKind, parentResourceId: args.parentResourceId } : {}),
    tenantId: args.scope.tenantId,
    organizationId: args.scope.organizationId,
    snapshotBefore: args.before,
    snapshotAfter: args.after,
    payload: {
      undo: { before: args.before, after: args.after },
      ...(args.redoInput !== undefined ? { __redoInput: args.redoInput } : {}),
    },
  }
}

function applyPlaybookFields(
  playbook: DocumentReviewPlaybook,
  values: Partial<{
    code: string
    name: string
    description: string | null
    instructions: string | null
    isActive: boolean
  }>,
  present: (key: string) => boolean,
): void {
  if (values.code !== undefined) playbook.code = values.code
  if (values.name !== undefined) playbook.name = values.name
  if (present('description')) playbook.description = values.description ?? null
  if (present('instructions')) playbook.instructions = values.instructions ?? null
  if (values.isActive !== undefined) playbook.isActive = values.isActive
}

function hasKey(source: object): (key: string) => boolean {
  return (key) => Object.prototype.hasOwnProperty.call(source, key)
}

export const createReviewPlaybookCommand: CommandHandler<ReviewPlaybookCreateCommandInput, ReviewPlaybookCommandResult> = {
  id: 'documents.review_playbook.create',
  async prepare(rawInput, ctx) {
    await authorizeReviewPlaybookMutation(ctx, reviewPlaybookCreateCommandSchema.parse(rawInput))
    return null
  },
  async execute(rawInput, ctx) {
    const input = reviewPlaybookCreateCommandSchema.parse(rawInput)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let playbook!: DocumentReviewPlaybook
    let before!: ReviewPlaybookState
    let after!: ReviewPlaybookState
    await withAtomicFlush(em, [async () => {
      const scope = await authorizeReviewPlaybookMutation(ctx, input)
      const existing = await loadReviewPlaybook(em, scope, input.playbookId, true)
      if (existing && !existing.deletedAt) throw new CrudHttpError(409, { error: RECORD_CHANGED_ERROR })
      await assertPlaybookCodeAvailable(em, scope, input.playbook.code, input.playbookId)
      if (existing) {
        before = capturePlaybookState(existing)
        playbook = existing
        playbook.version += 1
      } else {
        playbook = em.create(DocumentReviewPlaybook, {
          id: input.playbookId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          code: input.playbook.code,
          name: input.playbook.name,
        })
        before = absentState(capturePlaybookState(playbook, false))
        em.persist(playbook)
      }
      applyPlaybookFields(playbook, input.playbook, hasKey(input.playbook))
      playbook.deletedAt = null
      playbook.updatedAt = nextDocumentVersion(playbook.updatedAt)
    }, () => {
      after = capturePlaybookState(playbook)
    }], { transaction: true, label: 'documents.review_playbook.create' })
    await bufferPlaybookSideEffect(ctx, 'created', playbook)
    return { id: playbook.id, updatedAt: playbook.updatedAt.toISOString(), version: playbook.version, before, after }
  },
  async buildLog({ input, result }) {
    return buildSnapshotLog({
      labelKey: 'documents.audit.reviewPlaybookCreated',
      labelFallback: 'Create review playbook',
      resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook,
      resourceId: result.id,
      scope: input,
      before: result.before,
      after: result.after,
    })
  },
  async undo({ logEntry, ctx }) {
    await undoPlaybookSnapshot(logEntry, ctx, reviewPlaybookCreateCommandSchema, 'documents.review_playbook.create.undo')
  },
}

export const updateReviewPlaybookCommand: CommandHandler<ReviewPlaybookUpdateCommandInput, ReviewPlaybookCommandResult> = {
  id: 'documents.review_playbook.update',
  async prepare(rawInput, ctx) {
    await authorizeReviewPlaybookMutation(ctx, reviewPlaybookUpdateCommandSchema.parse(rawInput))
    return null
  },
  async execute(rawInput, ctx) {
    const input = reviewPlaybookUpdateCommandSchema.parse(rawInput)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let playbook!: DocumentReviewPlaybook
    let before!: ReviewPlaybookState
    let after!: ReviewPlaybookState
    await withAtomicFlush(em, [async () => {
      const scope = await authorizeReviewPlaybookMutation(ctx, input)
      playbook = await requireActivePlaybook(em, scope, input.playbook.id)
      enforceCommandOptimisticLock({
        resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook,
        resourceId: playbook.id,
        current: playbook.updatedAt,
        expected: input.playbook.expectedUpdatedAt ?? undefined,
        request: ctx.request,
      })
      if (input.playbook.code !== undefined && input.playbook.code !== playbook.code) {
        await assertPlaybookCodeAvailable(em, scope, input.playbook.code, playbook.id)
      }
      before = capturePlaybookState(playbook)
      applyPlaybookFields(playbook, input.playbook, hasKey(input.playbook))
      playbook.version += 1
      playbook.updatedAt = nextDocumentVersion(playbook.updatedAt)
    }, () => {
      after = capturePlaybookState(playbook)
    }], { transaction: true, label: 'documents.review_playbook.update' })
    await bufferPlaybookSideEffect(ctx, 'updated', playbook)
    return { id: playbook.id, updatedAt: playbook.updatedAt.toISOString(), version: playbook.version, before, after }
  },
  async buildLog({ input, result }) {
    return buildSnapshotLog({
      labelKey: 'documents.audit.reviewPlaybookUpdated',
      labelFallback: 'Update review playbook',
      redoInput: { ...input, playbook: { ...input.playbook, expectedUpdatedAt: null } },
      resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook,
      resourceId: result.id,
      scope: input,
      before: result.before,
      after: result.after,
    })
  },
  async undo({ logEntry, ctx }) {
    await undoPlaybookSnapshot(logEntry, ctx, reviewPlaybookUpdateCommandSchema, 'documents.review_playbook.update.undo')
  },
}

export const deleteReviewPlaybookCommand: CommandHandler<ReviewPlaybookDeleteCommandInput, ReviewPlaybookCommandResult> = {
  id: 'documents.review_playbook.delete',
  async prepare(rawInput, ctx) {
    await authorizeReviewPlaybookMutation(ctx, reviewPlaybookDeleteCommandSchema.parse(rawInput))
    return null
  },
  async execute(rawInput, ctx) {
    const input = reviewPlaybookDeleteCommandSchema.parse(rawInput)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let playbook!: DocumentReviewPlaybook
    let before!: ReviewPlaybookState
    let after!: ReviewPlaybookState
    await withAtomicFlush(em, [async () => {
      const scope = await authorizeReviewPlaybookMutation(ctx, input)
      playbook = await requireActivePlaybook(em, scope, input.playbookId)
      enforceCommandOptimisticLock({
        resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook,
        resourceId: playbook.id,
        current: playbook.updatedAt,
        expected: input.expectedUpdatedAt ?? undefined,
        request: ctx.request,
      })
      before = capturePlaybookState(playbook)
      const now = nextDocumentVersion(playbook.updatedAt)
      playbook.deletedAt = now
      playbook.updatedAt = now
    }, () => {
      after = capturePlaybookState(playbook)
    }], { transaction: true, label: 'documents.review_playbook.delete' })
    await bufferPlaybookSideEffect(ctx, 'deleted', playbook)
    return { id: playbook.id, updatedAt: playbook.updatedAt.toISOString(), version: playbook.version, before, after }
  },
  async buildLog({ input, result }) {
    return buildSnapshotLog({
      labelKey: 'documents.audit.reviewPlaybookDeleted',
      labelFallback: 'Delete review playbook',
      redoInput: { ...input, expectedUpdatedAt: null },
      resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook,
      resourceId: result.id,
      scope: input,
      before: result.before,
      after: result.after,
    })
  },
  async undo({ logEntry, ctx }) {
    await undoPlaybookSnapshot(logEntry, ctx, reviewPlaybookDeleteCommandSchema, 'documents.review_playbook.delete.undo')
  },
}

async function undoPlaybookSnapshot(
  logEntry: Parameters<NonNullable<CommandHandler['undo']>>[0]['logEntry'],
  ctx: CommandRuntimeContext,
  inputSchema: z.ZodType<DocumentsCommandScope>,
  label: string,
): Promise<void> {
  const undo = readUndo(logEntry, playbookStateSchema)
  if (!undo) return
  const input = inputSchema.parse(readCommandRedoInput(logEntry))
  const em = resolveDocumentsCommandEntityManager(ctx)
  let playbook!: DocumentReviewPlaybook
  await withAtomicFlush(em, [async () => {
    const scope = await authorizeReviewPlaybookMutation(ctx, input)
    const current = await loadReviewPlaybook(em, scope, undo.after.id, true)
    assertSnapshotUnchanged(current, undo.after, DOCUMENTS_ENTITY_IDS.documentReviewPlaybook)
    playbook = current as DocumentReviewPlaybook
    const restoresLiveRow = undo.before.existed && !undo.before.deletedAt
    if (restoresLiveRow) await assertPlaybookCodeAvailable(em, scope, undo.before.code, playbook.id)
    const now = nextDocumentVersion(playbook.updatedAt)
    if (!undo.before.existed) {
      playbook.deletedAt = now
    } else {
      playbook.code = undo.before.code
      playbook.name = undo.before.name
      playbook.description = undo.before.description
      playbook.instructions = undo.before.instructions
      playbook.isActive = undo.before.isActive
      playbook.deletedAt = undo.before.deletedAt ? new Date(undo.before.deletedAt) : null
    }
    playbook.version += 1
    playbook.updatedAt = now
  }], { transaction: true, label })
  await bufferPlaybookSideEffect(ctx, undoActionFor(undo.before), playbook, true)
}

function applyRuleFields(
  rule: DocumentReviewRule,
  values: Partial<{
    code: string
    title: string
    topic: string | null
    position: string
    preferredWording: string | null
    severity: DocumentReviewRule['severity']
    sortOrder: number
    isActive: boolean
  }>,
  present: (key: string) => boolean,
): void {
  if (values.code !== undefined) rule.code = values.code
  if (values.title !== undefined) rule.title = values.title
  if (present('topic')) rule.topic = values.topic ?? null
  if (values.position !== undefined) rule.position = values.position
  if (present('preferredWording')) rule.preferredWording = values.preferredWording ?? null
  if (values.severity !== undefined) rule.severity = values.severity
  if (values.sortOrder !== undefined) rule.sortOrder = values.sortOrder
  if (values.isActive !== undefined) rule.isActive = values.isActive
}

export const createReviewRuleCommand: CommandHandler<ReviewRuleCreateCommandInput, ReviewRuleCommandResult> = {
  id: 'documents.review_rule.create',
  async prepare(rawInput, ctx) {
    await authorizeReviewPlaybookMutation(ctx, reviewRuleCreateCommandSchema.parse(rawInput))
    return null
  },
  async execute(rawInput, ctx) {
    const input = reviewRuleCreateCommandSchema.parse(rawInput)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let rule!: DocumentReviewRule
    let before!: ReviewRuleState
    let after!: ReviewRuleState
    let playbookVersion = 0
    await withAtomicFlush(em, [async () => {
      const scope = await authorizeReviewPlaybookMutation(ctx, input)
      await requireActivePlaybook(em, scope, input.rule.playbookId)
      const existing = await loadRule(em, scope, input.ruleId, true)
      if (existing && (!existing.deletedAt || existing.playbookId !== input.rule.playbookId)) {
        throw new CrudHttpError(409, { error: RECORD_CHANGED_ERROR })
      }
      await assertRuleCodeAvailable(em, scope, input.rule.playbookId, input.rule.code, input.ruleId)
      if (input.rule.isActive ?? true) await assertActiveRuleCapacity(em, scope, input.rule.playbookId, input.ruleId)
      if (existing) {
        before = captureRuleState(existing)
        rule = existing
      } else {
        rule = em.create(DocumentReviewRule, {
          id: input.ruleId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          playbookId: input.rule.playbookId,
          code: input.rule.code,
          title: input.rule.title,
          position: input.rule.position,
          severity: input.rule.severity,
        })
        before = absentState(captureRuleState(rule, false))
        em.persist(rule)
      }
      applyRuleFields(rule, input.rule, hasKey(input.rule))
      rule.deletedAt = null
      rule.updatedAt = nextDocumentVersion(rule.updatedAt)
    }, async () => {
      after = captureRuleState(rule)
      playbookVersion = await bumpReviewPlaybookVersion(em, input, rule.playbookId)
    }], { transaction: true, label: 'documents.review_rule.create' })
    await bufferRuleSideEffect(ctx, 'created', rule)
    return { id: rule.id, playbookId: rule.playbookId, updatedAt: rule.updatedAt.toISOString(), playbookVersion, before, after }
  },
  async buildLog({ input, result }) {
    return buildSnapshotLog({
      labelKey: 'documents.audit.reviewRuleCreated',
      labelFallback: 'Create review rule',
      resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewRule,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook,
      parentResourceId: result.playbookId,
      scope: input,
      before: result.before,
      after: result.after,
    })
  },
  async undo({ logEntry, ctx }) {
    await undoRuleSnapshot(logEntry, ctx, reviewRuleCreateCommandSchema, 'documents.review_rule.create.undo')
  },
}

export const updateReviewRuleCommand: CommandHandler<ReviewRuleUpdateCommandInput, ReviewRuleCommandResult> = {
  id: 'documents.review_rule.update',
  async prepare(rawInput, ctx) {
    await authorizeReviewPlaybookMutation(ctx, reviewRuleUpdateCommandSchema.parse(rawInput))
    return null
  },
  async execute(rawInput, ctx) {
    const input = reviewRuleUpdateCommandSchema.parse(rawInput)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let rule!: DocumentReviewRule
    let before!: ReviewRuleState
    let after!: ReviewRuleState
    let playbookVersion = 0
    await withAtomicFlush(em, [async () => {
      const scope = await authorizeReviewPlaybookMutation(ctx, input)
      const current = await loadRule(em, scope, input.rule.id, true)
      if (!current || current.deletedAt) {
        throw await reviewError(404, 'documents.reviewPlaybooks.errors.ruleNotFound', 'Review rule not found.')
      }
      rule = current
      await requireActivePlaybook(em, scope, rule.playbookId)
      enforceCommandOptimisticLock({
        resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewRule,
        resourceId: rule.id,
        current: rule.updatedAt,
        expected: input.rule.expectedUpdatedAt ?? undefined,
        request: ctx.request,
      })
      if (input.rule.code !== undefined && input.rule.code !== rule.code) {
        await assertRuleCodeAvailable(em, scope, rule.playbookId, input.rule.code, rule.id)
      }
      if (input.rule.isActive === true && !rule.isActive) {
        await assertActiveRuleCapacity(em, scope, rule.playbookId, rule.id)
      }
      before = captureRuleState(rule)
      applyRuleFields(rule, input.rule, hasKey(input.rule))
      rule.updatedAt = nextDocumentVersion(rule.updatedAt)
    }, async () => {
      after = captureRuleState(rule)
      playbookVersion = await bumpReviewPlaybookVersion(em, input, rule.playbookId)
    }], { transaction: true, label: 'documents.review_rule.update' })
    await bufferRuleSideEffect(ctx, 'updated', rule)
    return { id: rule.id, playbookId: rule.playbookId, updatedAt: rule.updatedAt.toISOString(), playbookVersion, before, after }
  },
  async buildLog({ input, result }) {
    return buildSnapshotLog({
      labelKey: 'documents.audit.reviewRuleUpdated',
      labelFallback: 'Update review rule',
      redoInput: { ...input, rule: { ...input.rule, expectedUpdatedAt: null } },
      resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewRule,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook,
      parentResourceId: result.playbookId,
      scope: input,
      before: result.before,
      after: result.after,
    })
  },
  async undo({ logEntry, ctx }) {
    await undoRuleSnapshot(logEntry, ctx, reviewRuleUpdateCommandSchema, 'documents.review_rule.update.undo')
  },
}

export const deleteReviewRuleCommand: CommandHandler<ReviewRuleDeleteCommandInput, ReviewRuleCommandResult> = {
  id: 'documents.review_rule.delete',
  async prepare(rawInput, ctx) {
    await authorizeReviewPlaybookMutation(ctx, reviewRuleDeleteCommandSchema.parse(rawInput))
    return null
  },
  async execute(rawInput, ctx) {
    const input = reviewRuleDeleteCommandSchema.parse(rawInput)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let rule!: DocumentReviewRule
    let before!: ReviewRuleState
    let after!: ReviewRuleState
    let playbookVersion = 0
    await withAtomicFlush(em, [async () => {
      const scope = await authorizeReviewPlaybookMutation(ctx, input)
      const current = await loadRule(em, scope, input.ruleId, true)
      if (!current || current.deletedAt) {
        throw await reviewError(404, 'documents.reviewPlaybooks.errors.ruleNotFound', 'Review rule not found.')
      }
      rule = current
      enforceCommandOptimisticLock({
        resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewRule,
        resourceId: rule.id,
        current: rule.updatedAt,
        expected: input.expectedUpdatedAt ?? undefined,
        request: ctx.request,
      })
      before = captureRuleState(rule)
      const now = nextDocumentVersion(rule.updatedAt)
      rule.deletedAt = now
      rule.updatedAt = now
    }, async () => {
      after = captureRuleState(rule)
      playbookVersion = await bumpReviewPlaybookVersion(em, input, rule.playbookId)
    }], { transaction: true, label: 'documents.review_rule.delete' })
    await bufferRuleSideEffect(ctx, 'deleted', rule)
    return { id: rule.id, playbookId: rule.playbookId, updatedAt: rule.updatedAt.toISOString(), playbookVersion, before, after }
  },
  async buildLog({ input, result }) {
    return buildSnapshotLog({
      labelKey: 'documents.audit.reviewRuleDeleted',
      labelFallback: 'Delete review rule',
      redoInput: { ...input, expectedUpdatedAt: null },
      resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewRule,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook,
      parentResourceId: result.playbookId,
      scope: input,
      before: result.before,
      after: result.after,
    })
  },
  async undo({ logEntry, ctx }) {
    await undoRuleSnapshot(logEntry, ctx, reviewRuleDeleteCommandSchema, 'documents.review_rule.delete.undo')
  },
}

async function undoRuleSnapshot(
  logEntry: Parameters<NonNullable<CommandHandler['undo']>>[0]['logEntry'],
  ctx: CommandRuntimeContext,
  inputSchema: z.ZodType<DocumentsCommandScope>,
  label: string,
): Promise<void> {
  const undo = readUndo(logEntry, ruleStateSchema)
  if (!undo) return
  const input = inputSchema.parse(readCommandRedoInput(logEntry))
  const em = resolveDocumentsCommandEntityManager(ctx)
  let rule!: DocumentReviewRule
  await withAtomicFlush(em, [async () => {
    const scope = await authorizeReviewPlaybookMutation(ctx, input)
    const current = await loadRule(em, scope, undo.after.id, true)
    assertSnapshotUnchanged(current, undo.after, DOCUMENTS_ENTITY_IDS.documentReviewRule)
    rule = current as DocumentReviewRule
    const restoresLiveRow = undo.before.existed && !undo.before.deletedAt
    if (restoresLiveRow) {
      await assertRuleCodeAvailable(em, scope, rule.playbookId, undo.before.code, rule.id)
      const wasActive = rule.isActive && !rule.deletedAt
      if (undo.before.isActive && !wasActive) await assertActiveRuleCapacity(em, scope, rule.playbookId, rule.id)
    }
    const now = nextDocumentVersion(rule.updatedAt)
    if (!undo.before.existed) {
      rule.deletedAt = now
    } else {
      rule.code = undo.before.code
      rule.title = undo.before.title
      rule.topic = undo.before.topic
      rule.position = undo.before.position
      rule.preferredWording = undo.before.preferredWording
      rule.severity = undo.before.severity
      rule.sortOrder = undo.before.sortOrder
      rule.isActive = undo.before.isActive
      rule.deletedAt = undo.before.deletedAt ? new Date(undo.before.deletedAt) : null
    }
    rule.updatedAt = now
  }, async () => {
    await bumpReviewPlaybookVersion(em, input, rule.playbookId)
  }], { transaction: true, label })
  await bufferRuleSideEffect(ctx, undoActionFor(undo.before), rule, true)
}

export const createReviewPlaybookReferenceCommand: CommandHandler<
  ReviewPlaybookReferenceCreateCommandInput,
  ReviewPlaybookReferenceCommandResult
> = {
  id: 'documents.review_playbook_reference.create',
  async prepare(rawInput, ctx) {
    await authorizeReviewPlaybookMutation(ctx, reviewPlaybookReferenceCreateCommandSchema.parse(rawInput))
    return null
  },
  async execute(rawInput, ctx) {
    const input = reviewPlaybookReferenceCreateCommandSchema.parse(rawInput)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let reference!: DocumentReviewPlaybookReference
    let before!: ReviewPlaybookReferenceState
    let after!: ReviewPlaybookReferenceState
    await withAtomicFlush(em, [async () => {
      const scope = await authorizeReviewPlaybookMutation(ctx, input)
      await requireActivePlaybook(em, scope, input.playbookId)
      await assertDocumentCommandCapability(ctx, em, input.documentId, scope, 'canView')
      const existing = await loadReference(em, scope, { id: input.referenceId })
      if (existing && (!existing.deletedAt || existing.playbookId !== input.playbookId || existing.documentId !== input.documentId)) {
        throw new CrudHttpError(409, { error: RECORD_CHANGED_ERROR })
      }
      await assertReferenceCapacity(em, scope, input.playbookId, input.documentId)
      if (existing) {
        before = captureReferenceState(existing)
        reference = existing
      } else {
        reference = em.create(DocumentReviewPlaybookReference, {
          id: input.referenceId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          playbookId: input.playbookId,
          documentId: input.documentId,
        })
        before = absentState(captureReferenceState(reference, false))
        em.persist(reference)
      }
      if (input.sortOrder !== undefined) reference.sortOrder = input.sortOrder
      reference.deletedAt = null
      reference.updatedAt = nextDocumentVersion(reference.updatedAt)
    }, async () => {
      after = captureReferenceState(reference)
      await bumpReviewPlaybookVersion(em, input, input.playbookId)
    }], { transaction: true, label: 'documents.review_playbook_reference.create' })
    await bufferReferenceSideEffect(ctx, 'created', reference)
    return { id: reference.id, playbookId: reference.playbookId, documentId: reference.documentId, before, after }
  },
  async buildLog({ input, result }) {
    return buildSnapshotLog({
      labelKey: 'documents.audit.reviewPlaybookReferenceCreated',
      labelFallback: 'Link guidance document to review playbook',
      resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybookReference,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook,
      parentResourceId: result.playbookId,
      scope: input,
      before: result.before,
      after: result.after,
    })
  },
  async undo({ logEntry, ctx }) {
    await undoReferenceSnapshot(logEntry, ctx, reviewPlaybookReferenceCreateCommandSchema, 'documents.review_playbook_reference.create.undo')
  },
}

export const deleteReviewPlaybookReferenceCommand: CommandHandler<
  ReviewPlaybookReferenceDeleteCommandInput,
  ReviewPlaybookReferenceCommandResult
> = {
  id: 'documents.review_playbook_reference.delete',
  async prepare(rawInput, ctx) {
    await authorizeReviewPlaybookMutation(ctx, reviewPlaybookReferenceDeleteCommandSchema.parse(rawInput))
    return null
  },
  async execute(rawInput, ctx) {
    const input = reviewPlaybookReferenceDeleteCommandSchema.parse(rawInput)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let reference!: DocumentReviewPlaybookReference
    let before!: ReviewPlaybookReferenceState
    let after!: ReviewPlaybookReferenceState
    await withAtomicFlush(em, [async () => {
      const scope = await authorizeReviewPlaybookMutation(ctx, input)
      await requireActivePlaybook(em, scope, input.playbookId)
      const current = await loadReference(em, scope, {
        playbookId: input.playbookId,
        documentId: input.documentId,
        deletedAt: null,
      })
      if (!current) {
        throw await reviewError(404, 'documents.reviewPlaybooks.errors.referenceNotFound', 'Guidance document is not linked to this playbook.')
      }
      reference = current
      before = captureReferenceState(reference)
      const now = nextDocumentVersion(reference.updatedAt)
      reference.deletedAt = now
      reference.updatedAt = now
    }, async () => {
      after = captureReferenceState(reference)
      await bumpReviewPlaybookVersion(em, input, input.playbookId)
    }], { transaction: true, label: 'documents.review_playbook_reference.delete' })
    await bufferReferenceSideEffect(ctx, 'deleted', reference)
    return { id: reference.id, playbookId: reference.playbookId, documentId: reference.documentId, before, after }
  },
  async buildLog({ input, result }) {
    return buildSnapshotLog({
      labelKey: 'documents.audit.reviewPlaybookReferenceDeleted',
      labelFallback: 'Unlink guidance document from review playbook',
      resourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybookReference,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.documentReviewPlaybook,
      parentResourceId: result.playbookId,
      scope: input,
      before: result.before,
      after: result.after,
    })
  },
  async undo({ logEntry, ctx }) {
    await undoReferenceSnapshot(logEntry, ctx, reviewPlaybookReferenceDeleteCommandSchema, 'documents.review_playbook_reference.delete.undo')
  },
}

async function undoReferenceSnapshot(
  logEntry: Parameters<NonNullable<CommandHandler['undo']>>[0]['logEntry'],
  ctx: CommandRuntimeContext,
  inputSchema: z.ZodType<DocumentsCommandScope>,
  label: string,
): Promise<void> {
  const undo = readUndo(logEntry, referenceStateSchema)
  if (!undo) return
  const input = inputSchema.parse(readCommandRedoInput(logEntry))
  const em = resolveDocumentsCommandEntityManager(ctx)
  let reference!: DocumentReviewPlaybookReference
  await withAtomicFlush(em, [async () => {
    const scope = await authorizeReviewPlaybookMutation(ctx, input)
    const current = await loadReference(em, scope, { id: undo.after.id })
    assertSnapshotUnchanged(current, undo.after, DOCUMENTS_ENTITY_IDS.documentReviewPlaybookReference)
    reference = current as DocumentReviewPlaybookReference
    const restoresLiveRow = undo.before.existed && !undo.before.deletedAt
    if (restoresLiveRow) {
      await assertDocumentCommandCapability(ctx, em, reference.documentId, scope, 'canView')
      await assertReferenceCapacity(em, scope, reference.playbookId, reference.documentId)
    }
    const now = nextDocumentVersion(reference.updatedAt)
    reference.deletedAt = !undo.before.existed
      ? now
      : (undo.before.deletedAt ? new Date(undo.before.deletedAt) : null)
    if (undo.before.existed) reference.sortOrder = undo.before.sortOrder
    reference.updatedAt = now
  }, async () => {
    await bumpReviewPlaybookVersion(em, input, reference.playbookId)
  }], { transaction: true, label })
  await bufferReferenceSideEffect(ctx, undoActionFor(undo.before) === 'deleted' ? 'deleted' : 'created', reference, true)
}

registerCommand(createReviewPlaybookCommand)
registerCommand(updateReviewPlaybookCommand)
registerCommand(deleteReviewPlaybookCommand)
registerCommand(createReviewRuleCommand)
registerCommand(updateReviewRuleCommand)
registerCommand(deleteReviewRuleCommand)
registerCommand(createReviewPlaybookReferenceCommand)
registerCommand(deleteReviewPlaybookReferenceCommand)
