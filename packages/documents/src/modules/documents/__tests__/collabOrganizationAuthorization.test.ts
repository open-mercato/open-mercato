import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import * as Y from 'yjs'

const mockResolveUserAccess = jest.fn()

jest.mock('@open-mercato/documents/modules/documents/lib/permissions', () => ({
  ...jest.requireActual('@open-mercato/documents/modules/documents/lib/permissions'),
  resolveUserAccess: (...args: unknown[]) => mockResolveUserAccess(...args),
}))

import {
  authorizeCollabContext,
  createCollabHooks,
  DOCUMENTS_COLLAB_ACTIVE_REAUTHORIZATION_INTERVAL_MS,
  scheduleCollabConnectionReauthorization,
} from '../../../../server/documents-collab-server'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const PARENT_ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const CHILD_ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'
const USER_ID = '55555555-5555-4555-8555-555555555555'
const DOCUMENT_ID = '66666666-6666-4666-8666-666666666666'

function context() {
  return {
    userId: USER_ID,
    tenantId: TENANT_ID,
    organizationId: CHILD_ORGANIZATION_ID,
    documentId: DOCUMENT_ID,
    tier: 'editor' as const,
    readOnly: false,
    exp: null,
  }
}

function harness(organizations: string[], persistedOrganizations: Array<{
  id: string
  descendantIds: string[]
}>) {
  const authorizationOrder: string[] = []
  const em = {
    find: jest.fn(async (entity: unknown) => (
      entity === Organization ? persistedOrganizations : []
    )),
  }
  const rbacService = {
    invalidateUserCache: jest.fn(async () => {
      authorizationOrder.push('invalidate')
    }),
    loadAcl: jest.fn(async () => {
      authorizationOrder.push('load')
      return {
        isSuperAdmin: false,
        features: ['documents.view', 'documents.edit'],
        organizations,
      }
    }),
  }
  return {
    em,
    rbacService,
    authorizationOrder,
    container: {
      resolve: (name: string) => name === 'em' ? em : rbacService,
    },
  }
}

describe('Documents collaboration organization hierarchy', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveUserAccess.mockResolvedValue('editor')
  })

  it('preserves a current parent grant when authorizing a child document room', async () => {
    const { authorizationOrder, container, rbacService } = harness(
      [PARENT_ORGANIZATION_ID],
      [
        { id: PARENT_ORGANIZATION_ID, descendantIds: [CHILD_ORGANIZATION_ID] },
        { id: CHILD_ORGANIZATION_ID, descendantIds: [] },
      ],
    )

    await expect(authorizeCollabContext(container, context())).resolves.toBe(true)

    expect(authorizationOrder).toEqual([
      'invalidate',
      'load',
      'invalidate',
      'load',
    ])
    expect(rbacService.invalidateUserCache).toHaveBeenCalledTimes(2)
    expect(rbacService.invalidateUserCache).toHaveBeenNthCalledWith(1, USER_ID)
    expect(rbacService.invalidateUserCache).toHaveBeenNthCalledWith(2, USER_ID)
    expect(rbacService.loadAcl).toHaveBeenCalledWith(USER_ID, {
      tenantId: TENANT_ID,
      organizationId: CHILD_ORGANIZATION_ID,
    })
    expect(mockResolveUserAccess).toHaveBeenCalledWith(
      expect.anything(),
      DOCUMENT_ID,
      { tenantId: TENANT_ID, organizationId: CHILD_ORGANIZATION_ID },
      USER_ID,
    )
  })

  it.each([
    ['an empty allowlist', []],
    ['an unresolved allowlist', [OTHER_ORGANIZATION_ID]],
  ])('does not acquire child-room access from %s fallback', async (_label, organizations) => {
    const { container } = harness(
      organizations,
      [{ id: CHILD_ORGANIZATION_ID, descendantIds: [] }],
    )

    await expect(authorizeCollabContext(container, context())).resolves.toBe(false)
    expect(mockResolveUserAccess).not.toHaveBeenCalled()
  })

  it('denies before loading ACL when cache invalidation fails', async () => {
    const { container, rbacService } = harness(
      [CHILD_ORGANIZATION_ID],
      [{ id: CHILD_ORGANIZATION_ID, descendantIds: [] }],
    )
    rbacService.invalidateUserCache.mockRejectedValueOnce(new Error('cache unavailable'))

    await expect(authorizeCollabContext(container, context())).resolves.toBe(false)

    expect(rbacService.invalidateUserCache).toHaveBeenCalledWith(USER_ID)
    expect(rbacService.loadAcl).not.toHaveBeenCalled()
    expect(mockResolveUserAccess).not.toHaveBeenCalled()
  })

  it('denies when the hierarchy refresh invalidation fails without issuing its ACL load', async () => {
    const { container, rbacService } = harness(
      [PARENT_ORGANIZATION_ID],
      [
        { id: PARENT_ORGANIZATION_ID, descendantIds: [CHILD_ORGANIZATION_ID] },
        { id: CHILD_ORGANIZATION_ID, descendantIds: [] },
      ],
    )
    rbacService.invalidateUserCache
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('cache unavailable'))

    await expect(authorizeCollabContext(container, context())).resolves.toBe(false)

    expect(rbacService.invalidateUserCache).toHaveBeenCalledTimes(2)
    expect(rbacService.loadAcl).toHaveBeenCalledTimes(1)
    expect(mockResolveUserAccess).not.toHaveBeenCalled()
  })

  it('denies when the fresh ACL load fails', async () => {
    const { container, rbacService } = harness(
      [CHILD_ORGANIZATION_ID],
      [{ id: CHILD_ORGANIZATION_ID, descendantIds: [] }],
    )
    rbacService.loadAcl.mockRejectedValueOnce(new Error('ACL unavailable'))

    await expect(authorizeCollabContext(container, context())).resolves.toBe(false)

    expect(rbacService.invalidateUserCache).toHaveBeenCalledTimes(1)
    expect(rbacService.loadAcl).toHaveBeenCalledTimes(1)
    expect(mockResolveUserAccess).not.toHaveBeenCalled()
  })
})

