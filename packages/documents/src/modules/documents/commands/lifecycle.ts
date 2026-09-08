import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import {
  registerCommand,
  type CommandHandler,
  type CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  assertOptimisticLock,
  enforceCommandOptimisticLockWithGuards,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Document } from '../data/entities'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { resolveWatcherRecipients } from '../lib/watchers'
import { lockDocumentAggregateRoot } from './aggregate'
import { nextDocumentVersion } from './mutation-helpers'
import type { DocumentsProjectionDescriptor } from './projection-types'
import {
  resolveDocumentsCommandActor,
  resolveDocumentsCommandEntityManager,
  resolveDocumentsCommandFeatures,
  resolveDocumentsCommandScope,
} from './shared'

const lifecycleStateSchema = z.object({
  archivedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
})

const lifecycleRedoExpectationSchema = z.object({
  archivedAt: z.string().datetime().nullable(),
})

export const documentLifecycleCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  documentId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime().nullable().optional(),
  redoExpectation: lifecycleRedoExpectationSchema.optional(),
})

export type DocumentLifecycleCommandInput = z.infer<typeof documentLifecycleCommandSchema>
type DocumentLifecycleState = z.infer<typeof lifecycleStateSchema>

export type DocumentLifecycleCommandResult = {
  id: string
  archivedAt: string | null
  updatedAt: string
  changed: boolean
  before: DocumentLifecycleState
  after: DocumentLifecycleState
  projections?: DocumentsProjectionDescriptor[]
  projectionsAfterUndo?: DocumentsProjectionDescriptor[]
}

type DocumentLifecycleUndoPayload = {
  before?: DocumentLifecycleState | null
  after?: DocumentLifecycleState | null
  projectionsAfterUndo?: DocumentsProjectionDescriptor[]
}

type LifecycleTransition = 'archive' | 'unarchive'

function captureLifecycleState(document: Document): DocumentLifecycleState {
  return {
    archivedAt: document.archivedAt?.toISOString() ?? null,
    updatedAt: document.updatedAt.toISOString(),
  }
}

