import type { CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'

const mockEmitDocumentsEvent = jest.fn()
const mockCreateNotification = jest.fn()
const mockDeleteNotifications = jest.fn()
const mockLoggerError = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => {
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: (...args: unknown[]) => mockLoggerError(...args),
      child: () => logger,
    }
    return logger
  },
}))

jest.mock('../events', () => ({
  emitDocumentsEvent: (...args: unknown[]) => mockEmitDocumentsEvent(...args),
}))

import { interceptors } from '../commands/interceptors'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const documentId = '44444444-4444-4444-8444-444444444444'
const commentId = '55555555-5555-4555-8555-555555555555'
const recipientUserId = '66666666-6666-4666-8666-666666666666'
const originalActorUserId = '77777777-7777-4777-8777-777777777777'

function context(
  commandId: string,
  container: CommandInterceptorContext['container'] = {
    resolve: (token: string) => {
      if (token === 'notificationService') {
        return { create: mockCreateNotification, deleteBySource: mockDeleteNotifications }
      }
      throw new Error(`Unexpected dependency: ${token}`)
    },
  } as CommandInterceptorContext['container'],
): CommandInterceptorContext {
  return {
    commandId,
    auth: { sub: actorUserId } as CommandInterceptorContext['auth'],
    selectedOrganizationId: organizationId,
    container,
  }
}

function interceptorFor(commandId: string) {
  const interceptor = interceptors.find((candidate) => candidate.targetCommand === commandId)
  if (!interceptor) throw new Error(`Missing interceptor for ${commandId}`)
  return interceptor
}

describe('documents post-log command projections', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('targets only the commands that return custom projection descriptors', () => {
    expect(interceptors.filter((interceptor) => interceptor.afterExecute).map((interceptor) => interceptor.targetCommand)).toEqual([
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
    ])
  })

  it('does not fail an acknowledged command when lifecycle event delivery fails', async () => {
    mockEmitDocumentsEvent.mockRejectedValueOnce(new Error('event bus unavailable'))
    const interceptor = interceptorFor('documents.version.restore')

    await expect(interceptor.afterExecute?.(
      {},
      {
        projections: [{
          kind: 'event',
          eventId: 'documents.version.restored',
          tenantId,
          organizationId,
          payload: { id: documentId, documentId, tenantId, organizationId },
        }],
      },
      context('documents.version.restore'),
    )).resolves.toBeUndefined()

    expect(mockEmitDocumentsEvent).toHaveBeenCalledWith(
      'documents.version.restored',
      expect.objectContaining({ documentId, userId: actorUserId }),
      { tenantId, organizationId },
    )
    expect(mockLoggerError).toHaveBeenCalled()
  })

  it('keeps content replacement successful when reindexing fails and still projects the update event', async () => {
    const indexRecordById = jest.fn().mockRejectedValueOnce(new Error('index unavailable'))
    mockEmitDocumentsEvent.mockResolvedValueOnce(undefined)
    const interceptor = interceptorFor('documents.content.replace')
    const container = {
      resolve: (token: string) => {
        if (token === 'searchIndexer') return { indexRecordById }
        throw new Error(`Unexpected dependency: ${token}`)
      },
    } as CommandInterceptorContext['container']

    await expect(interceptor.afterExecute?.(
      {},
      {
        projections: [
          { kind: 'document-index', documentId, tenantId, organizationId },
          {
            kind: 'event',
            eventId: 'documents.document.updated',
            tenantId,
            organizationId,
            payload: {
              id: documentId,
              tenantId,
              organizationId,
              contentEpochReset: true,
            },
          },
        ],
      },
      context('documents.content.replace', container),
    )).resolves.toBeUndefined()

    expect(indexRecordById).toHaveBeenCalledWith({
      entityId: 'documents:document',
      recordId: documentId,
      tenantId,
      organizationId,
    })
    expect(mockEmitDocumentsEvent).toHaveBeenCalledWith(
      'documents.document.updated',
      expect.objectContaining({ id: documentId, contentEpochReset: true }),
      { tenantId, organizationId },
    )
    expect(mockLoggerError).toHaveBeenCalledTimes(1)
  })

  it('attempts notification persistence even if the mention event fails and swallows both failures', async () => {
    mockEmitDocumentsEvent.mockRejectedValueOnce(new Error('event bus unavailable'))
    mockCreateNotification.mockRejectedValueOnce(new Error('notification store unavailable'))
    const interceptor = interceptorFor('documents.comment.create')

    await expect(interceptor.afterExecute?.(
      {},
      {
        projections: [
          {
            kind: 'event',
            eventId: 'documents.comment.mentioned',
            tenantId,
            organizationId,
            payload: {
              id: commentId,
              documentId,
              mentionedUserId: recipientUserId,
              tenantId,
              organizationId,
              userId: actorUserId,
            },
          },
          {
            kind: 'mention-notification',
            recipientUserId,
            tenantId,
            organizationId,
            documentId,
            documentTitle: 'Quarterly review',
            commentId,
            authorUserId: actorUserId,
          },
        ],
      },
      context('documents.comment.create'),
    )).resolves.toBeUndefined()

    expect(mockEmitDocumentsEvent).toHaveBeenCalledWith(
      'documents.comment.mentioned',
      expect.objectContaining({ id: commentId, mentionedUserId: recipientUserId }),
      { tenantId, organizationId },
    )
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId,
        sourceEntityId: commentId,
        linkHref: `/backend/documents/${documentId}?commentId=${commentId}`,
      }),
      { tenantId, organizationId },
    )
    expect(mockLoggerError).toHaveBeenCalledTimes(2)
  })

  it('projects undo descriptors from the persisted ActionLog payload', async () => {
    mockEmitDocumentsEvent.mockResolvedValueOnce(undefined)
    const interceptor = interceptorFor('documents.share.delete')

    await expect(interceptor.afterUndo?.(
      {
        input: {},
        undoToken: 'undo-token',
        logEntry: {
          commandPayload: {
            undo: {
              projectionsAfterUndo: [{
                kind: 'event',
                eventId: 'documents.document.shared',
                tenantId,
                organizationId,
                payload: {
                  id: documentId,
                  documentId,
                  tenantId,
                  organizationId,
                  userId: originalActorUserId,
                },
              }],
            },
          },
        },
      },
      context('documents.share.delete'),
    )).resolves.toBeUndefined()

    expect(mockEmitDocumentsEvent).toHaveBeenCalledWith(
      'documents.document.shared',
      expect.objectContaining({ documentId, userId: actorUserId }),
      { tenantId, organizationId },
    )
  })

  it('cleans stale mention notifications after comment-create undo without failing the undo', async () => {
    mockDeleteNotifications.mockRejectedValueOnce(new Error('notification cleanup unavailable'))
    const interceptor = interceptorFor('documents.comment.create')

    await expect(interceptor.afterUndo?.(
      {
        input: {},
        undoToken: 'undo-token',
        logEntry: {
          commandPayload: {
            undo: {
              projectionsAfterUndo: [{
                kind: 'mention-notification-delete',
                commentId,
                tenantId,
                organizationId,
              }],
            },
          },
        },
      },
      context('documents.comment.create'),
    )).resolves.toBeUndefined()

    expect(mockDeleteNotifications).toHaveBeenCalledWith(
      'documents:document_comment',
      commentId,
      { tenantId, organizationId },
    )
    expect(mockLoggerError).toHaveBeenCalledTimes(1)
  })
})
