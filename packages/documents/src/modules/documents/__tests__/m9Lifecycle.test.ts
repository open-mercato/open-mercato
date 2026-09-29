import { commandRegistry } from '@open-mercato/shared/lib/commands'
import '../commands/index'
import { interceptors } from '../commands/interceptors'
import type { DocumentsProjectionDescriptor } from '../commands/projection-types'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const recipientUserId = '44444444-4444-4444-8444-444444444444'

describe('M9 lifecycle and toggle command registration', () => {
  it('registers undoable archive transitions and non-undoable per-user toggles', () => {
    const expectations: Array<{ id: string; undoable: boolean }> = [
      { id: 'documents.document.archive', undoable: true },
      { id: 'documents.document.unarchive', undoable: true },
      { id: 'documents.favorite.create', undoable: false },
      { id: 'documents.favorite.delete', undoable: false },
      { id: 'documents.watch.create', undoable: false },
      { id: 'documents.watch.delete', undoable: false },
      { id: 'documents.document.duplicate', undoable: true },
    ]
    for (const expectation of expectations) {
      const command = commandRegistry.get(expectation.id)
      expect(command).toBeDefined()
      const undoable = typeof command?.undo === 'function' && command?.isUndoable !== false
      expect(undoable).toBe(expectation.undoable)
    }
  })
})

describe('M9 archived-undo guard interceptor', () => {
  const guardedCommandIds = [
    'documents.document.update',
    'documents.share.create',
    'documents.share.update',
    'documents.share.delete',
    'documents.comment.create',
    'documents.comment.resolve',
    'documents.link.create',
    'documents.link.delete',
    'documents.version.restore',
  ]

  function guardFor(commandId: string) {
    const guard = interceptors.find(
      (candidate) => candidate.targetCommand === commandId && typeof candidate.beforeUndo === 'function',
    )
    expect(guard).toBeDefined()
    return guard!
  }

  function guardContext(archivedAt: Date | null) {
    return {
      commandId: 'documents.share.create',
      auth: { sub: recipientUserId },
      container: {
        resolve: jest.fn((name: string) => {
          if (name === 'em') {
            return { findOne: jest.fn(async () => ({ id: documentId, archivedAt })) }
          }
          return undefined
        }),
      },
    } as never
  }

  const undoContext = {
    input: {},
    undoToken: 'undo-token',
    logEntry: {
      parentResourceKind: 'documents:document',
      parentResourceId: documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      commandPayload: {},
    },
  } as never

  it('guards every mutating pre-archive undo path', () => {
    for (const commandId of guardedCommandIds) {
      expect(() => guardFor(commandId)).not.toThrow()
    }
  })

  it('refuses undo on an archived document with the archived error', async () => {
    const guard = guardFor('documents.share.create')
    await expect(
      guard.beforeUndo?.(undoContext, guardContext(new Date('2026-07-16T10:00:00.000Z'))),
    ).rejects.toMatchObject({ status: 403, body: { error: 'documents.errors.documentArchived' } })
  })

  it('allows undo when the document is not archived', async () => {
    const guard = guardFor('documents.version.restore')
    await expect(
      guard.beforeUndo?.(undoContext, guardContext(null)),
    ).resolves.toBeUndefined()
  })

  it.each([
    ['no resolvable document', {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      commandPayload: {},
    }],
    ['no tenant scope', {
      parentResourceKind: 'documents:document',
      parentResourceId: documentId,
      organizationId: scope.organizationId,
      commandPayload: {},
    }],
    ['no organization scope', {
      parentResourceKind: 'documents:document',
      parentResourceId: documentId,
      tenantId: scope.tenantId,
      commandPayload: {},
    }],
    // A log entry the guard cannot resolve cannot be checked against the
    // archived state, so it must fail closed rather than wave the undo through.
  ])('refuses an undo whose log entry has %s', async (_label, logEntry) => {
    const guard = guardFor('documents.share.create')
    await expect(
      guard.beforeUndo?.(
        { input: {}, undoToken: 'undo-token', logEntry } as never,
        guardContext(null),
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('leaves delete-like undos unguarded', () => {
    for (const commandId of ['documents.document.duplicate', 'documents.document.instantiate']) {
      const guard = interceptors.find(
        (candidate) => candidate.targetCommand === commandId && typeof candidate.beforeUndo === 'function',
      )
      expect(guard).toBeUndefined()
    }
  })
})

describe('M9 watch notification projection interceptor', () => {
  function buildWatchDescriptor(): Extract<DocumentsProjectionDescriptor, { kind: 'watch-notification' }> {
    return {
      kind: 'watch-notification',
      recipientUserId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      documentId,
      documentTitle: 'Quarterly SOP',
      notificationType: 'documents.watch.commented',
      bodyKey: 'documents.notifications.watch.commented.body',
      sourceEntityType: 'documents:document_comment',
      sourceEntityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      linkHref: `/backend/documents/${documentId}?commentId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
    }
  }

  function interceptorFor(commandId: string) {
    const interceptor = interceptors.find((candidate) => candidate.targetCommand === commandId)
    expect(interceptor).toBeDefined()
    return interceptor!
  }

  function buildContext(create: jest.Mock) {
    return {
      commandId: 'documents.comment.create',
      auth: { sub: recipientUserId, userId: recipientUserId },
      container: {
        resolve: jest.fn((name: string) => {
          if (name === 'notificationService') {
            return { create, deleteBySource: jest.fn() }
          }
          return undefined
        }),
      },
    } as never
  }

  it('creates the watch notification with explicit keys and a document-scoped link', async () => {
    const create = jest.fn(async () => undefined)
    const interceptor = interceptorFor('documents.comment.create')
    await interceptor.afterExecute?.(
      {},
      { projections: [buildWatchDescriptor()] },
      buildContext(create),
    )
    expect(create).toHaveBeenCalledTimes(1)
    const [payload, notificationScope] = create.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(payload).toMatchObject({
      recipientUserId,
      type: 'documents.watch.commented',
      titleKey: 'documents.notifications.watch.commented.title',
      bodyKey: 'documents.notifications.watch.commented.body',
      severity: 'info',
      linkHref: expect.stringContaining(`/backend/documents/${documentId}`),
    })
    expect(payload.titleVariables).toMatchObject({ documentTitle: 'Quarterly SOP' })
    expect(notificationScope).toEqual(scope)
  })

  it('isolates a notification failure without rejecting the acknowledged command', async () => {
    const create = jest.fn(async () => {
      throw new Error('[internal] notification store unavailable')
    })
    const interceptor = interceptorFor('documents.document.archive')
    await expect(
      interceptor.afterExecute?.(
        {},
        { projections: [{ ...buildWatchDescriptor(), notificationType: 'documents.watch.changed', bodyKey: 'documents.notifications.watch.changed.archivedBody' }] },
        buildContext(create),
      ),
    ).resolves.toBeUndefined()
    expect(create).toHaveBeenCalledTimes(1)
  })
})
