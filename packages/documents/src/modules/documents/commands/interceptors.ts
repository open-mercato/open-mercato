import type {
  CommandInterceptor,
  CommandInterceptorContext,
  CommandInterceptorUndoContext,
} from '@open-mercato/shared/lib/commands/command-interceptor'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
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
    throw new Error('Notification service is unavailable')
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

/**
 * Projection hooks are deliberately post-command. CommandBus persists the
 * ActionLog (or marks it undone) before these hooks run, so a flaky event bus
 * or notification store can never roll back an acknowledged document write.
 */
export const interceptors: CommandInterceptor[] = PROJECTED_COMMAND_IDS.map(buildProjectionInterceptor)

export default interceptors
