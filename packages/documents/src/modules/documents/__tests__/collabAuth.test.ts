import * as Y from 'yjs'
import {
  createCollabHooks,
  type CollabHooksDeps,
} from '../../../../server/documents-collab-server'
import {
  mintCollabToken,
  verifyCollabToken,
  type CollabTokenClaims,
} from '../lib/collabToken'

const DOC = '11111111-1111-4111-8111-111111111111'
const OTHER_DOC = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const TENANT = '44444444-4444-4444-8444-444444444444'
const OTHER_TENANT = '55555555-5555-4555-8555-555555555555'
const ORGANIZATION = '66666666-6666-4666-8666-666666666666'

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
  loadSpy.mockResolvedValue(null)
  persistSpy.mockResolvedValue(undefined)

  const hooks = createCollabHooks({
    verifyToken: (candidate) => verifyCollabToken(candidate),
    resolveContainer: async () => ({
      resolve: (name: string) => (
        name === 'em'
          ? {}
          : { indexRecordById: async () => undefined }
      ),
    }),
    loadContent: loadSpy,
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
      tier: 'editor',
    })
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

  it('loads content with the authenticated context scope', async () => {
    const { hooks, loadSpy } = makeHooks()
    const document = new Y.Doc()

    const loaded = await hooks.onLoadDocument({
      documentName: DOC,
      context: {
        userId: USER,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        tier: 'editor',
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

  it('suppresses stores while a room is closing (restore/delete protection)', async () => {
    const { hooks, persistSpy } = makeHooks({ isRoomClosing: () => true })

    await hooks.onStoreDocument({
      documentName: DOC,
      context: {
        userId: USER,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        tier: 'editor',
      },
      document: new Y.Doc(),
    })

    expect(persistSpy).not.toHaveBeenCalled()
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
        tier: 'viewer',
      },
      document: viewerDoc,
    })
    await hooks.onStoreDocument({
      documentName: DOC,
      context: {
        userId: USER,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        tier: 'commenter',
      },
      document: commenterDoc,
    })

    expect(persistSpy).not.toHaveBeenCalled()

    const editorDoc = new Y.Doc()
    await hooks.onStoreDocument({
      documentName: DOC,
      context: {
        userId: USER,
        tenantId: TENANT,
        organizationId: ORGANIZATION,
        tier: 'editor',
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
