import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  assertOptimisticLock,
  buildOptimisticLockConflictBody,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DocumentTemplate } from '../data/entities'
import {
  documentTemplateContextSlotsSchema,
  documentTemplateCreateSchema,
  documentTemplateUpdateSchema,
} from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import {
  assertCommandFeature,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandFeatures,
  resolveDocumentsCommandScope,
} from './shared'
import { nextDocumentVersion } from './mutation-helpers'

const scopeSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

const templateStateSchema = z.object({
  id: z.string().uuid(),
  existed: z.boolean(),
  name: z.string(),
  description: z.string().nullable(),
  bodyHtml: z.string(),
  contextSlots: documentTemplateContextSlotsSchema.nullable(),
  seedKey: z.string().nullable(),
  createdByUserId: z.string().uuid(),
  isActive: z.boolean(),
  deletedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
})

const templateRedoExpectationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snapshot'), state: templateStateSchema }),
  z.object({ kind: z.literal('soft-deleted-created'), state: templateStateSchema }),
])

const templateCommandBaseSchema = scopeSchema.extend({
  actorUserId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime().nullable().optional(),
  redoExpectation: templateRedoExpectationSchema.optional(),
})

export const templateCreateCommandSchema = templateCommandBaseSchema.extend({
  templateId: z.string().uuid(),
  template: documentTemplateCreateSchema,
})

export const templateUpdateCommandSchema = templateCommandBaseSchema.extend({
  template: documentTemplateUpdateSchema,
})

export const templateDeleteCommandSchema = templateCommandBaseSchema.extend({
  templateId: z.string().uuid(),
})

export type TemplateCreateCommandInput = z.infer<typeof templateCreateCommandSchema>
export type TemplateUpdateCommandInput = z.infer<typeof templateUpdateCommandSchema>
export type TemplateDeleteCommandInput = z.infer<typeof templateDeleteCommandSchema>
export type TemplateState = z.infer<typeof templateStateSchema>
export type TemplateRedoExpectation = z.infer<typeof templateRedoExpectationSchema>

export type TemplateCommandResult = {
  id: string
  updatedAt: string
  before: TemplateState
  after: TemplateState
}

type TemplateUndoPayload = {
  before?: TemplateState | null
  after?: TemplateState | null
}

type TemplateFallback = Pick<
  TemplateState,
  'id' | 'name' | 'description' | 'bodyHtml' | 'contextSlots' | 'seedKey' | 'createdByUserId' | 'isActive'
>

function captureTemplateState(template: DocumentTemplate | null, fallback: TemplateFallback): TemplateState {
  return {
    id: template?.id ?? fallback.id,
    existed: template !== null,
    name: template?.name ?? fallback.name,
    description: template?.description ?? fallback.description,
    bodyHtml: template?.bodyHtml ?? fallback.bodyHtml,
    contextSlots: (template?.contextSlots ?? fallback.contextSlots) as TemplateState['contextSlots'],
    seedKey: template?.seedKey ?? fallback.seedKey,
    createdByUserId: template?.createdByUserId ?? fallback.createdByUserId,
    isActive: template?.isActive ?? fallback.isActive,
    deletedAt: template?.deletedAt?.toISOString() ?? null,
    updatedAt: template?.updatedAt?.toISOString() ?? null,
  }
}

function fallbackFromCreate(input: TemplateCreateCommandInput): TemplateFallback {
  return {
    id: input.templateId,
    name: input.template.name,
    description: input.template.description ?? null,
    bodyHtml: input.template.bodyHtml,
    contextSlots: input.template.contextSlots ?? null,
    seedKey: null,
    createdByUserId: input.actorUserId,
    isActive: input.template.isActive ?? true,
  }
}

function fallbackFromTemplate(template: DocumentTemplate): TemplateFallback {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? null,
    bodyHtml: template.bodyHtml,
    contextSlots: (template.contextSlots ?? null) as TemplateState['contextSlots'],
    seedKey: template.seedKey ?? null,
    createdByUserId: template.createdByUserId,
    isActive: template.isActive,
  }
}

