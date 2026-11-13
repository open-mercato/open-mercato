const mockLoggerError = jest.fn()
const mockLoggerWarn = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => {
    const logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: (...args: unknown[]) => mockLoggerWarn(...args),
      error: (...args: unknown[]) => mockLoggerError(...args),
      child: () => logger,
    }
    return logger
  },
}))

import * as Y from 'yjs'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  bindCollabAwarenessStates,
  createCollabFinalDrainRegistry,
  createCollabHooks,
  DOCUMENTS_COLLAB_MAX_AWARENESS_CLIENT_IDS_PER_ROOM,
  DOCUMENTS_COLLAB_MAX_AWARENESS_STATE_BYTES,
  initializeDocumentYjsState,
  markCollabFinalDrainForReauth,
  type CollabHooksDeps,
} from '../../../../server/documents-collab-server'
import {
  mintCollabToken,
  verifyCollabToken,
  type CollabTokenClaims,
} from '../lib/collabToken'
import {
  materializeDocumentContentReplacement,
  yDocToContent,
} from '../lib/collabMaterializer'
import { DOCUMENTS_MAX_YJS_STATE_BYTES } from '../lib/resourceLimits'

type JsdomModule = typeof import('jsdom')
type JsdomInstance = InstanceType<JsdomModule['JSDOM']>

jest.mock('happy-dom', () => {
  const { JSDOM } = jest.requireActual<JsdomModule>('jsdom')
  class Window {
    readonly document: Document
    readonly DOMParser: typeof globalThis.DOMParser
    readonly happyDOM = {
      abort: () => undefined,
      close: () => undefined,
    }

    private readonly dom: JsdomInstance

    constructor() {
      this.dom = new JSDOM('<!doctype html><html><body></body></html>')
      this.document = this.dom.window.document
      this.DOMParser = this.dom.window.DOMParser
    }
  }

  return { Window }
})

const DOC = '11111111-1111-4111-8111-111111111111'
const OTHER_DOC = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const OTHER_USER = '77777777-7777-4777-8777-777777777777'
const TENANT = '44444444-4444-4444-8444-444444444444'
const OTHER_TENANT = '55555555-5555-4555-8555-555555555555'
const ORGANIZATION = '66666666-6666-4666-8666-666666666666'
const CONTENT_V0 = '2026-07-10T10:00:00.000Z'
const CONTENT_V1 = '2026-07-10T10:00:01.000Z'
const CURSOR = {
  anchor: { tname: 'default', assoc: 0 },
  head: { tname: 'default', assoc: 0 },
}

type LoadSpy = jest.Mock<
  ReturnType<CollabHooksDeps['loadContent']>,
  Parameters<CollabHooksDeps['loadContent']>
>
type PersistSpy = jest.Mock<
  ReturnType<CollabHooksDeps['persistContent']>,
  Parameters<CollabHooksDeps['persistContent']>
>

function claims(
  tier: CollabTokenClaims['tier'],
  overrides: Partial<CollabTokenClaims> = {},
): CollabTokenClaims {
  return {
    userId: USER,
    tenantId: TENANT,
    organizationId: ORGANIZATION,
    documentId: DOC,
    tier,
    ...overrides,
  }
}

function token(
  tier: CollabTokenClaims['tier'],
  overrides: Partial<CollabTokenClaims> = {},
): string {
  return mintCollabToken(claims(tier, overrides))
}

function tamperSignature(value: string): string {
  const [header, payload, signature = ''] = value.split('.')
  const replacement = signature.startsWith('a') ? 'b' : 'a'
  return `${header}.${payload}.${replacement}${signature.slice(1)}`
}

function makeHooks(overrides: Partial<CollabHooksDeps> = {}) {
  const loadSpy: LoadSpy = jest.fn()
  const persistSpy: PersistSpy = jest.fn()
  loadSpy.mockResolvedValue({
    yjsState: null,
    contentHtml: null,
    updatedAt: CONTENT_V0,
    collaborationGeneration: 1,
  })
  persistSpy.mockResolvedValue({ updatedAt: CONTENT_V1, collaborationGeneration: 1 })

  const hooks = createCollabHooks({
    verifyToken: (candidate) => verifyCollabToken(candidate),
    authorizeContext: async () => true,
    resolveAwarenessName: async () => 'Trusted collaborator',
    resolveContainer: async () => ({
      resolve: (name: string) => (
        name === 'em'
          ? {}
          : { indexRecordById: async () => undefined }
      ),
    }),
    loadContent: loadSpy,
    initializeYjsState: async () => null,
    persistContent: persistSpy,
    allowedOrigins: null,
    ...overrides,
  })

  return { hooks, loadSpy, persistSpy }
}

beforeAll(() => {
  process.env.JWT_SECRET = 'seam-secret-xyz'
  delete process.env.DOCUMENTS_COLLAB_JWT_SECRET
})

afterEach(() => {
  jest.clearAllMocks()
  jest.useRealTimers()
})