describe('Documents collaboration active authorization refresh', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('runs one non-overlapping refresh per connection and closes on revocation', async () => {
    jest.useFakeTimers()
    const close = jest.fn()
    let onClose: (() => void) | undefined
    const connection = {
      close,
      onClose: jest.fn((callback: () => void) => {
        onClose = callback
      }),
    }
    let resolveFirstAuthorization!: (authorized: boolean) => void
    const firstAuthorization = new Promise<boolean>((resolve) => {
      resolveFirstAuthorization = resolve
    })
    const authorize = jest.fn()
      .mockReturnValueOnce(firstAuthorization)
      .mockResolvedValueOnce(false)

    scheduleCollabConnectionReauthorization(connection, authorize)
    expect(authorize).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(DOCUMENTS_COLLAB_ACTIVE_REAUTHORIZATION_INTERVAL_MS)
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(close).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(DOCUMENTS_COLLAB_ACTIVE_REAUTHORIZATION_INTERVAL_MS * 3)
    expect(authorize).toHaveBeenCalledTimes(1)

    resolveFirstAuthorization(true)
    await Promise.resolve()
    await Promise.resolve()
    await jest.advanceTimersByTimeAsync(DOCUMENTS_COLLAB_ACTIVE_REAUTHORIZATION_INTERVAL_MS)
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(DOCUMENTS_COLLAB_ACTIVE_REAUTHORIZATION_INTERVAL_MS * 2)
    expect(authorize).toHaveBeenCalledTimes(2)
    onClose?.()
  })

  it('clears the refresh before disconnect and fails closed on refresh errors', async () => {
    jest.useFakeTimers()
    const close = jest.fn()
    let onClose: (() => void) | undefined
    const connection = {
      close,
      onClose: jest.fn((callback: () => void) => {
        onClose = callback
      }),
    }
    const disconnectedAuthorize = jest.fn(async () => true)

    scheduleCollabConnectionReauthorization(connection, disconnectedAuthorize)
    onClose?.()
    await jest.advanceTimersByTimeAsync(DOCUMENTS_COLLAB_ACTIVE_REAUTHORIZATION_INTERVAL_MS * 2)
    expect(disconnectedAuthorize).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()

    const failingConnection = { close: jest.fn(), onClose: jest.fn() }
    scheduleCollabConnectionReauthorization(
      failingConnection,
      async () => { throw new Error('RBAC unavailable') },
    )
    await jest.advanceTimersByTimeAsync(DOCUMENTS_COLLAB_ACTIVE_REAUTHORIZATION_INTERVAL_MS)
    expect(failingConnection.close).toHaveBeenCalledTimes(1)
  })

  it('retires only the exact mapped room when an active refresh is denied', async () => {
    const room = new Y.Doc()
    const invalidateRoom = jest.fn()
    const hooks = createCollabHooks({
      verifyToken: () => null,
      authorizeContext: async () => false,
      resolveContainer: async () => ({ resolve: () => ({}) }),
      loadContent: async () => null,
      initializeYjsState: async () => null,
      persistContent: async () => ({
        updatedAt: new Date(),
        collaborationGeneration: 1,
      }),
      resolveRoomDocument: (documentName) => documentName === DOCUMENT_ID ? room : undefined,
      invalidateRoom,
    })

    await expect(hooks.reauthorizeActiveConnection(context())).resolves.toBe(false)
    expect(invalidateRoom).toHaveBeenCalledWith(DOCUMENT_ID, room)
  })
})