function assertActor(input: { actorUserId: string }, ctx: Parameters<CommandHandler['execute']>[1]): void {
  if (resolveDocumentsCommandActor(ctx) !== input.actorUserId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

async function authorizeTemplateMutation(
  ctx: Parameters<CommandHandler['execute']>[1],
  input: { tenantId: string; organizationId: string },
): Promise<void> {
  const scope = resolveDocumentsCommandScope(ctx, input)
  const features = await resolveDocumentsCommandFeatures(ctx, scope)
  assertCommandFeature(features, 'documents.templates.manage')
}

async function loadTemplate(
  em: EntityManager,
  input: { tenantId: string; organizationId: string },
  templateId: string,
  lock = false,
): Promise<DocumentTemplate | null> {
  return findOneWithDecryption(
    em,
    DocumentTemplate,
    {
      id: templateId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    },
    {
      filters: false,
      ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
    },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

function assertTemplateMatchesState(
  template: DocumentTemplate | null,
  expected: TemplateState,
  softDeletedCreated = false,
): void {
  if (!template || !expected.existed) throw new CrudHttpError(409, { error: 'Record changed by another user' })
  const scalarsMatch = template.id === expected.id
    && template.name === expected.name
    && (template.description ?? null) === expected.description
    && template.bodyHtml === expected.bodyHtml
    && JSON.stringify(template.contextSlots ?? null) === JSON.stringify(expected.contextSlots)
    && (template.seedKey ?? null) === expected.seedKey
    && template.createdByUserId === expected.createdByUserId
    && template.isActive === expected.isActive
  const deletedAt = template.deletedAt?.toISOString() ?? null
  const deletionMatches = softDeletedCreated ? deletedAt !== null : deletedAt === expected.deletedAt
  if (!scalarsMatch || !deletionMatches) {
    throw new CrudHttpError(409, buildOptimisticLockConflictBody(
      template.updatedAt.toISOString(),
      expected.updatedAt ?? template.updatedAt.toISOString(),
    ))
  }
}

function assertTemplateUnchanged(
  template: DocumentTemplate | null,
  expected: TemplateState,
): asserts template is DocumentTemplate {
  if (!template || !expected.existed || !expected.updatedAt) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
  assertOptimisticLock({
    resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
    resourceId: expected.id,
    current: template.updatedAt,
    expected: expected.updatedAt,
    envValue: 'all',
  })
  assertTemplateMatchesState(template, expected)
}

function assertRedoExpectation(template: DocumentTemplate | null, expectation: TemplateRedoExpectation): void {
  assertTemplateMatchesState(template, expectation.state, expectation.kind === 'soft-deleted-created')
}

function restoreTemplateState(template: DocumentTemplate, before: TemplateState): void {
  const now = nextDocumentVersion(template.updatedAt)
  if (!before.existed) {
    template.deletedAt = now
    template.updatedAt = now
    return
  }
  template.name = before.name
  template.description = before.description
  template.bodyHtml = before.bodyHtml
  template.contextSlots = before.contextSlots
  template.seedKey = before.seedKey
  template.createdByUserId = before.createdByUserId
  template.isActive = before.isActive
  template.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
  template.updatedAt = now
}

function redoExpectationAfterUndo(before: TemplateState, after: TemplateState): TemplateRedoExpectation {
  return before.existed
    ? { kind: 'snapshot', state: before }
    : { kind: 'soft-deleted-created', state: after }
}

function readRedoInput<T>(logEntry: { commandPayload?: unknown }, schema: z.ZodType<T>): T {
  const raw = logEntry.commandPayload && typeof logEntry.commandPayload === 'object'
    ? (logEntry.commandPayload as { __redoInput?: unknown }).__redoInput
    : null
  return schema.parse(raw)
}

export const createTemplateCommand: CommandHandler<TemplateCreateCommandInput, TemplateCommandResult> = {
  id: 'documents.template.create',
  async prepare(rawInput, ctx) {
    const input = templateCreateCommandSchema.parse(rawInput)
    assertActor(input, ctx)
    await authorizeTemplateMutation(ctx, input)
    return null
  },
  async execute(rawInput, ctx) {
    const input = templateCreateCommandSchema.parse(rawInput)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    const fallback = fallbackFromCreate(input)
    let template: DocumentTemplate | null = null
    let before: TemplateState | null = null
    let after: TemplateState | null = null
    let created = false
    await withAtomicFlush(em, [async () => {
      assertActor(input, ctx)
      template = await loadTemplate(em, input, input.templateId, true)
      await authorizeTemplateMutation(ctx, input)
      if (input.redoExpectation) assertRedoExpectation(template, input.redoExpectation)
      else if (template) throw new CrudHttpError(409, { error: 'Record changed by another user' })
      before = captureTemplateState(template, fallback)
      if (!template) {
        const { id, ...templateData } = fallback
        template = em.create(DocumentTemplate, {
          id,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          ...templateData,
        })
        created = true
      }
      ;(template as DocumentTemplate).name = fallback.name
      ;(template as DocumentTemplate).description = fallback.description
      ;(template as DocumentTemplate).bodyHtml = fallback.bodyHtml
      ;(template as DocumentTemplate).contextSlots = fallback.contextSlots
      ;(template as DocumentTemplate).seedKey = fallback.seedKey
      ;(template as DocumentTemplate).createdByUserId = fallback.createdByUserId
      ;(template as DocumentTemplate).isActive = fallback.isActive
      ;(template as DocumentTemplate).deletedAt = null
      ;(template as DocumentTemplate).updatedAt = nextDocumentVersion(
        (template as DocumentTemplate).updatedAt,
      )
      if (created) em.persist(template as DocumentTemplate)
    }, async () => {
      after = captureTemplateState(template, fallback)
    }], { transaction: true, label: 'documents.template.create' })
    const finalTemplate = template as DocumentTemplate | null
    const beforeState = before as TemplateState | null
    const afterState = after as TemplateState | null
    if (!finalTemplate || !beforeState || !afterState) throw new Error('[internal] template create produced no row')
    return {
      id: finalTemplate.id,
      updatedAt: finalTemplate.updatedAt.toISOString(),
      before: beforeState,
      after: afterState,
    }
  },
  async buildLog({ input, result }) {
    const before = templateStateSchema.parse(result.before)
    const after = templateStateSchema.parse(result.after)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.templateCreated', 'Create template'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: result.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies TemplateUndoPayload,
        __redoInput: {
          ...input,
          expectedUpdatedAt: null,
          redoExpectation: redoExpectationAfterUndo(before, after),
        } satisfies TemplateCreateCommandInput,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<TemplateUndoPayload>(logEntry)
    if (!undo?.before || !undo.after) return
    const input = readRedoInput(logEntry, templateCreateCommandSchema)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    await withAtomicFlush(em, [async () => {
      const template = await loadTemplate(em, input, undo.after!.id, true)
      await authorizeTemplateMutation(ctx, input)
      assertTemplateUnchanged(template, undo.after!)
      restoreTemplateState(template, undo.before!)
    }], { transaction: true, label: 'documents.template.create.undo' })
  },
}

export const updateTemplateCommand: CommandHandler<TemplateUpdateCommandInput, TemplateCommandResult> = {
  id: 'documents.template.update',
  async prepare(rawInput, ctx) {
    const input = templateUpdateCommandSchema.parse(rawInput)
    assertActor(input, ctx)
    await authorizeTemplateMutation(ctx, input)
    const em = ctx.container.resolve('em') as EntityManager
    const template = await loadTemplate(em, input, input.template.id)
    if (!template || template.deletedAt) throw new CrudHttpError(404, { error: 'documents.templates.notFound' })
    return null
  },
  async execute(rawInput, ctx) {
    const input = templateUpdateCommandSchema.parse(rawInput)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    let template: DocumentTemplate | null = null
    let before: TemplateState | null = null
    let after: TemplateState | null = null
    await withAtomicFlush(em, [async () => {
      assertActor(input, ctx)
      template = await loadTemplate(em, input, input.template.id, true)
      await authorizeTemplateMutation(ctx, input)
      if (!template || template.deletedAt) throw new CrudHttpError(404, { error: 'documents.templates.notFound' })
      if (input.redoExpectation) assertRedoExpectation(template, input.redoExpectation)
      else assertOptimisticLock({
        resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
        resourceId: template.id,
        current: template.updatedAt,
        expected: input.expectedUpdatedAt,
      })
      before = captureTemplateState(template, fallbackFromTemplate(template))
      if (input.template.name !== undefined) (template as DocumentTemplate).name = input.template.name
      if (Object.prototype.hasOwnProperty.call(input.template, 'description')) {
        ;(template as DocumentTemplate).description = input.template.description ?? null
      }
      if (input.template.bodyHtml !== undefined) (template as DocumentTemplate).bodyHtml = input.template.bodyHtml
      if (Object.prototype.hasOwnProperty.call(input.template, 'contextSlots')) {
        ;(template as DocumentTemplate).contextSlots = input.template.contextSlots ?? null
      }
      if (input.template.isActive !== undefined) (template as DocumentTemplate).isActive = input.template.isActive
      ;(template as DocumentTemplate).updatedAt = nextDocumentVersion(
        (template as DocumentTemplate).updatedAt,
      )
    }, async () => {
      after = captureTemplateState(template, fallbackFromTemplate(template as DocumentTemplate))
    }], { transaction: true, label: 'documents.template.update' })
    const finalTemplate = template as DocumentTemplate | null
    const beforeState = before as TemplateState | null
    const afterState = after as TemplateState | null
    if (!finalTemplate || !beforeState || !afterState) throw new Error('[internal] template update produced no row')
    return {
      id: finalTemplate.id,
      updatedAt: finalTemplate.updatedAt.toISOString(),
      before: beforeState,
      after: afterState,
    }
  },
  async buildLog({ input, result }) {
    const before = templateStateSchema.parse(result.before)
    const after = templateStateSchema.parse(result.after)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.templateUpdated', 'Update template'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: result.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies TemplateUndoPayload,
        __redoInput: {
          ...input,
          expectedUpdatedAt: null,
          redoExpectation: { kind: 'snapshot', state: before },
        } satisfies TemplateUpdateCommandInput,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<TemplateUndoPayload>(logEntry)
    if (!undo?.before || !undo.after) return
    const input = readRedoInput(logEntry, templateUpdateCommandSchema)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    await withAtomicFlush(em, [async () => {
      const template = await loadTemplate(em, input, undo.after!.id, true)
      await authorizeTemplateMutation(ctx, input)
      assertTemplateUnchanged(template, undo.after!)
      restoreTemplateState(template, undo.before!)
    }], { transaction: true, label: 'documents.template.update.undo' })
  },
}

export const deleteTemplateCommand: CommandHandler<TemplateDeleteCommandInput, TemplateCommandResult> = {
  id: 'documents.template.delete',
  async prepare(rawInput, ctx) {
    const input = templateDeleteCommandSchema.parse(rawInput)
    assertActor(input, ctx)
    await authorizeTemplateMutation(ctx, input)
    const em = ctx.container.resolve('em') as EntityManager
    const template = await loadTemplate(em, input, input.templateId)
    if (!template || template.deletedAt) throw new CrudHttpError(404, { error: 'documents.templates.notFound' })
    return null
  },
  async execute(rawInput, ctx) {
    const input = templateDeleteCommandSchema.parse(rawInput)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    let template: DocumentTemplate | null = null
    let before: TemplateState | null = null
    let after: TemplateState | null = null
    await withAtomicFlush(em, [async () => {
      assertActor(input, ctx)
      template = await loadTemplate(em, input, input.templateId, true)
      await authorizeTemplateMutation(ctx, input)
      if (!template || template.deletedAt) throw new CrudHttpError(404, { error: 'documents.templates.notFound' })
      if (input.redoExpectation) assertRedoExpectation(template, input.redoExpectation)
      else assertOptimisticLock({
        resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
        resourceId: template.id,
        current: template.updatedAt,
        expected: input.expectedUpdatedAt,
      })
      before = captureTemplateState(template, fallbackFromTemplate(template))
      const now = nextDocumentVersion((template as DocumentTemplate).updatedAt)
      ;(template as DocumentTemplate).deletedAt = now
      ;(template as DocumentTemplate).updatedAt = now
    }, async () => {
      after = captureTemplateState(template, fallbackFromTemplate(template as DocumentTemplate))
    }], { transaction: true, label: 'documents.template.delete' })
    const finalTemplate = template as DocumentTemplate | null
    const beforeState = before as TemplateState | null
    const afterState = after as TemplateState | null
    if (!finalTemplate || !beforeState || !afterState) throw new Error('[internal] template delete produced no row')
    return {
      id: finalTemplate.id,
      updatedAt: finalTemplate.updatedAt.toISOString(),
      before: beforeState,
      after: afterState,
    }
  },
  async buildLog({ input, result }) {
    const before = templateStateSchema.parse(result.before)
    const after = templateStateSchema.parse(result.after)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.templateDeleted', 'Delete template'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
      resourceId: result.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after } satisfies TemplateUndoPayload,
        __redoInput: {
          ...input,
          expectedUpdatedAt: null,
          redoExpectation: { kind: 'snapshot', state: before },
        } satisfies TemplateDeleteCommandInput,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<TemplateUndoPayload>(logEntry)
    if (!undo?.before || !undo.after) return
    const input = readRedoInput(logEntry, templateDeleteCommandSchema)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    await withAtomicFlush(em, [async () => {
      const template = await loadTemplate(em, input, undo.after!.id, true)
      await authorizeTemplateMutation(ctx, input)
      assertTemplateUnchanged(template, undo.after!)
      restoreTemplateState(template, undo.before!)
    }], { transaction: true, label: 'documents.template.delete.undo' })
  },
}

registerCommand(createTemplateCommand)
registerCommand(updateTemplateCommand)
registerCommand(deleteTemplateCommand)