describe('documents collab auth hooks', () => {
  it('keeps editor connections writable and returns token scope', async () => {
    const { hooks } = makeHooks()
    const connection = { readOnly: false }

    const context = await hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection,
    })

    expect(connection.readOnly).toBe(false)
    expect(context).toEqual({
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor',
      readOnly: false,
      exp: expect.any(Number),
      awarenessUser: {
        id: USER,
        name: 'Trusted collaborator',
        color: expect.stringMatching(/^#[0-9a-f]{6}$/),
      },
    })
  })

  it('binds awareness identity to the authenticated user instead of client fields', async () => {
    const { hooks } = makeHooks({
      resolveAwarenessName: async () => 'Trusted collaborator',
    })
    const context = await hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })
    const states = new Map<number, Record<string, unknown>>([
      [42, {
        cursor: {
          anchor: { ...CURSOR.anchor, ignored: 'not rebroadcast' },
          head: { ...CURSOR.head, ignored: 'not rebroadcast' },
          ignored: 'not rebroadcast',
        },
        user: {
          id: 'attacker',
          name: 'Administrator',
          color: '#fff;background-image:url(https://attacker.invalid)',
        },
        arbitrary: { nested: 'not rebroadcast' },
      }],
    ])

    await hooks.beforeHandleAwareness({ context, states })

    expect(states.get(42)).toEqual({
      user: context.awarenessUser,
      cursor: CURSOR,
    })
    expect(JSON.stringify(states.get(42))).not.toContain('attacker.invalid')
    expect(JSON.stringify(states.get(42))).not.toContain('Administrator')
  })

  it('rejects awareness updates without an authenticated server-bound identity', async () => {
    const { hooks } = makeHooks()

    await expect(hooks.beforeHandleAwareness({
      context: undefined,
      states: new Map([[1, { user: { name: 'Spoofed', color: 'red' } }]]),
    })).rejects.toThrow('awareness identity is not authenticated')
  })

  it('drops an echoed or spoofed awareness client owned by another connection', async () => {
    const { hooks } = makeHooks()
    const context = await hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })
    const states = new Map([[99, { user: { name: 'Spoofed', color: '#123456' } }]])

    await hooks.beforeHandleAwareness({
      context,
      states,
      ownedClientIds: new Set([42]),
      occupiedClientIds: new Set([42, 99]),
    })

    expect(states.has(99)).toBe(false)
  })

  it('drops foreign echoes while canonicalizing this connection own awareness state', async () => {
    const { hooks } = makeHooks({
      resolveAwarenessName: async () => 'Trusted collaborator',
    })
    const context = await hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })
    const states = new Map<number, Record<string, unknown>>([
      [42, {
        cursor: CURSOR,
        user: { name: 'Forged own label', color: 'red' },
      }],
      [99, {
        cursor: CURSOR,
        user: { name: 'Echoed peer', color: '#123456' },
      }],
    ])

    await hooks.beforeHandleAwareness({
      context,
      states,
      ownedClientIds: new Set([42]),
      occupiedClientIds: new Set([42, 99]),
    })

    expect(states.has(99)).toBe(false)
    expect(states.get(42)).toEqual({
      user: context.awarenessUser,
      cursor: CURSOR,
    })
  })

  it('drops Hocuspocus scratch awareness entries instead of broadcasting phantom users', async () => {
    const { hooks } = makeHooks()
    const context = await hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })
    const states = new Map<number, Record<string, unknown>>([
      [41, {}],
      [42, { cursor: CURSOR }],
    ])

    await hooks.beforeHandleAwareness({ context, states })

    expect(states.has(41)).toBe(false)
    expect(states.get(42)).toMatchObject({ user: context.awarenessUser })
  })

  it('drops oversized awareness states before they can be retained or rebroadcast', async () => {
    const { hooks } = makeHooks()
    const context = await hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })
    const states = new Map<number, Record<string, unknown>>([
      [42, { amplifier: 'x'.repeat(DOCUMENTS_COLLAB_MAX_AWARENESS_STATE_BYTES + 1) }],
    ])

    await hooks.beforeHandleAwareness({ context, states })

    expect(states.size).toBe(0)
  })

  it('admits only one client id during a websocket connection lifetime', async () => {
    const { hooks } = makeHooks()
    const connection = { readOnly: false }
    const document = new Y.Doc()
    const context = await hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection,
    })

    try {
      const initial = new Map<number, Record<string, unknown>>([[42, { cursor: CURSOR }]])
      await hooks.beforeHandleAwareness({
        context,
        states: initial,
        ownedClientIds: new Set(),
        occupiedClientIds: new Set(),
        connection,
        document,
      })
      expect(initial.has(42)).toBe(true)

      const rotated = new Map<number, Record<string, unknown>>([[43, { cursor: CURSOR }]])
      await hooks.beforeHandleAwareness({
        context,
        states: rotated,
        ownedClientIds: new Set([42]),
        occupiedClientIds: new Set([42]),
        connection,
        document,
      })
      expect(rotated.size).toBe(0)

      const update = new Map<number, Record<string, unknown>>([[42, { cursor: CURSOR }]])
      await hooks.beforeHandleAwareness({
        context,
        states: update,
        ownedClientIds: new Set([42]),
        occupiedClientIds: new Set([42]),
        connection,
        document,
      })
      expect(update.get(42)).toEqual({ user: context.awarenessUser, cursor: CURSOR })
    } finally {
      document.destroy()
    }
  })

  it('bounds room-lifetime client ids and never recycles one across actors', async () => {
    const { hooks } = makeHooks()
    const context = await hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })
    const roomClientOwners = new Map<number, string>(
      Array.from(
        { length: DOCUMENTS_COLLAB_MAX_AWARENESS_CLIENT_IDS_PER_ROOM },
        (_, clientId) => [clientId, USER] as const,
      ),
    )
    const overflow = new Map<number, Record<string, unknown>>([
      [DOCUMENTS_COLLAB_MAX_AWARENESS_CLIENT_IDS_PER_ROOM, { cursor: CURSOR }],
    ])

    bindCollabAwarenessStates(context, overflow, {
      ownedClientIds: new Set(),
      occupiedClientIds: new Set(),
      claimedClientIds: new Set(),
      roomClientOwners,
    })
    expect(overflow.size).toBe(0)
    expect(roomClientOwners.size).toBe(DOCUMENTS_COLLAB_MAX_AWARENESS_CLIENT_IDS_PER_ROOM)

    const recycled = new Map<number, Record<string, unknown>>([[42, { cursor: CURSOR }]])
    bindCollabAwarenessStates({
      ...context,
      userId: OTHER_USER,
      awarenessUser: {
        id: OTHER_USER,
        name: 'Other collaborator',
        color: '#123456',
      },
    }, recycled, {
      ownedClientIds: new Set(),
      occupiedClientIds: new Set(),
      claimedClientIds: new Set(),
      roomClientOwners,
    })
    expect(recycled.size).toBe(0)
  })

  it('marks viewer connections read-only', async () => {
    const { hooks } = makeHooks()
    const connection = { readOnly: false }

    await hooks.onAuthenticate({
      token: token('viewer'),
      documentName: DOC,
      connection,
    })

    expect(connection.readOnly).toBe(true)
  })

  it('marks commenter connections read-only', async () => {
    const { hooks } = makeHooks()
    const connection = { readOnly: false }

    await hooks.onAuthenticate({
      token: token('commenter'),
      documentName: DOC,
      connection,
    })

    expect(connection.readOnly).toBe(true)
  })

  it('rejects a tampered token', async () => {
    const { hooks } = makeHooks()

    await expect(hooks.onAuthenticate({
      token: tamperSignature(token('editor')),
      documentName: DOC,
      connection: { readOnly: false },
    })).rejects.toThrow()
  })

  it('rejects a token minted for another document room', async () => {
    const { hooks } = makeHooks()

    await expect(hooks.onAuthenticate({
      token: token('editor', { documentId: OTHER_DOC }),
      documentName: DOC,
      connection: { readOnly: false },
    })).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-08T00:00:00.000Z') })
    const expiredToken = token('editor')
    jest.setSystemTime(new Date('2026-07-08T00:01:01.000Z'))
    const { hooks } = makeHooks()

    await expect(hooks.onAuthenticate({
      token: expiredToken,
      documentName: DOC,
      connection: { readOnly: false },
    })).rejects.toThrow()
  })

  it('accepts a legacy token at the exact issuer clock-skew boundary', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-08T00:00:00.000Z') })
    const issuedToken = token('editor')
    jest.setSystemTime(new Date('2026-07-07T23:59:55.000Z'))
    const { hooks } = makeHooks()

    await expect(hooks.onAuthenticate({
      token: issuedToken,
      documentName: DOC,
      connection: { readOnly: false },
    })).resolves.toMatchObject({ tier: 'editor' })
  })

  it('rejects a legacy token beyond the issuer clock-skew boundary', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-08T00:00:00.000Z') })
    const issuedToken = token('editor')
    jest.setSystemTime(new Date('2026-07-07T23:59:54.000Z'))
    const { hooks } = makeHooks()

    await expect(hooks.onAuthenticate({
      token: issuedToken,
      documentName: DOC,
      connection: { readOnly: false },
    })).rejects.toThrow('invalid token')
  })

  it('loads content with the authenticated context scope', async () => {
    const { hooks, loadSpy } = makeHooks()
    const document = new Y.Doc()

    const loaded = await hooks.onLoadDocument({
      documentName: DOC,
      context: {
        userId: USER,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        documentId: DOC,
        tier: 'editor',
        readOnly: false,
        exp: null,
      },
      document,
    })

    expect(loaded).toBe(document)
    expect(loadSpy).toHaveBeenCalledWith(
      expect.anything(),
      DOC,
      { tenantId: TENANT, organizationId: ORGANIZATION },
    )
    expect(loadSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      DOC,
      { tenantId: OTHER_TENANT, organizationId: ORGANIZATION },
    )
    expect(document.getXmlFragment('default').length).toBe(0)
  })

  it('repairs a legacy document without content before recording the room CAS version', async () => {
    const loadContent = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        yjsState: null,
        contentHtml: '',
        updatedAt: CONTENT_V0,
        collaborationGeneration: 1,
      })
    const initializeYjsState = jest.fn(async () => null)
    const { hooks, persistSpy } = makeHooks({ loadContent, initializeYjsState })
    const document = new Y.Doc()
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }

    await expect(hooks.onLoadDocument({ documentName: DOC, context, document }))
      .resolves.toBe(document)
    await hooks.onStoreDocument({ documentName: DOC, context, document })

    expect(initializeYjsState).toHaveBeenCalledWith(
      expect.anything(),
      DOC,
      { tenantId: TENANT, organizationId: ORGANIZATION },
    )
    expect(loadContent).toHaveBeenCalledTimes(2)
    expect(persistSpy.mock.calls[0]?.[4]).toMatchObject({
      expectedUpdatedAt: CONTENT_V0,
      requireExpectedVersion: true,
    })
  })

  it('creates the missing legacy content row while holding the document lock', async () => {
    const document = { id: DOC }
    const createdContent = {
      id: '77777777-7777-4777-8777-777777777777',
      documentId: DOC,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      contentHtml: '',
      contentText: '',
      yjsState: null,
      collaborationGeneration: 1,
      deletedAt: null,
      updatedAt: new Date(CONTENT_V0),
    }
    type FakeEntityManager = {
      transactional: <T>(callback: (transactionalEm: FakeEntityManager) => Promise<T>) => Promise<T>
      findOne: jest.Mock
      create: jest.Mock
      persist: jest.Mock
      flush: jest.Mock
    }
    const em = {} as FakeEntityManager
    em.transactional = async <T>(callback: (transactionalEm: FakeEntityManager) => Promise<T>) => callback(em)
    em.findOne = jest.fn()
      .mockResolvedValueOnce(document)
      .mockResolvedValueOnce(null)
    em.create = jest.fn(() => createdContent)
    em.persist = jest.fn()
    em.flush = jest.fn(async () => undefined)

    await expect(initializeDocumentYjsState(
      em as never,
      DOC,
      { tenantId: TENANT, organizationId: ORGANIZATION },
    )).resolves.toBeNull()

    expect(em.findOne).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      expect.objectContaining({ id: DOC, deletedAt: null }),
      expect.objectContaining({ lockMode: expect.anything() }),
    )
    expect(em.create).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        documentId: DOC,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        contentHtml: '',
        contentText: '',
        collaborationGeneration: 1,
      }),
    )
    expect(em.persist).toHaveBeenCalledWith(createdContent)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('repairs a tombstoned live content row as blank without reviving its old body', async () => {
    const document = { id: DOC }
    const tombstonedContent = {
      id: '77777777-7777-4777-8777-777777777777',
      documentId: DOC,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      contentHtml: '<p>Undone body</p>',
      contentText: 'Undone body',
      yjsState: Buffer.from([1, 2, 3]),
      collaborationGeneration: 4,
      deletedAt: new Date('2026-07-10T09:59:00.000Z'),
      updatedAt: new Date(CONTENT_V0),
    }
    type FakeEntityManager = {
      transactional: <T>(callback: (transactionalEm: FakeEntityManager) => Promise<T>) => Promise<T>
      findOne: jest.Mock
      flush: jest.Mock
    }
    const em = {} as FakeEntityManager
    em.transactional = async <T>(callback: (transactionalEm: FakeEntityManager) => Promise<T>) => callback(em)
    em.findOne = jest.fn()
      .mockResolvedValueOnce(document)
      .mockResolvedValueOnce(tombstonedContent)
    em.flush = jest.fn(async () => undefined)

    await expect(initializeDocumentYjsState(
      em as never,
      DOC,
      { tenantId: TENANT, organizationId: ORGANIZATION },
    )).resolves.toBeNull()

    expect(tombstonedContent).toMatchObject({
      contentHtml: '',
      contentText: '',
      yjsState: null,
      collaborationGeneration: 5,
      deletedAt: null,
    })
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('keeps an HTML-only bootstrap stable when the client reconnects to a reloaded room', async () => {
    const contentHtml = '<p>Reconnect keeps one paragraph</p>'
    const persisted = {
      id: '77777777-7777-4777-8777-777777777777',
      documentId: DOC,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      deletedAt: null,
      contentHtml,
      yjsState: null as Buffer | null,
      collaborationGeneration: 1,
    }
    type FakeEntityManager = {
      transactional: <T>(callback: (transactionalEm: FakeEntityManager) => Promise<T>) => Promise<T>
      findOne: jest.Mock
      nativeUpdate: jest.Mock
    }
    const em = {} as FakeEntityManager
    em.transactional = async <T>(callback: (transactionalEm: FakeEntityManager) => Promise<T>) => callback(em)
    em.findOne = jest.fn(async () => persisted)
    em.nativeUpdate = jest.fn(async (_entity, _where, input: { yjsState: Buffer }) => {
      persisted.yjsState = Buffer.from(input.yjsState)
      return 1
    })
    const { hooks } = makeHooks({
      resolveContainer: async () => ({ resolve: () => em }),
      loadContent: async () => ({
        yjsState: persisted.yjsState,
        contentHtml,
        updatedAt: CONTENT_V0,
        collaborationGeneration: 1,
      }),
      initializeYjsState: (_em, documentId, scope) => initializeDocumentYjsState(
        em as never,
        documentId,
        scope,
      ),
    })
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }

    const firstRoom = new Y.Doc()
    await hooks.onLoadDocument({ documentName: DOC, context, document: firstRoom })
    const retainedClient = new Y.Doc()
    Y.applyUpdate(retainedClient, Y.encodeStateAsUpdate(firstRoom))

    const reloadedRoom = new Y.Doc()
    await hooks.onLoadDocument({ documentName: DOC, context, document: reloadedRoom })
    Y.applyUpdate(retainedClient, Y.encodeStateAsUpdate(reloadedRoom))

    expect(yDocToContent(retainedClient)?.text).toBe('Reconnect keeps one paragraph')
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
  })

  it('rejects reauthentication until the invalidated mapped room unloads', async () => {
    const invalidatedDocument = new Y.Doc()
    const invalidatedDocuments = new WeakSet<Y.Doc>([invalidatedDocument])
    let mappedDocument: Y.Doc | undefined = invalidatedDocument
    const { hooks } = makeHooks({
      isRoomInvalidated: (_documentName, document) => {
        const candidate = document ?? mappedDocument
        return Boolean(candidate && invalidatedDocuments.has(candidate))
      },
    })

    await expect(hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })).rejects.toThrow('room is reloading authoritative content')

    mappedDocument = undefined
    await expect(hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })).resolves.toMatchObject({ documentId: DOC, readOnly: false })
  })

  it('suppresses only the invalidated room instance and persists a replacement room immediately', async () => {
    const invalidatedDocument = new Y.Doc()
    const replacementDocument = new Y.Doc()
    const invalidatedDocuments = new WeakSet<Y.Doc>([invalidatedDocument])
    const { hooks, persistSpy } = makeHooks({
      isRoomInvalidated: (_documentName, document) => Boolean(
        document && invalidatedDocuments.has(document)
      ),
    })

    await hooks.onStoreDocument({
      documentName: DOC,
      context: {
        userId: USER,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        documentId: DOC,
        tier: 'editor',
        readOnly: false,
        exp: null,
      },
      document: invalidatedDocument,
    })

    expect(persistSpy).not.toHaveBeenCalled()

    await hooks.onLoadDocument({
      documentName: DOC,
      context: {
        userId: USER,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        documentId: DOC,
        tier: 'editor',
        readOnly: false,
        exp: null,
      },
      document: replacementDocument,
    })

    await hooks.onStoreDocument({
      documentName: DOC,
      context: {
        userId: USER,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        documentId: DOC,
        tier: 'editor',
        readOnly: false,
        exp: null,
      },
      document: replacementDocument,
    })

    expect(persistSpy).toHaveBeenCalledTimes(1)
  })

  it('CASes every room store against the content version captured at load', async () => {
    const document = new Y.Doc()
    const { hooks, persistSpy } = makeHooks()
    persistSpy
      .mockResolvedValueOnce({ updatedAt: CONTENT_V1, collaborationGeneration: 1 })
      .mockResolvedValueOnce({
        updatedAt: '2026-07-10T10:00:02.000Z',
        collaborationGeneration: 1,
      })
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }

    await hooks.onLoadDocument({ documentName: DOC, context, document })
    await hooks.onStoreDocument({ documentName: DOC, context, document })
    await hooks.onStoreDocument({ documentName: DOC, context, document })

    expect(persistSpy.mock.calls[0]?.[4]).toMatchObject({
      expectedUpdatedAt: CONTENT_V0,
      expectedCollaborationGeneration: 1,
      requireExpectedVersion: true,
    })
    expect(persistSpy.mock.calls[1]?.[4]).toMatchObject({
      expectedUpdatedAt: CONTENT_V1,
      expectedCollaborationGeneration: 1,
      requireExpectedVersion: true,
    })
  })

  it('invalidates an authenticated editor room when access is revoked before store', async () => {
    let authorized = true
    const authorizeContext = jest.fn(async () => authorized)
    const invalidateRoom = jest.fn()
    const { hooks, persistSpy } = makeHooks({ authorizeContext, invalidateRoom })
    const connection = { readOnly: false }
    const context = await hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection,
    })
    const document = new Y.Doc()
    await hooks.onLoadDocument({ documentName: DOC, context, document })

    authorized = false
    await expect(hooks.onStoreDocument({ documentName: DOC, context, document }))
      .resolves.toBeUndefined()

    expect(authorizeContext).toHaveBeenCalledTimes(3)
    expect(persistSpy).not.toHaveBeenCalled()
    expect(invalidateRoom).toHaveBeenCalledTimes(1)
    expect(invalidateRoom).toHaveBeenCalledWith(DOC, document)
  })

  it('rejects authentication while the exact mapped room has a pending final drain', async () => {
    const markedRoom = new Y.Doc()
    const replacementRoom = new Y.Doc()
    let mappedRoom: Y.Doc | undefined = markedRoom
    const finalDrainRegistry = createCollabFinalDrainRegistry(() => 1)
    const authorizeContext = jest.fn(async () => true)
    const { hooks } = makeHooks({
      authorizeContext,
      finalDrainRegistry,
      resolveRoomDocument: () => mappedRoom,
    })
    expect(finalDrainRegistry.mark(markedRoom, Promise.resolve())).toBe(true)

    await expect(hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })).rejects.toThrow('room is draining accepted edits')
    expect(authorizeContext).not.toHaveBeenCalled()

    // A stale mark on an old, unmapped identity must not block a replacement
    // room that loaded authoritative content under the same document name.
    mappedRoom = replacementRoom
    await expect(hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })).resolves.toMatchObject({ documentId: DOC, readOnly: false })
  })

  it('drains every pre-close queue before snapshotting a store already waiting on authorization', async () => {
    let liveConnections = 2
    let socketConnections: unknown[] = []
    const document = new Y.Doc() as Y.Doc & {
      getConnections: () => unknown[]
      getConnectionsCount: () => number
    }
    document.getConnections = () => socketConnections
    document.getConnectionsCount = () => liveConnections
    const finalDrainRegistry = createCollabFinalDrainRegistry()
    let releaseAuthorization: (() => void) | undefined
    let signalAuthorizationStarted: (() => void) | undefined
    const authorizationStarted = new Promise<void>((resolve) => {
      signalAuthorizationStarted = resolve
    })
    const authorizationHeld = new Promise<void>((resolve) => {
      releaseAuthorization = resolve
    })
    let authorizationChecks = 0
    let allowLaterAuthorization = false
    const authorizeContext = jest.fn(async () => {
      authorizationChecks += 1
      if (authorizationChecks === 1) {
        signalAuthorizationStarted?.()
        await authorizationHeld
        return false
      }
      return allowLaterAuthorization
    })
    const invalidateRoom = jest.fn()
    let durableState: Buffer | null = null
    let releasePersistence!: () => void
    let signalPersistenceStarted!: () => void
    const persistenceStarted = new Promise<void>((resolve) => {
      signalPersistenceStarted = resolve
    })
    const persistenceHeld = new Promise<void>((resolve) => { releasePersistence = resolve })
    const persistContent: CollabHooksDeps['persistContent'] = jest.fn(async (
      _em,
      _documentId,
      _scope,
      input,
    ) => {
      signalPersistenceStarted()
      await persistenceHeld
      durableState = Buffer.from(input.yjsState)
      return { updatedAt: CONTENT_V1, collaborationGeneration: 1 }
    })
    const { hooks } = makeHooks({
      authorizeContext,
      invalidateRoom,
      persistContent,
      finalDrainRegistry,
      resolveRoomDocument: () => document,
    })
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    await hooks.onLoadDocument({ documentName: DOC, context, document })

    let resolveFirstQueue!: () => void
    let resolveSecondQueue!: () => void
    const firstQueue = new Promise<void>((resolve) => { resolveFirstQueue = resolve })
    const secondQueue = new Promise<void>((resolve) => { resolveSecondQueue = resolve })
    const firstWait = jest.fn(() => firstQueue)
    const secondWait = jest.fn(() => secondQueue)
    socketConnections = [
      { waitForPendingMessages: firstWait },
      { waitForPendingMessages: secondWait },
    ]

    // The store starts first and is held inside its live authorization check.
    // Neither queued frame has reached the Y.Doc at its start time.
    const storing = hooks.onStoreDocument({
      documentName: DOC,
      context,
      document,
    })
    await authorizationStarted

    // The trusted callback captures both exact queue promises synchronously,
    // then closeConnections removes those logical connections.
    expect(markCollabFinalDrainForReauth(document, finalDrainRegistry)).toBe(true)
    expect(firstWait).toHaveBeenCalledTimes(1)
    expect(secondWait).toHaveBeenCalledTimes(1)
    socketConnections = []
    liveConnections = 0

    await expect(hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })).rejects.toThrow('room is draining accepted edits')
    expect(finalDrainRegistry.isMarked(document)).toBe(true)

    releaseAuthorization?.()
    await Promise.resolve()
    await Promise.resolve()

    // A duplicate debounced store sees the claimed drain as busy. It neither
    // authorizes nor invalidates the room owned by the first invocation.
    const duplicateStore = hooks.onStoreDocument({ documentName: DOC, context, document })
    await expect(duplicateStore).resolves.toBeUndefined()
    expect(invalidateRoom).not.toHaveBeenCalled()

    const firstQueuedEdit = new Y.Doc()
    firstQueuedEdit.getText('queued-before-close').insert(0, 'A')
    Y.applyUpdate(document, Y.encodeStateAsUpdate(firstQueuedEdit))
    resolveFirstQueue()
    await Promise.resolve()
    expect(persistContent).not.toHaveBeenCalled()
    expect(finalDrainRegistry.isMarked(document)).toBe(true)

    await expect(hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })).rejects.toThrow('room is draining accepted edits')

    const secondQueuedEdit = new Y.Doc()
    secondQueuedEdit.getText('queued-before-close').insert(0, 'B')
    Y.applyUpdate(document, Y.encodeStateAsUpdate(secondQueuedEdit))
    resolveSecondQueue()
    await persistenceStarted

    // Even a reconnect that would now pass live authorization stays out until
    // the owner has completed the durable write.
    allowLaterAuthorization = true
    await expect(hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })).rejects.toThrow('room is draining accepted edits')
    expect(finalDrainRegistry.isMarked(document)).toBe(true)
    expect(authorizationChecks).toBe(1)

    releasePersistence()
    await storing

    expect(persistContent).toHaveBeenCalledTimes(1)
    expect(finalDrainRegistry.isMarked(document)).toBe(true)
    expect(invalidateRoom).not.toHaveBeenCalled()

    const durable = new Y.Doc()
    expect(durableState).not.toBeNull()
    Y.applyUpdate(durable, new Uint8Array(durableState!))
    expect(new Set(durable.getText('queued-before-close').toString())).toEqual(new Set(['A', 'B']))
    expect(durable.getText('queued-before-close')).toHaveLength(2)

    // The sealed old identity makes every later store inert until Hocuspocus
    // unmaps it, without replacing the state already written above.
    allowLaterAuthorization = false
    await hooks.onStoreDocument({ documentName: DOC, context, document })
    expect(persistContent).toHaveBeenCalledTimes(1)
    expect(invalidateRoom).not.toHaveBeenCalled()
    expect(authorizationChecks).toBe(1)
    const stillDurable = new Y.Doc()
    Y.applyUpdate(stillDurable, new Uint8Array(durableState!))
    expect(new Set(stillDurable.getText('queued-before-close').toString())).toEqual(new Set(['A', 'B']))
  })

  it('drains pre-revocation edits once for an explicitly marked disconnected room', async () => {
    const document = new Y.Doc()
    let liveConnections = 1
    const finalDrainRegistry = createCollabFinalDrainRegistry(() => liveConnections)
    const authorizeContext = jest.fn(async () => false)
    const invalidateRoom = jest.fn()
    const { hooks, persistSpy } = makeHooks({
      authorizeContext,
      invalidateRoom,
      finalDrainRegistry,
    })
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    await hooks.onLoadDocument({ documentName: DOC, context, document })
    document.getText('pre-revocation').insert(0, 'accepted before close')
    expect(finalDrainRegistry.mark(document, Promise.resolve())).toBe(true)
    liveConnections = 0

    await hooks.onStoreDocument({ documentName: DOC, context, document })

    expect(authorizeContext).toHaveBeenCalledTimes(1)
    expect(persistSpy).toHaveBeenCalledTimes(1)
    const persisted = new Y.Doc()
    Y.applyUpdate(persisted, new Uint8Array(persistSpy.mock.calls[0]![3].yjsState))
    expect(persisted.getText('pre-revocation').toString()).toBe('accepted before close')
    expect(invalidateRoom).not.toHaveBeenCalled()

    // The completed marker seals the old room until Hocuspocus unmaps it.
    await hooks.onStoreDocument({ documentName: DOC, context, document })
    expect(authorizeContext).toHaveBeenCalledTimes(1)
    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(finalDrainRegistry.isMarked(document)).toBe(true)
    expect(invalidateRoom).not.toHaveBeenCalled()
  })

  it('invalidates rather than draining a marked room that still has a live connection', async () => {
    const document = new Y.Doc()
    let liveConnections = 1
    const finalDrainRegistry = createCollabFinalDrainRegistry(() => liveConnections)
    const invalidateRoom = jest.fn()
    const { hooks, persistSpy } = makeHooks({
      authorizeContext: async () => false,
      invalidateRoom,
      finalDrainRegistry,
    })
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    await hooks.onLoadDocument({ documentName: DOC, context, document })
    finalDrainRegistry.mark(document, Promise.resolve())

    await hooks.onStoreDocument({ documentName: DOC, context, document })

    expect(persistSpy).not.toHaveBeenCalled()
    expect(invalidateRoom).toHaveBeenCalledWith(DOC, document)
    liveConnections = 0
    await expect(finalDrainRegistry.consume(document)).resolves.toBe('unmarked')
  })

  it('fails closed and invalidates the room when store authorization throws', async () => {
    const authorizationFailure = new Error('authorization unavailable')
    mockLoggerError.mockClear()
    const authorizeContext = jest.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(authorizationFailure)
    const invalidateRoom = jest.fn()
    let liveConnections = 1
    const finalDrainRegistry = createCollabFinalDrainRegistry(() => liveConnections)
    const { hooks, persistSpy } = makeHooks({
      authorizeContext,
      invalidateRoom,
      finalDrainRegistry,
    })
    const context = await hooks.onAuthenticate({
      token: token('editor'),
      documentName: DOC,
      connection: { readOnly: false },
    })
    const document = new Y.Doc()
    await hooks.onLoadDocument({ documentName: DOC, context, document })
    expect(finalDrainRegistry.mark(document, Promise.resolve())).toBe(true)
    liveConnections = 0

    await expect(hooks.onStoreDocument({ documentName: DOC, context, document }))
      .resolves.toBeUndefined()

    expect(persistSpy).not.toHaveBeenCalled()
    expect(invalidateRoom).toHaveBeenCalledTimes(1)
    expect(invalidateRoom).toHaveBeenCalledWith(DOC, document)
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('store authorization failed; retiring in-memory room'),
    )
    await expect(finalDrainRegistry.consume(document)).resolves.toBe('unmarked')
  })

  it('discards a granted drain and invalidates the room when its durable write fails', async () => {
    const document = new Y.Doc()
    let liveConnections = 1
    const finalDrainRegistry = createCollabFinalDrainRegistry(() => liveConnections)
    const persistenceFailure = new Error('durable store unavailable')
    mockLoggerError.mockClear()
    const invalidateRoom = jest.fn()
    const { hooks } = makeHooks({
      authorizeContext: async () => false,
      finalDrainRegistry,
      invalidateRoom,
      persistContent: async () => { throw persistenceFailure },
    })
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    await hooks.onLoadDocument({ documentName: DOC, context, document })
    document.getText('failed-final-drain').insert(0, 'accepted before close')
    expect(finalDrainRegistry.mark(document, Promise.resolve())).toBe(true)
    liveConnections = 0

    await expect(hooks.onStoreDocument({ documentName: DOC, context, document }))
      .resolves.toBeUndefined()

    expect(finalDrainRegistry.isMarked(document)).toBe(false)
    expect(invalidateRoom).toHaveBeenCalledTimes(1)
    expect(invalidateRoom).toHaveBeenCalledWith(DOC, document)
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('final drain failed; retiring in-memory room'),
    )
    await expect(finalDrainRegistry.consume(document)).resolves.toBe('unmarked')
  })

  it('rechecks authorization before a multi-replica CAS retry', async () => {
    let authorizationChecks = 0
    const authorizeContext = jest.fn(async () => {
      authorizationChecks += 1
      return authorizationChecks === 1
    })
    const invalidateRoom = jest.fn()
    const loadContent = jest.fn()
      .mockResolvedValueOnce({
        yjsState: null,
        contentHtml: null,
        updatedAt: CONTENT_V0,
        collaborationGeneration: 1,
      })
      .mockResolvedValueOnce({
        yjsState: Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())),
        contentHtml: null,
        updatedAt: CONTENT_V1,
        collaborationGeneration: 1,
      })
    const persistContent: CollabHooksDeps['persistContent'] = jest.fn(async () => {
      throw new CrudHttpError(409, {
        error: 'Record changed by another user',
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      })
    })
    const { hooks } = makeHooks({
      authorizeContext,
      invalidateRoom,
      loadContent,
      persistContent,
    })
    const document = new Y.Doc()
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    await hooks.onLoadDocument({ documentName: DOC, context, document })

    await expect(hooks.onStoreDocument({ documentName: DOC, context, document }))
      .resolves.toBeUndefined()

    expect(authorizeContext).toHaveBeenCalledTimes(2)
    expect(persistContent).toHaveBeenCalledTimes(1)
    expect(loadContent).toHaveBeenCalledTimes(2)
    expect(invalidateRoom).toHaveBeenCalledTimes(1)
    expect(invalidateRoom).toHaveBeenCalledWith(DOC, document)
  })

  it('retires an oversized aggregate store instead of retaining it for another writer', async () => {
    const invalidateRoom = jest.fn()
    const { hooks, persistSpy } = makeHooks({ invalidateRoom })
    const document = new Y.Doc()
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    await hooks.onLoadDocument({ documentName: DOC, context, document })
    document.getText('aggregate').insert(0, 'x'.repeat(DOCUMENTS_MAX_YJS_STATE_BYTES + 1))

    await expect(hooks.onStoreDocument({ documentName: DOC, context, document }))
      .resolves.toBeUndefined()

    expect(persistSpy).not.toHaveBeenCalled()
    expect(invalidateRoom).toHaveBeenCalledWith(DOC, document)
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('exceeded content limits'),
      { room: DOC },
    )
    document.destroy()
  })

  it('carries one consumed final-drain grant through a bounded CAS retry', async () => {
    const document = new Y.Doc()
    const authoritativeDocument = new Y.Doc()
    authoritativeDocument.getText('final-drain-retry').insert(0, 'B')
    let liveConnections = 1
    const finalDrainRegistry = createCollabFinalDrainRegistry(() => liveConnections)
    const authorizeContext = jest.fn(async () => false)
    const invalidateRoom = jest.fn()
    const loadContent = jest.fn()
      .mockResolvedValueOnce({
        yjsState: null,
        contentHtml: null,
        updatedAt: CONTENT_V0,
        collaborationGeneration: 1,
      })
      .mockResolvedValueOnce({
        yjsState: Buffer.from(Y.encodeStateAsUpdate(authoritativeDocument)),
        contentHtml: null,
        updatedAt: CONTENT_V1,
        collaborationGeneration: 1,
      })
    const persistContent: CollabHooksDeps['persistContent'] = jest.fn()
      .mockRejectedValueOnce(new CrudHttpError(409, {
        error: 'Record changed by another user',
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      }))
      .mockResolvedValueOnce({
        updatedAt: '2026-07-10T10:00:02.000Z',
        collaborationGeneration: 1,
      })
    const { hooks } = makeHooks({
      authorizeContext,
      invalidateRoom,
      finalDrainRegistry,
      loadContent,
      persistContent,
    })
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    await hooks.onLoadDocument({ documentName: DOC, context, document })
    document.getText('final-drain-retry').insert(0, 'A')
    expect(finalDrainRegistry.mark(document, Promise.resolve())).toBe(true)
    liveConnections = 0

    await hooks.onStoreDocument({ documentName: DOC, context, document })

    expect(authorizeContext).toHaveBeenCalledTimes(1)
    expect(persistContent).toHaveBeenCalledTimes(2)
    expect(loadContent).toHaveBeenCalledTimes(2)
    expect(invalidateRoom).not.toHaveBeenCalled()
    const retriedState = (persistContent as jest.Mock).mock.calls[1]?.[3]?.yjsState as Buffer
    const durable = new Y.Doc()
    Y.applyUpdate(durable, new Uint8Array(retriedState))
    expect(new Set(durable.getText('final-drain-retry').toString())).toEqual(new Set(['A', 'B']))
    expect(durable.getText('final-drain-retry')).toHaveLength(2)
  })

  it('discards an in-flight CAS failure when the exact room is invalidated', async () => {
    const document = new Y.Doc()
    let invalidated = false
    let rejectPersist: ((error: Error) => void) | null = null
    let markPersistStarted: (() => void) | null = null
    const persistStarted = new Promise<void>((resolve) => { markPersistStarted = resolve })
    const { hooks } = makeHooks({
      isRoomInvalidated: (_documentName, candidate) => candidate === document && invalidated,
      persistContent: async () => new Promise<{
        updatedAt: string | Date
        collaborationGeneration: number
      }>((_resolve, reject) => {
        rejectPersist = reject
        markPersistStarted?.()
      }),
    })
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }

    await hooks.onLoadDocument({ documentName: DOC, context, document })
    const storing = hooks.onStoreDocument({ documentName: DOC, context, document })
    await persistStarted
    invalidated = true
    rejectPersist?.(new Error('stale content version'))

    await expect(storing).resolves.toBeUndefined()
  })

  it('merges and durably retries concurrent edits accepted by two sidecar replicas', async () => {
    let canonicalVersion = CONTENT_V0
    const canonicalCollaborationGeneration = 1
    let canonicalState = Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()))
    let versionCounter = 0
    const loadContent: CollabHooksDeps['loadContent'] = async () => ({
      yjsState: canonicalState,
      contentHtml: null,
      updatedAt: canonicalVersion,
      collaborationGeneration: canonicalCollaborationGeneration,
    })
    const persistContent: CollabHooksDeps['persistContent'] = jest.fn(async (
      _em,
      _documentId,
      _scope,
      input,
      deps,
    ) => {
      if (deps.expectedUpdatedAt !== canonicalVersion) {
        throw new CrudHttpError(409, {
          error: 'Record changed by another user',
          code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        })
      }
      expect(deps.expectedCollaborationGeneration).toBe(canonicalCollaborationGeneration)
      canonicalState = Buffer.from(input.yjsState)
      versionCounter += 1
      canonicalVersion = `2026-07-10T10:00:0${versionCounter}.000Z`
      return {
        updatedAt: canonicalVersion,
        collaborationGeneration: canonicalCollaborationGeneration,
      }
    })
    const commonDeps: Partial<CollabHooksDeps> = { loadContent, persistContent }
    const first = makeHooks(commonDeps).hooks
    const second = makeHooks(commonDeps).hooks
    const firstDocument = new Y.Doc()
    const secondDocument = new Y.Doc()
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }

    await first.onLoadDocument({ documentName: DOC, context, document: firstDocument })
    await second.onLoadDocument({ documentName: DOC, context, document: secondDocument })
    firstDocument.getText('replica-test').insert(0, 'A')
    secondDocument.getText('replica-test').insert(0, 'B')

    await first.onStoreDocument({ documentName: DOC, context, document: firstDocument })
    await second.onStoreDocument({ documentName: DOC, context, document: secondDocument })

    const durable = new Y.Doc()
    Y.applyUpdate(durable, new Uint8Array(canonicalState))
    expect(new Set(durable.getText('replica-test').toString())).toEqual(new Set(['A', 'B']))
    expect(durable.getText('replica-test')).toHaveLength(2)
    expect(persistContent).toHaveBeenCalledTimes(3)
    expect((persistContent as jest.Mock).mock.calls[2]?.[4]).toMatchObject({
      expectedUpdatedAt: CONTENT_V1,
      expectedCollaborationGeneration: 1,
      requireExpectedVersion: true,
    })
  })

  it('does not let client-authored Yjs metadata change the server generation', async () => {
    const document = new Y.Doc()
    const { hooks, persistSpy } = makeHooks()
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }

    await hooks.onLoadDocument({ documentName: DOC, context, document })
    document.getMap('__client_metadata').set('collaborationGeneration', 999)
    await hooks.onStoreDocument({ documentName: DOC, context, document })

    expect(persistSpy).toHaveBeenCalledTimes(1)
    expect(persistSpy.mock.calls[0]?.[4]).toMatchObject({
      expectedCollaborationGeneration: 1,
    })
    expect(persistSpy.mock.calls[0]?.[3]).not.toHaveProperty('collaborationGeneration')
  })

  it('self-invalidates a stale room when its CAS loses before the reset event arrives', async () => {
    const document = new Y.Doc()
    const invalidateRoom = jest.fn()
    const replacement = materializeDocumentContentReplacement(null, '<p>Authoritative reset</p>')!
    const loadContent = jest.fn()
      .mockResolvedValueOnce({
        yjsState: null,
        contentHtml: null,
        updatedAt: CONTENT_V0,
        collaborationGeneration: 1,
      })
      .mockResolvedValue({
        yjsState: replacement.yjsState,
        contentHtml: replacement.html,
        updatedAt: CONTENT_V1,
        collaborationGeneration: 2,
      })
    const { hooks } = makeHooks({
      loadContent,
      invalidateRoom,
      persistContent: async () => {
        throw new CrudHttpError(409, {
          error: 'Record changed by another user',
          code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        })
      },
    })
    const context = {
      userId: USER,
      tenantId: TENANT,
      organizationId: ORGANIZATION,
      documentId: DOC,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }

    await hooks.onLoadDocument({ documentName: DOC, context, document })
    await expect(hooks.onStoreDocument({ documentName: DOC, context, document }))
      .resolves.toBeUndefined()
    expect(invalidateRoom).toHaveBeenCalledWith(DOC, document)
  })

  it('suppresses read-only stores and persists editor stores with scoped state', async () => {
    const { hooks, persistSpy } = makeHooks()
    const viewerDoc = new Y.Doc()
    const commenterDoc = new Y.Doc()

    await hooks.onStoreDocument({
      documentName: DOC,
      context: {
        userId: USER,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        documentId: DOC,
        tier: 'viewer',
        readOnly: true,
        exp: null,
      },
      document: viewerDoc,
    })
    await hooks.onStoreDocument({
      documentName: DOC,
      context: {
        userId: USER,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        documentId: DOC,
        tier: 'commenter',
        readOnly: true,
        exp: null,
      },
      document: commenterDoc,
    })

    expect(persistSpy).not.toHaveBeenCalled()

    const editorDoc = new Y.Doc()
    await hooks.onLoadDocument({
      documentName: DOC,
      context: {
        userId: USER,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        documentId: DOC,
        tier: 'editor',
        readOnly: false,
        exp: null,
      },
      document: editorDoc,
    })
    await hooks.onStoreDocument({
      documentName: DOC,
      context: {
        userId: USER,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        documentId: DOC,
        tier: 'editor',
        readOnly: false,
        exp: null,
      },
      document: editorDoc,
    })

    expect(persistSpy).toHaveBeenCalledTimes(1)
    const call = persistSpy.mock.calls[0]
    if (!call) throw new Error('[internal] missing persist call')
    expect(call[1]).toBe(DOC)
    expect(call[2]).toEqual({ tenantId: TENANT, organizationId: ORGANIZATION })
    expect(Buffer.isBuffer(call[3].yjsState)).toBe(true)
  })
})
