import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Document, DocumentContent, DocumentVersion } from '../data/entities'
import { resolveWatcherRecipients } from '../lib/watchers'
import { documentVersionLabelSchema } from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import {
  advanceDocumentCollaborationGeneration,
  mutateDocumentContentState,
} from '../lib/contentService'
import { materializeDocumentVersion } from '../lib/versionContent'
import { sanitizeDocumentVersionLabel } from '../lib/versionLabels'
import {
  assertDocumentContentResourceLimits,
  decodeBoundedCanonicalBase64,
  DOCUMENTS_MAX_YJS_STATE_BYTES,
} from '../lib/resourceLimits'
import { enforceDocumentVersionRetention } from '../lib/historyLimits'
import { loadLockedDocumentContent, lockDocumentAggregateRoot } from './aggregate'
import type { DocumentsProjectionDescriptor } from './projection-types'
import {
  bufferDocumentIndexRefresh,
  bufferVersionCreatedSideEffect,
} from './side-effects'
import {
  assertDocumentCommandCanEdit,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandEntityManager,
  resolveDocumentsCommandScope,
} from './shared'
import { documentsScopedCommandSchema } from './mutation-helpers'

export const createVersionCommandSchema = documentsScopedCommandSchema.extend({
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  label: documentVersionLabelSchema,
})

export type CreateVersionCommandInput = z.infer<typeof createVersionCommandSchema>

const contentStateSchema = z.object({
  id: z.string().uuid(),
  yjsState: z.string(),
  contentHtml: z.string(),
  contentText: z.string(),
  updatedAt: z.string().datetime(),
})

export const restoreVersionCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  preRestoreVersionId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  expectedContentUpdatedAt: z.string().datetime(),
  restoreContentUpdatedAt: z.string().datetime(),
})

export type RestoreVersionCommandInput = z.infer<typeof restoreVersionCommandSchema>

type ContentState = z.infer<typeof contentStateSchema>

type RestoreVersionResult = {
  contentHtml: string
  contentText: string
  updatedAt: string
  restoredVersionId: string
  preRestoreVersionId: string
  preRestoreSnapshot: VersionCreateSnapshot
  restoredSnapshot: VersionCreateSnapshot
  projections: DocumentsProjectionDescriptor[]
}

type VersionCreateSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  documentId: string
  label: string | null
  contentDigest: string
  createdByUserId: string
  createdAt: string
}

type CreateVersionResult = {
  id: string
  label: string | null
  createdByUserId: string
  createdAt: string
  after: VersionCreateSnapshot
}

function captureContentState(content: DocumentContent): ContentState {
  assertDocumentContentResourceLimits({
    yjsState: content.yjsState,
    contentHtml: content.contentHtml,
    contentText: content.contentText,
  })
  return {
    id: content.id,
    yjsState: Buffer.from(content.yjsState ?? Buffer.alloc(0)).toString('base64'),
    contentHtml: content.contentHtml ?? '',
    contentText: content.contentText ?? '',
    updatedAt: content.updatedAt.toISOString(),
  }
}

function captureVersion(version: DocumentVersion): VersionCreateSnapshot {
  const contentHtml = version.contentHtml ?? ''
  assertDocumentContentResourceLimits({ yjsState: version.yjsSnapshot, contentHtml })
  const yjsSnapshot = Buffer.from(version.yjsSnapshot ?? Buffer.alloc(0))
  const contentDigest = createHash('sha256')
    .update(String(yjsSnapshot.byteLength))
    .update(':')
    .update(yjsSnapshot)
    .update(String(Buffer.byteLength(contentHtml)))
    .update(':')
    .update(contentHtml)
    .digest('hex')
  return {
    id: version.id,
    tenantId: version.tenantId,
    organizationId: version.organizationId,
    documentId: version.documentId,
    label: sanitizeDocumentVersionLabel(version.label),
    contentDigest: `sha256:${contentDigest}`,
    createdByUserId: version.createdByUserId,
    createdAt: version.createdAt.toISOString(),
  }
}

