import type { EntityManager } from '@mikro-orm/postgresql'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  registerCommand,
  type CommandHandler,
} from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  enforceCommandOptimisticLockWithGuards,
  enforceRecordGoneIsConflict,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DocumentContent } from '../data/entities'
import { documentContentPutSchema } from '../data/validators'
import { materializeDocumentContentReplacement } from '../lib/collabMaterializer'
import {
  advanceDocumentCollaborationGeneration,
  mutateDocumentContentState,
} from '../lib/contentService'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import {
  assertDocumentContentResourceLimits,
} from '../lib/resourceLimits'
import {
  loadLockedDocumentContent,
  lockDocumentAggregateRoot,
} from './aggregate'
import {
  assertDocumentCommandCanEdit,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandScope,
} from './shared'
import {
  documentsScopedCommandSchema,
} from './mutation-helpers'
import type { DocumentsProjectionDescriptor } from './projection-types'

export const replaceDocumentContentCommandSchema = documentsScopedCommandSchema
  .merge(documentContentPutSchema)
  .extend({
    documentId: z.string().uuid(),
    contentId: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime().optional().nullable(),
    writeUpdatedAt: z.string().datetime().optional(),
  })

export type ReplaceDocumentContentCommandInput = z.infer<
  typeof replaceDocumentContentCommandSchema
>