function assertActor(input: DocumentLifecycleCommandInput, ctx: CommandRuntimeContext): void {
  if (resolveDocumentsCommandActor(ctx) !== input.actorUserId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

async function assertCanArchive(
  ctx: CommandRuntimeContext,
  document: Document,
  input: DocumentLifecycleCommandInput,
): Promise<void> {
  const scope = resolveDocumentsCommandScope(ctx, input)
  const features = await resolveDocumentsCommandFeatures(ctx, scope)
  const ownsDocument = document.ownerUserId === resolveDocumentsCommandActor(ctx)
  const managerOverride = hasAllFeatures(['documents.manage'], features)
  if (
    !(ownsDocument || managerOverride)
    || !hasAllFeatures(['documents.edit'], features)
  ) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

function assertLifecycleStateMatches(
  document: Document,
  expected: Pick<DocumentLifecycleState, 'archivedAt'>,
): void {
  if ((document.archivedAt?.toISOString() ?? null) !== expected.archivedAt) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
}

function lifecycleEventProjection(
  transition: LifecycleTransition,
  input: DocumentLifecycleCommandInput,
  includeActor = true,
): DocumentsProjectionDescriptor {
  return {
    kind: 'event',
    eventId: transition === 'archive'
      ? 'documents.document.archived'
      : 'documents.document.unarchived',
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    payload: {
      id: input.documentId,
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      ...(includeActor ? { userId: input.actorUserId } : {}),
    },
  }
}

function watcherProjections(
  transition: LifecycleTransition,
  input: DocumentLifecycleCommandInput,
  documentTitle: string,
  recipientUserIds: readonly string[],
): DocumentsProjectionDescriptor[] {
  const bodyKey = transition === 'archive'
    ? 'documents.notifications.watch.changed.archivedBody'
    : 'documents.notifications.watch.changed.unarchivedBody'
  return recipientUserIds.map((recipientUserId) => ({
    kind: 'watch-notification',
    recipientUserId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    documentId: input.documentId,
    documentTitle,
    notificationType: 'documents.watch.changed',
    bodyKey,
    sourceEntityType: DOCUMENTS_ENTITY_IDS.document,
    sourceEntityId: input.documentId,
    linkHref: `/backend/documents/${encodeURIComponent(input.documentId)}`,
  }))
}

async function executeLifecycleTransition(
  rawInput: DocumentLifecycleCommandInput,
  ctx: CommandRuntimeContext,
  transition: LifecycleTransition,
): Promise<DocumentLifecycleCommandResult> {
  const input = documentLifecycleCommandSchema.parse(rawInput)
  const scope = resolveDocumentsCommandScope(ctx, input)
  const em = resolveDocumentsCommandEntityManager(ctx)
  const shouldArchive = transition === 'archive'
  let document: Document | null = null
  let before: DocumentLifecycleState | null = null
  let after: DocumentLifecycleState | null = null
  let changed = false

  await withAtomicFlush(em, [async () => {
    document = await lockDocumentAggregateRoot(em, input.documentId, scope)
    assertActor(input, ctx)
    await assertCanArchive(ctx, document, input)
    if (input.redoExpectation) {
      assertLifecycleStateMatches(document, input.redoExpectation)
    } else {
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: DOCUMENTS_ENTITY_IDS.document,
        resourceId: document.id,
        current: document.updatedAt,
        expected: input.expectedUpdatedAt,
        request: ctx.request ?? null,
      })
    }

    before = captureLifecycleState(document)
    if ((document.archivedAt !== null && document.archivedAt !== undefined) === shouldArchive) {
      after = before
      return
    }

    const version = nextDocumentVersion(document.updatedAt)
    document.archivedAt = shouldArchive ? version : null
    document.updatedAt = version
    changed = true
  }, () => {
    if (!document) throw new Error('[internal] document lifecycle transition produced no row')
    after = captureLifecycleState(document)
  }], { transaction: true, label: `documents.document.${transition}` })

  const finalDocument = document as Document | null
  const beforeState = before as DocumentLifecycleState | null
  const afterState = after as DocumentLifecycleState | null
  if (!finalDocument || !beforeState || !afterState) {
    throw new Error('[internal] document lifecycle transition produced no snapshot')
  }

  const recipientUserIds = changed
    ? await resolveWatcherRecipients({
        em,
        container: ctx.container,
        scope,
        documentId: input.documentId,
        actorUserId: input.actorUserId,
      })
    : []
  const projections = changed
    ? [
        lifecycleEventProjection(transition, input),
        ...watcherProjections(transition, input, finalDocument.title, recipientUserIds),
      ]
    : []
  const undoTransition: LifecycleTransition = transition === 'archive' ? 'unarchive' : 'archive'
  const projectionsAfterUndo: DocumentsProjectionDescriptor[] = changed
    ? [
        lifecycleEventProjection(undoTransition, input, false),
        // Undo may run long after the archive flip; resolve watchers and the
        // title at delivery time instead of replaying the execute-time set.
        {
          kind: 'watch-notification-fanout',
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          documentId: input.documentId,
          actorUserId: input.actorUserId,
          notificationType: 'documents.watch.changed',
          bodyKey: undoTransition === 'archive'
            ? 'documents.notifications.watch.changed.archivedBody'
            : 'documents.notifications.watch.changed.unarchivedBody',
          sourceEntityType: DOCUMENTS_ENTITY_IDS.document,
          sourceEntityId: input.documentId,
          linkHref: `/backend/documents/${encodeURIComponent(input.documentId)}`,
        },
      ]
    : []
  return {
    id: finalDocument.id,
    archivedAt: afterState.archivedAt,
    updatedAt: afterState.updatedAt,
    changed,
    before: beforeState,
    after: afterState,
    projections,
    projectionsAfterUndo,
  }
}

function readRedoInput(logEntry: { commandPayload?: unknown }): DocumentLifecycleCommandInput {
  const raw = logEntry.commandPayload && typeof logEntry.commandPayload === 'object'
    ? (logEntry.commandPayload as { __redoInput?: unknown }).__redoInput
    : null
  return documentLifecycleCommandSchema.parse(raw)
}

function buildLifecycleCommand(transition: LifecycleTransition): CommandHandler<
  DocumentLifecycleCommandInput,
  DocumentLifecycleCommandResult
> {
  const inverseTransition: LifecycleTransition = transition === 'archive' ? 'unarchive' : 'archive'
  return {
    id: `documents.document.${transition}`,
    async execute(rawInput, ctx) {
      return executeLifecycleTransition(rawInput, ctx, transition)
    },
    async buildLog({ input, result }) {
      if (!result.changed) return { skipLog: true }
      const before = lifecycleStateSchema.parse(result.before)
      const after = lifecycleStateSchema.parse(result.after)
      const { translate } = await resolveTranslations()
      return {
        actionLabel: transition === 'archive'
          ? translate('documents.audit.documentArchived', 'Archive document')
          : translate('documents.audit.documentUnarchived', 'Unarchive document'),
        resourceKind: DOCUMENTS_ENTITY_IDS.document,
        resourceId: result.id,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        snapshotBefore: before,
        snapshotAfter: after,
        payload: {
          undo: {
            before,
            after,
            projectionsAfterUndo: result.projectionsAfterUndo ?? [],
          } satisfies DocumentLifecycleUndoPayload,
          __redoInput: {
            ...input,
            expectedUpdatedAt: null,
            redoExpectation: { archivedAt: before.archivedAt },
          } satisfies DocumentLifecycleCommandInput,
        },
      }
    },
    async undo({ logEntry, ctx }) {
      const undo = extractUndoPayload<DocumentLifecycleUndoPayload>(logEntry)
      if (!undo?.before || !undo.after) return
      const input = readRedoInput(logEntry)
      const scope = resolveDocumentsCommandScope(ctx, input)
      const em: EntityManager = resolveDocumentsCommandEntityManager(ctx)
      await withAtomicFlush(em, [async () => {
        const document = await lockDocumentAggregateRoot(em, input.documentId, scope)
        assertActor(input, ctx)
        await assertCanArchive(ctx, document, input)
        assertOptimisticLock({
          resourceKind: DOCUMENTS_ENTITY_IDS.document,
          resourceId: document.id,
          current: document.updatedAt,
          expected: undo.after!.updatedAt,
          envValue: 'all',
        })
        assertLifecycleStateMatches(document, undo.after!)
        document.archivedAt = undo.before!.archivedAt
          ? new Date(undo.before!.archivedAt)
          : null
        document.updatedAt = nextDocumentVersion(document.updatedAt)
      }], { transaction: true, label: `documents.document.${transition}.undo` })
    },
  }
}

export const archiveDocumentCommand = buildLifecycleCommand('archive')
export const unarchiveDocumentCommand = buildLifecycleCommand('unarchive')

registerCommand(archiveDocumentCommand)
registerCommand(unarchiveDocumentCommand)