async function loadVersionForCreate(
  em: EntityManager,
  input: CreateVersionCommandInput,
  lock = false,
): Promise<DocumentVersion | null> {
  return findOneWithDecryption(
    em,
    DocumentVersion,
    {
      id: input.versionId,
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    },
    lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

/**
 * MikroORM's `onUpdate` initializer replaces an explicitly assigned
 * `updatedAt` during flush. Restore needs the pre-computed optimistic-lock token
 * returned to the client to match the value that actually reached the database.
 * Pin it after the content mutation has flushed, then refresh the managed row so
 * the in-memory response and database agree.
 */
export async function pinDocumentContentUpdatedAt(
  em: EntityManager,
  content: DocumentContent,
  scope: Pick<RestoreVersionCommandInput, 'tenantId' | 'organizationId' | 'documentId'>,
  updatedAtIso: string,
): Promise<void> {
  const updatedAt = new Date(updatedAtIso)
  const affected = await em.nativeUpdate(
    DocumentContent,
    {
      id: content.id,
      documentId: scope.documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { updatedAt },
  )
  if (affected !== 1) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
  await em.refresh(content)
  if (content.updatedAt.toISOString() !== updatedAt.toISOString()) {
    throw new Error('[internal] document content optimistic-lock token was not persisted')
  }
}

async function loadLockedContent(
  em: EntityManager,
  input: Pick<RestoreVersionCommandInput, 'documentId' | 'tenantId' | 'organizationId'>,
): Promise<DocumentContent> {
  const content = await findOneWithDecryption(
    em,
    DocumentContent,
    {
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
    },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  if (!content) throw new CrudHttpError(404, { error: 'documents.content.notFound' })
  return content
}

async function loadScopedVersion(
  em: EntityManager,
  input: RestoreVersionCommandInput,
): Promise<DocumentVersion> {
  const version = await loadVersionByStableId(em, input, input.versionId)
  if (!version) throw new CrudHttpError(404, { error: 'documents.versions.notFound' })
  return version
}

async function loadVersionByStableId(
  em: EntityManager,
  input: RestoreVersionCommandInput,
  versionId: string,
): Promise<DocumentVersion | null> {
  return findOneWithDecryption(
    em,
    DocumentVersion,
    {
      id: versionId,
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    },
    undefined,
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

function createVersionSnapshot(
  em: EntityManager,
  input: RestoreVersionCommandInput,
  id: string,
  state: ContentState,
  createdByUserId = input.actorUserId,
): DocumentVersion {
  assertDocumentContentResourceLimits({
    contentHtml: state.contentHtml,
    contentText: state.contentText,
  })
  return em.create(DocumentVersion, {
    id,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    documentId: input.documentId,
    label: null,
    yjsSnapshot: decodeBoundedCanonicalBase64(
      state.yjsState,
      DOCUMENTS_MAX_YJS_STATE_BYTES,
    ),
    contentHtml: state.contentHtml,
    createdByUserId,
  })
}

async function persistRetentionBoundVersion(
  em: EntityManager,
  scope: Pick<CreateVersionCommandInput, 'tenantId' | 'organizationId' | 'documentId'>,
  version: DocumentVersion,
  protectedIds: Iterable<string>,
): Promise<void> {
  await enforceDocumentVersionRetention(
    em,
    scope,
    { yjsSnapshot: version.yjsSnapshot, contentHtml: version.contentHtml },
    protectedIds,
  )
  em.persist(version)
}

function buildVersionRestoredProjection(
  input: RestoreVersionCommandInput,
  versionId: string,
  preRestoreVersionId: string,
  options: { includeActor?: boolean } = {},
): DocumentsProjectionDescriptor {
  return {
    kind: 'event',
    eventId: 'documents.version.restored',
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    payload: {
      id: input.documentId,
      documentId: input.documentId,
      versionId,
      preRestoreVersionId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      ...(options.includeActor ? { userId: input.actorUserId } : {}),
    },
  }
}

const createVersionCommand: CommandHandler<CreateVersionCommandInput, CreateVersionResult> = {
  id: 'documents.version.create',
  // Version rows are append-only history. Making snapshot creation undoable
  // would either copy the document body into the action log or make retention
  // eviction lossy. The history timeline itself is the durable reversal model.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = createVersionCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const actorUserId = resolveDocumentsCommandActor(ctx)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let version!: DocumentVersion
    await withAtomicFlush(em, [async () => {
      await lockDocumentAggregateRoot(em, input.documentId, scope)
      await assertDocumentCommandCanEdit(ctx, em, input.documentId, scope)
      const existing = await loadVersionForCreate(em, input, true)
      if (existing) throw new CrudHttpError(409, { error: 'Record changed by another user' })
      const content = await loadLockedDocumentContent(em, input.documentId, scope)
      assertDocumentContentResourceLimits({
        yjsState: content?.yjsState,
        contentHtml: content?.contentHtml,
        contentText: content?.contentText,
      })
      const yjsSnapshot = content?.yjsState ? Buffer.from(content.yjsState) : Buffer.alloc(0)
      const contentHtml = content?.contentHtml ?? ''
      version = em.create(DocumentVersion, {
        id: input.versionId,
        ...scope,
        documentId: input.documentId,
        label: input.label ?? null,
        yjsSnapshot,
        contentHtml,
        createdByUserId: actorUserId,
      })
      await persistRetentionBoundVersion(em, input, version, [input.versionId])
    }], { transaction: true, label: 'documents.version.create' })

    const after = captureVersion(version)
    await bufferVersionCreatedSideEffect(ctx, version)
    return {
      id: version.id,
      label: sanitizeDocumentVersionLabel(version.label),
      createdByUserId: version.createdByUserId,
      createdAt: version.createdAt.toISOString(),
      after,
    }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.versions.actions.snapshot', 'Save version'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentVersion,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.document,
      parentResourceId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: null,
      snapshotAfter: result.after,
      payload: {
        versionId: result.id,
        documentId: input.documentId,
        contentDigest: result.after.contentDigest,
        createdAt: result.createdAt,
      },
    }
  },
}

const restoreVersionCommand: CommandHandler<RestoreVersionCommandInput, RestoreVersionResult> = {
  id: 'documents.version.restore',
  // Restores are reversed by restoring the automatically-created pre-restore
  // version. Audit undo/redo would need durable body copies outside the bounded
  // version store, so this command deliberately does not advertise an undo token.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = restoreVersionCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const em = resolveDocumentsCommandEntityManager(ctx)
    if (resolveDocumentsCommandActor(ctx) !== input.actorUserId) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }

    let currentContent: DocumentContent | null = null
    let before: ContentState | null = null
    let targetVersion: DocumentVersion | null = null
    let preRestoreVersion: DocumentVersion | null = null
    await withAtomicFlush(em, [
      async () => {
        await lockDocumentAggregateRoot(em, input.documentId, scope)
        await assertDocumentCommandCanEdit(ctx, em, input.documentId, scope)
        currentContent = await loadLockedContent(em, input)
        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
          resourceId: currentContent.id,
          current: currentContent.updatedAt,
          expected: input.expectedContentUpdatedAt,
          request: ctx.request ?? null,
        })
        if (Date.parse(input.restoreContentUpdatedAt) <= currentContent.updatedAt.getTime()) {
          throw new CrudHttpError(409, { error: 'Record changed by another user' })
        }
        targetVersion = await loadScopedVersion(em, input)
        const target = materializeDocumentVersion({
          yjsSnapshot: targetVersion.yjsSnapshot,
          contentHtml: targetVersion.contentHtml,
        })
        before = captureContentState(currentContent)

        const existingPreRestore = await loadVersionByStableId(em, input, input.preRestoreVersionId)
        if (existingPreRestore) throw new CrudHttpError(409, { error: 'Record changed by another user' })
        preRestoreVersion = createVersionSnapshot(em, input, input.preRestoreVersionId, before)
        await persistRetentionBoundVersion(em, input, preRestoreVersion, [
          input.versionId,
          input.preRestoreVersionId,
        ])
        advanceDocumentCollaborationGeneration(currentContent)
        await mutateDocumentContentState(
          em,
          input.documentId,
          scope,
          {
            yjsState: target.yjsState,
            contentHtml: target.contentHtml,
            contentText: target.contentText,
          },
          {
            existingContent: currentContent,
            now: new Date(input.restoreContentUpdatedAt),
          },
        )
      },
      async () => {
        if (!currentContent) throw new Error('[internal] restored content was not loaded')
        await pinDocumentContentUpdatedAt(em, currentContent, input, input.restoreContentUpdatedAt)
      },
    ], { transaction: true, label: 'documents.version.restore' })

    const finalContent = currentContent as DocumentContent | null
    const finalTargetVersion = targetVersion as DocumentVersion | null
    const finalPreRestoreVersion = preRestoreVersion as DocumentVersion | null
    if (!before || !finalContent || !finalTargetVersion || !finalPreRestoreVersion) {
      throw new Error('[internal] version restore did not capture content state')
    }
    await bufferDocumentIndexRefresh(ctx, finalContent)
    const restoredDocument = await findOneWithDecryption(
      em,
      Document,
      {
        id: input.documentId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        deletedAt: null,
      },
      { fields: ['id', 'title'] },
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    const watcherRecipientIds = restoredDocument
      ? await resolveWatcherRecipients({
          em,
          container: ctx.container,
          scope: { tenantId: input.tenantId, organizationId: input.organizationId },
          documentId: input.documentId,
          actorUserId: input.actorUserId,
        })
      : []
    return {
      contentHtml: finalContent.contentHtml ?? '',
      contentText: finalContent.contentText ?? '',
      updatedAt: finalContent.updatedAt.toISOString(),
      restoredVersionId: input.versionId,
      preRestoreVersionId: input.preRestoreVersionId,
      preRestoreSnapshot: captureVersion(finalPreRestoreVersion),
      restoredSnapshot: captureVersion(finalTargetVersion),
      projections: [
        buildVersionRestoredProjection(
          input,
          input.versionId,
          input.preRestoreVersionId,
          { includeActor: true },
        ),
        ...(restoredDocument
          ? watcherRecipientIds.map((recipientUserId): DocumentsProjectionDescriptor => ({
              kind: 'watch-notification',
              recipientUserId,
              tenantId: input.tenantId,
              organizationId: input.organizationId,
              documentId: input.documentId,
              documentTitle: restoredDocument.title,
              notificationType: 'documents.watch.changed',
              bodyKey: 'documents.notifications.watch.changed.restoredBody',
              sourceEntityType: DOCUMENTS_ENTITY_IDS.document,
              sourceEntityId: input.documentId,
              linkHref: `/backend/documents/${encodeURIComponent(input.documentId)}`,
            }))
          : []),
      ],
    }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.versionRestored', 'Restore document version'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentVersion,
      resourceId: input.versionId,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.document,
      parentResourceId: input.documentId,
      relatedResourceKind: DOCUMENTS_ENTITY_IDS.documentVersion,
      relatedResourceId: input.preRestoreVersionId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: result.preRestoreSnapshot,
      snapshotAfter: {
        ...result.restoredSnapshot,
        contentUpdatedAt: result.updatedAt,
      },
      payload: {
        documentId: input.documentId,
        restoredVersionId: input.versionId,
        preRestoreVersionId: input.preRestoreVersionId,
        restoredContentDigest: result.restoredSnapshot.contentDigest,
        preRestoreContentDigest: result.preRestoreSnapshot.contentDigest,
        contentUpdatedAt: result.updatedAt,
      },
    }
  },
}

registerCommand(createVersionCommand)
registerCommand(restoreVersionCommand)

export { createVersionCommand, restoreVersionCommand }
