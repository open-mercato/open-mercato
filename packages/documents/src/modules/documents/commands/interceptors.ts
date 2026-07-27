import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  CommandInterceptor,
  CommandInterceptorContext,
  CommandInterceptorUndoContext,
} from '@open-mercato/shared/lib/commands/command-interceptor'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Document } from '../data/entities'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { resolveWatcherRecipients } from '../lib/watchers'
import type { DocumentsServiceContainer } from '../lib/platformServices'
import { emitDocumentsEvent } from '../events'
import type {
  DocumentsProjectedCommandResult,
  DocumentsProjectionDescriptor,
  DocumentsProjectionUndoPayload,
} from './projection-types'

const logger = createLogger('documents').child({ component: 'command-projections' })

const PROJECTED_COMMAND_IDS = [
  'documents.content.replace',
  'documents.share.create',
  'documents.share.update',
  'documents.share.delete',
  'documents.comment.create',
  'documents.comment.resolve',
  'documents.version.restore',
  'documents.document.archive',
  'documents.document.unarchive',
  'documents.document.duplicate',
] as const

type DocumentsNotificationService = {
  create: (
    input: Record<string, unknown>,
    scope: { tenantId: string; organizationId: string },
  ) => Promise<unknown>
  deleteBySource: (
    sourceEntityType: string,
    sourceEntityId: string,
    scope: { tenantId: string; organizationId: string },
  ) => Promise<unknown>
}

function resolveDocumentsNotificationService(
  container: CommandInterceptorContext['container'],
): DocumentsNotificationService {
  const service = container.resolve('notificationService') as Partial<DocumentsNotificationService> | null
  if (!service || typeof service.create !== 'function' || typeof service.deleteBySource !== 'function') {
    throw new Error('[internal] Notification service is unavailable')
  }
  return service as DocumentsNotificationService
}

function readResultProjections(result: unknown): DocumentsProjectionDescriptor[] {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return []
  const projections = (result as DocumentsProjectedCommandResult).projections
  return Array.isArray(projections) ? projections : []
}

async function emitProjectedEvent(
  descriptor: Extract<DocumentsProjectionDescriptor, { kind: 'event' }>,
  context: CommandInterceptorContext,
  options: { overrideActor?: boolean } = {},
): Promise<void> {
  const currentActorUserId = context.auth?.userId ?? context.auth?.sub ?? null
  const payload = {
    ...descriptor.payload,
    ...(currentActorUserId && (options.overrideActor || !('userId' in descriptor.payload))
      ? { userId: currentActorUserId }
      : {}),
  }
  try {
    await emitDocumentsEvent(descriptor.eventId, payload, {
      tenantId: descriptor.tenantId,
      organizationId: descriptor.organizationId,
    })
  } catch (error) {
    logger.error('Command event projection failed', {
      commandId: context.commandId,
      eventId: descriptor.eventId,
      err: error,
    })
  }
}

async function emitMentionProjection(
  descriptor: Extract<DocumentsProjectionDescriptor, { kind: 'mention-notification' }>,
  context: CommandInterceptorContext,
): Promise<void> {
  try {
    const notificationService = resolveDocumentsNotificationService(context.container)
    await notificationService.create(
      {
        recipientUserId: descriptor.recipientUserId,
        type: 'documents.comment.mentioned',
        titleKey: 'documents.notifications.comment.mentioned.title',
        bodyKey: 'documents.notifications.comment.mentioned.body',
        severity: 'info',
        titleVariables: { documentTitle: descriptor.documentTitle },
        bodyVariables: {
          documentTitle: descriptor.documentTitle,
          authorUserId: descriptor.authorUserId,
        },
        sourceEntityType: DOCUMENTS_ENTITY_IDS.documentComment,
        sourceEntityId: descriptor.commentId,
        linkHref: `/backend/documents/${encodeURIComponent(descriptor.documentId)}?commentId=${encodeURIComponent(descriptor.commentId)}`,
      },
      {
        tenantId: descriptor.tenantId,
        organizationId: descriptor.organizationId,
      },
    )
  } catch (error) {
    logger.error('Mention notification projection failed', {
      commandId: context.commandId,
      commentId: descriptor.commentId,
      recipientUserId: descriptor.recipientUserId,
      err: error,
    })
  }
}

const WATCH_NOTIFICATION_TITLE_KEYS: Record<string, string> = {
  'documents.watch.commented': 'documents.notifications.watch.commented.title',
  'documents.watch.changed': 'documents.notifications.watch.changed.title',
}

