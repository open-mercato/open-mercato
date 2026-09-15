import type { EntityManager } from '@mikro-orm/postgresql'

const mockResolveUserAccess = jest.fn()
const mockLoadScopedDocument = jest.fn()

jest.mock('../lib/permissions', () => ({
  ...jest.requireActual('../lib/permissions'),
  loadScopedDocument: (...args: unknown[]) => mockLoadScopedDocument(...args),
  resolveLoadedDocumentUserAccess: (...args: unknown[]) => mockResolveUserAccess(...args),
}))

import { resolveWatcherRecipients, DOCUMENTS_MAX_ACTIVE_WATCHERS } from '../lib/watchers'
import type { DocumentsServiceContainer } from '../lib/platformServices'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const documentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const watcherA = '44444444-4444-4444-8444-444444444444'
const watcherB = '55555555-5555-4555-8555-555555555555'
const mentionedWatcher = '66666666-6666-4666-8666-666666666666'

function makeEntityManager(rows: Array<{ userId: string }>): EntityManager {
  return {
    find: jest.fn(async () => rows),
  } as unknown as EntityManager
}

const container = { resolve: jest.fn() } as unknown as DocumentsServiceContainer

describe('M9 watcher recipient resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLoadScopedDocument.mockResolvedValue({ id: documentId })
    mockResolveUserAccess.mockResolvedValue('viewer')
  })

  it('excludes the acting user from recipients', async () => {
    const recipients = await resolveWatcherRecipients({
      em: makeEntityManager([{ userId: actorUserId }, { userId: watcherA }]),
      container,
      scope,
      documentId,
      actorUserId,
    })
    expect(recipients).toEqual([watcherA])
  })

  it('excludes mention-notified users passed as exclusions', async () => {
    const recipients = await resolveWatcherRecipients({
      em: makeEntityManager([{ userId: mentionedWatcher }, { userId: watcherB }]),
      container,
      scope,
      documentId,
      actorUserId,
      excludeUserIds: [mentionedWatcher],
    })
    expect(recipients).toEqual([watcherB])
  })

  it('fails closed for watchers whose current access resolves to nothing', async () => {
    mockResolveUserAccess.mockImplementation(async (...args: unknown[]) => {
      const candidate = args[3]
      return candidate === watcherA ? 'viewer' : null
    })
    const recipients = await resolveWatcherRecipients({
      em: makeEntityManager([{ userId: watcherA }, { userId: watcherB }]),
      container,
      scope,
      documentId,
      actorUserId,
    })
    expect(recipients).toEqual([watcherA])
  })

  it('fails closed when a single access resolution throws', async () => {
    mockResolveUserAccess.mockImplementation(async (...args: unknown[]) => {
      const candidate = args[3]
      if (candidate === watcherB) throw new Error('[internal] access resolution unavailable')
      return 'viewer'
    })
    const recipients = await resolveWatcherRecipients({
      em: makeEntityManager([{ userId: watcherA }, { userId: watcherB }]),
      container,
      scope,
      documentId,
      actorUserId,
    })
    expect(recipients).toEqual([watcherA])
  })

  it('returns no recipients when the watcher lookup itself fails', async () => {
    const em = {
      find: jest.fn(async () => {
        throw new Error('[internal] lookup unavailable')
      }),
    } as unknown as EntityManager
    const recipients = await resolveWatcherRecipients({
      em,
      container,
      scope,
      documentId,
      actorUserId,
    })
    expect(recipients).toEqual([])
  })

  it('loads the document once regardless of the watcher count', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      userId: `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`,
    }))
    const recipients = await resolveWatcherRecipients({
      em: makeEntityManager(rows),
      container,
      scope,
      documentId,
      actorUserId,
    })
    expect(recipients).toEqual(rows.map((row) => row.userId))
    expect(mockLoadScopedDocument).toHaveBeenCalledTimes(1)
    expect(mockResolveUserAccess).toHaveBeenCalledTimes(rows.length)
  })

  it('fails closed when the scoped document is missing', async () => {
    mockLoadScopedDocument.mockResolvedValue(null)
    const recipients = await resolveWatcherRecipients({
      em: makeEntityManager([{ userId: watcherA }]),
      container,
      scope,
      documentId,
      actorUserId,
    })
    expect(recipients).toEqual([])
    expect(mockResolveUserAccess).not.toHaveBeenCalled()
  })

  it('fails closed when the scoped document lookup throws', async () => {
    mockLoadScopedDocument.mockRejectedValue(new Error('[internal] document lookup unavailable'))
    const recipients = await resolveWatcherRecipients({
      em: makeEntityManager([{ userId: watcherA }]),
      container,
      scope,
      documentId,
      actorUserId,
    })
    expect(recipients).toEqual([])
    expect(mockResolveUserAccess).not.toHaveBeenCalled()
  })

  it('bounds the lookup by the documented watcher cap', async () => {
    const em = makeEntityManager([{ userId: watcherA }])
    await resolveWatcherRecipients({ em, container, scope, documentId, actorUserId })
    const findOptions = (em.find as jest.Mock).mock.calls[0]?.[2] as { limit?: number }
    expect(DOCUMENTS_MAX_ACTIVE_WATCHERS).toBe(100)
    expect(findOptions?.limit).toBe(DOCUMENTS_MAX_ACTIVE_WATCHERS)
  })
})