type ContentAuditSnapshot = {
  id: string
  documentId: string
  tenantId: string
  organizationId: string
  contentDigest: string
  collaborationGeneration: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type ReplaceDocumentContentCommandResult = {
  id: string
  updatedAt: string
  before: ContentAuditSnapshot | null
  after: ContentAuditSnapshot
  projections: DocumentsProjectionDescriptor[]
}

function captureContentAuditState(content: DocumentContent): ContentAuditSnapshot {
  assertDocumentContentResourceLimits({
    yjsState: content.yjsState,
    contentHtml: content.contentHtml,
    contentText: content.contentText,
  })
  const yjsState = Buffer.from(content.yjsState ?? Buffer.alloc(0))
  const contentHtml = content.contentHtml ?? ''
  const contentText = content.contentText ?? ''
  const digest = createHash('sha256')
  for (const part of [yjsState, Buffer.from(contentHtml), Buffer.from(contentText)]) {
    digest.update(String(part.byteLength))
    digest.update(':')
    digest.update(part)
  }
  return {
    id: content.id,
    documentId: content.documentId,
    tenantId: content.tenantId,
    organizationId: content.organizationId,
    contentDigest: `sha256:${digest.digest('hex')}`,
    collaborationGeneration: content.collaborationGeneration,
    createdAt: content.createdAt.toISOString(),
    updatedAt: content.updatedAt.toISOString(),
    deletedAt: content.deletedAt?.toISOString() ?? null,
  }
}

function changedError(): CrudHttpError {
  return new CrudHttpError(409, { error: 'documents.errors.recordChanged' })
}

function allocateContentWriteVersion(
  current: DocumentContent | null,
  requestedWriteUpdatedAt?: string,
): string {
  const currentMs = current?.updatedAt.getTime() ?? 0
  const requestedMs = requestedWriteUpdatedAt ? Date.parse(requestedWriteUpdatedAt) : null
  if (requestedMs !== null && requestedMs <= currentMs) throw changedError()
  const writeMs = requestedMs ?? Math.max(Date.now(), currentMs + 1)
  return new Date(writeMs).toISOString()
}

async function pinContentUpdatedAt(
  em: EntityManager,
  content: DocumentContent,
  input: Pick<
    ReplaceDocumentContentCommandInput,
    'documentId' | 'tenantId' | 'organizationId'
  >,
  updatedAtIso: string,
): Promise<void> {
  const updatedAt = new Date(updatedAtIso)
  const affected = await em.nativeUpdate(
    DocumentContent,
    {
      id: content.id,
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    },
    { updatedAt },
  )
  if (affected !== 1) throw changedError()
  await em.refresh(content)
  if (content.updatedAt.toISOString() !== updatedAtIso) {
    throw new Error('[internal] document content optimistic-lock token was not persisted')
  }
}

function contentProjections(
  input: Pick<
    ReplaceDocumentContentCommandInput,
    'documentId' | 'tenantId' | 'organizationId'
  >,
  userId?: string,
): DocumentsProjectionDescriptor[] {
  return [
    {
      kind: 'document-index',
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    },
    {
      kind: 'event',
      eventId: 'documents.document.updated',
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      payload: {
        id: input.documentId,
        documentId: input.documentId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        ...(userId ? { userId } : {}),
        contentEpochReset: true,
      },
    },
  ]
}

const replaceDocumentContentCommand: CommandHandler<
  ReplaceDocumentContentCommandInput,
  ReplaceDocumentContentCommandResult
> = {
  id: 'documents.content.replace',
  // Body replacements can approach the document resource limits and happen
  // frequently. Audit undo/redo would copy those bodies outside the bounded
  // version store. The editor and version history remain the reversal models.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = replaceDocumentContentCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const actorUserId = resolveDocumentsCommandActor(ctx)
    const requestEm = ctx.container.resolve('em') as EntityManager
    const em = ctx.transactionalEm ?? requestEm.fork()
    let content: DocumentContent | null = null
    let before: ContentAuditSnapshot | null = null
    let writeUpdatedAt!: string

    await withAtomicFlush(em, [
      async () => {
        await lockDocumentAggregateRoot(em, input.documentId, scope)
        await assertDocumentCommandCanEdit(ctx, em, input.documentId, scope)
        const current = await loadLockedDocumentContent(
          em,
          input.documentId,
          scope,
          { includeDeleted: true },
        )
        if (!current) {
          enforceRecordGoneIsConflict({
            resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
            resourceId: input.contentId,
            expected: input.expectedUpdatedAt ?? undefined,
            request: ctx.request ?? null,
            ...(input.expectedUpdatedAt ? { envValue: 'all' } : {}),
          })
        } else {
          await enforceCommandOptimisticLockWithGuards(ctx.container, {
            resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
            resourceId: current.id,
            current: current.updatedAt,
            expected: input.expectedUpdatedAt ?? undefined,
            request: ctx.request ?? null,
            ...(input.expectedUpdatedAt ? { envValue: 'all' } : {}),
          })
        }
        before = current ? captureContentAuditState(current) : null
        const replacement = materializeDocumentContentReplacement(
          current?.yjsState,
          input.contentHtml,
        )
        if (!replacement) {
          throw new Error('[internal] documents content replacement could not be materialized')
        }
        writeUpdatedAt = allocateContentWriteVersion(current, input.writeUpdatedAt)
        if (current) advanceDocumentCollaborationGeneration(current)
        content = await mutateDocumentContentState(
          em,
          input.documentId,
          scope,
          {
            yjsState: replacement.yjsState,
            contentHtml: replacement.html,
            contentText: replacement.text,
          },
          {
            id: current?.id ?? input.contentId,
            existingContent: current,
            now: new Date(writeUpdatedAt),
          },
        )
      },
      async () => {
        if (!content) throw new Error('[internal] document content replacement produced no row')
        await pinContentUpdatedAt(em, content, input, writeUpdatedAt)
      },
    ], { transaction: true, label: 'documents.content.replace' })

    const finalContent = content as DocumentContent | null
    if (!finalContent) throw new Error('[internal] document content replacement produced no row')
    const after = captureContentAuditState(finalContent)
    return {
      id: finalContent.id,
      updatedAt: after.updatedAt,
      before,
      after,
      projections: contentProjections(input, actorUserId),
    }
  },
  async buildLog({ input, result }) {
    const parsed = replaceDocumentContentCommandSchema.parse(input)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.documentUpdated', 'Document updated'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.document,
      parentResourceId: parsed.documentId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      snapshotBefore: result.before,
      snapshotAfter: result.after,
      payload: {
        documentId: parsed.documentId,
        contentId: result.id,
        beforeContentDigest: result.before?.contentDigest ?? null,
        afterContentDigest: result.after.contentDigest,
        contentUpdatedAt: result.updatedAt,
        // The command bus normally adds the original input for redo. A null
        // sentinel prevents the body-bearing content input from being copied
        // into the action log for this deliberately non-undoable command.
        __redoInput: null,
      },
    }
  },
}

registerCommand(replaceDocumentContentCommand)

export { replaceDocumentContentCommand }