async function emitWatchProjection(
  descriptor: Extract<DocumentsProjectionDescriptor, { kind: 'watch-notification' }>,
  context: CommandInterceptorContext,
): Promise<void> {
  try {
    const notificationService = resolveDocumentsNotificationService(context.container)
    await notificationService.create(
      {
        recipientUserId: descriptor.recipientUserId,
        type: descriptor.notificationType,
        titleKey: WATCH_NOTIFICATION_TITLE_KEYS[descriptor.notificationType],
        bodyKey: descriptor.bodyKey,
        severity: 'info',
        titleVariables: { documentTitle: descriptor.documentTitle },
        bodyVariables: { documentTitle: descriptor.documentTitle },
        sourceEntityType: descriptor.sourceEntityType,
        sourceEntityId: descriptor.sourceEntityId,
        linkHref: descriptor.linkHref,
      },
      {
        tenantId: descriptor.tenantId,
        organizationId: descriptor.organizationId,
      },
    )
  } catch (error) {
    logger.error('Watch notification projection failed', {
      commandId: context.commandId,
      documentId: descriptor.documentId,
      recipientUserId: descriptor.recipientUserId,
      err: error,
    })
  }
}

async function emitWatchFanoutProjection(
  descriptor: Extract<DocumentsProjectionDescriptor, { kind: 'watch-notification-fanout' }>,
  context: CommandInterceptorContext,
): Promise<void> {
  try {
    const em = context.container.resolve('em') as EntityManager
    const scope = { tenantId: descriptor.tenantId, organizationId: descriptor.organizationId }
    const document = await findOneWithDecryption(
      em,
      Document,
      { id: descriptor.documentId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { fields: ['id', 'title'] },
      scope,
    )
    if (!document) return
    const recipientUserIds = await resolveWatcherRecipients({
      em,
      container: context.container as unknown as DocumentsServiceContainer,
      scope,
      documentId: descriptor.documentId,
      actorUserId: context.auth?.userId ?? context.auth?.sub ?? descriptor.actorUserId,
    })
    for (const recipientUserId of recipientUserIds) {
      await emitWatchProjection(
        {
          kind: 'watch-notification',
          recipientUserId,
          tenantId: descriptor.tenantId,
          organizationId: descriptor.organizationId,
          documentId: descriptor.documentId,
          documentTitle: document.title,
          notificationType: descriptor.notificationType,
          bodyKey: descriptor.bodyKey,
          sourceEntityType: descriptor.sourceEntityType,
          sourceEntityId: descriptor.sourceEntityId,
          linkHref: descriptor.linkHref,
        },
        context,
      )
    }
  } catch (error) {
    logger.error('Watch notification fanout projection failed', {
      commandId: context.commandId,
      documentId: descriptor.documentId,
      err: error,
    })
  }
}

async function emitDocumentIndexProjection(
  descriptor: Extract<DocumentsProjectionDescriptor, { kind: 'document-index' }>,
  context: CommandInterceptorContext,
): Promise<void> {
  try {
    const searchIndexer = context.container.resolve('searchIndexer') as {
      indexRecordById: (input: {
        entityId: string
        recordId: string
        tenantId: string
        organizationId: string
      }) => Promise<unknown>
    }
    await searchIndexer.indexRecordById({
      entityId: DOCUMENTS_ENTITY_IDS.document,
      recordId: descriptor.documentId,
      tenantId: descriptor.tenantId,
      organizationId: descriptor.organizationId,
    })
  } catch (error) {
    logger.error('Document index projection failed', {
      commandId: context.commandId,
      documentId: descriptor.documentId,
      err: error,
    })
  }
}

async function deleteMentionNotificationProjection(
  descriptor: Extract<DocumentsProjectionDescriptor, { kind: 'mention-notification-delete' }>,
  context: CommandInterceptorContext,
): Promise<void> {
  try {
    const notificationService = resolveDocumentsNotificationService(context.container)
    await notificationService.deleteBySource(
      DOCUMENTS_ENTITY_IDS.documentComment,
      descriptor.commentId,
      {
        tenantId: descriptor.tenantId,
        organizationId: descriptor.organizationId,
      },
    )
  } catch (error) {
    logger.error('Mention notification cleanup projection failed', {
      commandId: context.commandId,
      commentId: descriptor.commentId,
      err: error,
    })
  }
}

async function projectDescriptors(
  projections: readonly DocumentsProjectionDescriptor[],
  context: CommandInterceptorContext,
  options: { overrideEventActor?: boolean } = {},
): Promise<void> {
  for (const projection of projections) {
    if (projection.kind === 'event') {
      await emitProjectedEvent(projection, context, { overrideActor: options.overrideEventActor })
    }
    else if (projection.kind === 'mention-notification') await emitMentionProjection(projection, context)
    else if (projection.kind === 'watch-notification') await emitWatchProjection(projection, context)
    else if (projection.kind === 'watch-notification-fanout') await emitWatchFanoutProjection(projection, context)
    else if (projection.kind === 'document-index') await emitDocumentIndexProjection(projection, context)
    else await deleteMentionNotificationProjection(projection, context)
  }
}

function buildProjectionInterceptor(commandId: typeof PROJECTED_COMMAND_IDS[number]): CommandInterceptor {
  return {
    id: `documents.${commandId.slice('documents.'.length).replaceAll('.', '-')}-projections`,
    targetCommand: commandId,
    priority: 90,
    async afterExecute(_input, result, context): Promise<void> {
      await projectDescriptors(readResultProjections(result), context)
    },
    async afterUndo(
      undoContext: CommandInterceptorUndoContext,
      context: CommandInterceptorContext,
    ): Promise<void> {
      const undo = extractUndoPayload<DocumentsProjectionUndoPayload>(
        undoContext.logEntry as Parameters<typeof extractUndoPayload>[0],
      )
      await projectDescriptors(
        undo?.projectionsAfterUndo ?? [],
        context,
        { overrideEventActor: true },
      )
    },
  }
}

const ARCHIVED_UNDO_GUARDED_COMMAND_IDS = [
  'documents.document.update',
  'documents.share.create',
  'documents.share.update',
  'documents.share.delete',
  'documents.comment.create',
  'documents.comment.resolve',
  'documents.link.create',
  'documents.link.delete',
  'documents.version.restore',
] as const

type UndoLogEntryShape = {
  resourceKind?: string | null
  resourceId?: string | null
  parentResourceKind?: string | null
  parentResourceId?: string | null
  tenantId?: string | null
  organizationId?: string | null
  commandPayload?: unknown
}

function resolveUndoDocumentId(logEntry: UndoLogEntryShape): string | null {
  if (logEntry.parentResourceKind === DOCUMENTS_ENTITY_IDS.document && logEntry.parentResourceId) {
    return logEntry.parentResourceId
  }
  if (logEntry.resourceKind === DOCUMENTS_ENTITY_IDS.document && logEntry.resourceId) {
    return logEntry.resourceId
  }
  const payload = logEntry.commandPayload
  if (payload && typeof payload === 'object') {
    const redoInput = (payload as { __redoInput?: unknown }).__redoInput
    if (redoInput && typeof redoInput === 'object') {
      const documentId = (redoInput as { documentId?: unknown }).documentId
      if (typeof documentId === 'string' && documentId.length > 0) return documentId
    }
  }
  return null
}

/**
 * Read-only means the undo path too: reversing a pre-archive share, comment,
 * link, or restore would mutate an archived document, so the guard refuses
 * with the same error the execute path uses. Delete-like undos (duplicate,
 * instantiate) stay allowed, matching delete-of-archived semantics.
 */
function buildArchivedUndoGuard(commandId: typeof ARCHIVED_UNDO_GUARDED_COMMAND_IDS[number]): CommandInterceptor {
  return {
    id: `documents.${commandId.slice('documents.'.length).replaceAll('.', '-')}-archived-undo-guard`,
    targetCommand: commandId,
    priority: 100,
    async beforeUndo(
      undoContext: CommandInterceptorUndoContext,
      context: CommandInterceptorContext,
    ): Promise<void> {
      const logEntry = undoContext.logEntry as UndoLogEntryShape
      const documentId = resolveUndoDocumentId(logEntry)
      if (!documentId || !logEntry.tenantId || !logEntry.organizationId) {
        // Every guarded command records the document and its scope. Without
        // them the archived state cannot be read, so refuse the undo instead of
        // waving through a mutation this guard was unable to check.
        logger.error('Archived-undo guard could not resolve the guarded document scope', {
          commandId,
          resourceKind: logEntry.resourceKind ?? null,
          resourceId: logEntry.resourceId ?? null,
        })
        throw new CrudHttpError(403, { error: 'api.errors.forbidden' })
      }
      const em = context.container.resolve('em') as EntityManager
      const scope = { tenantId: logEntry.tenantId, organizationId: logEntry.organizationId }
      const document = await findOneWithDecryption(
        em,
        Document,
        { id: documentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { fields: ['id', 'archivedAt'], filters: false },
        scope,
      )
      if (document?.archivedAt) {
        throw new CrudHttpError(403, { error: 'documents.errors.documentArchived' })
      }
    },
  }
}

/**
 * Projection hooks are deliberately post-command. CommandBus persists the
 * ActionLog (or marks it undone) before these hooks run, so a flaky event bus
 * or notification store can never roll back an acknowledged document write.
 */
export const interceptors: CommandInterceptor[] = [
  ...PROJECTED_COMMAND_IDS.map(buildProjectionInterceptor),
  ...ARCHIVED_UNDO_GUARDED_COMMAND_IDS.map(buildArchivedUndoGuard),
]

export default interceptors
