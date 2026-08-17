const mockLoggerError = jest.fn()
const mockLoggerWarn = jest.fn()

import { EventEmitter } from 'node:events'

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

import {
  assertDocumentsCollabRedisAggregateUpdate,
  assertCollabInboundFramePolicy,
  closeCollabRoomConnectionsForContentReset,
  COLLAB_SERVER_RUNTIME_CONFIGURATION,
  COLLAB_SERVER_TRANSPORT_OPTIONS,
  COLLAB_SERVER_WEBSOCKET_CONFIGURATION,
  COLLAB_SERVER_UNAUTHENTICATED_CONFIGURATION,
  createCollabFinalDrainRegistry,
  createCollabHooks,
  DocumentsCollabRedisExtension,
  DOCUMENTS_COLLAB_AUTHORIZATION_TICKET_TIMEOUT_MS,
  DOCUMENTS_COLLAB_MAX_AWARENESS_FRAME_BYTES,
  DOCUMENTS_COLLAB_MAX_CONTROL_FRAME_BYTES,
  DOCUMENTS_COLLAB_MAX_PENDING_BYTES,
  DOCUMENTS_COLLAB_MAX_PENDING_MESSAGES,
  DOCUMENTS_COLLAB_MAX_READ_ONLY_SYNC_FRAME_BYTES,
  DOCUMENTS_COLLAB_REDIS_FANOUT_MAX_PENDING_ROOMS,
  DOCUMENTS_COLLAB_REDIS_SUBSCRIBE_TIMEOUT_MS,
  enforceDocumentsCollabSourceStoreOwnership,
  handleCollabHealthRequest,
  handleCollabServerRequest,
  installBoundedCollabIngress,
  installHocuspocusCollabIngressGuard,
  isCollabAuthorizationCurrent,
  isCollabRequestOriginAllowed,
  isDocumentsCollabSourceStore,
  isOwnDocumentsCrossProcessEvent,
  isTrustedDocumentsCollabRoomScope,
  markCollabFinalDrainForReauth,
  resolveCollabAllowedOrigins,
  resolveCollabRoomEventAction,
  resolveTrustedDocumentsCrossProcessEvent,
  resolveDocumentsCollabRedisConfiguration,
  resolveDocumentsCollabRedisExtensions,
  scheduleCollabConnectionExpiry,
  type CollabHealthResponse,
  type DocumentsCollabRedisConfiguration,
} from '../../../../server/documents-collab-server'
import {
  Hocuspocus,
  IncomingMessage,
  MessageType,
  Server,
  type onLoadDocumentPayload,
  type onStoreDocumentPayload,
} from '@hocuspocus/server'
import * as Y from 'yjs'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  mintCollabTokenV2,
  verifyCollabToken,
  verifyCollabTokenV2,
} from '../lib/collabToken'
import {
  DOCUMENTS_COLLAB_MAX_PAYLOAD_BYTES,
  DOCUMENTS_MAX_YJS_STATE_BYTES,
} from '../lib/resourceLimits'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'

function createRedisFanoutTestExtension(
  publish: jest.Mock<Promise<unknown>, [string, Buffer]>,
): {
  extension: DocumentsCollabRedisExtension
  disconnectFanout: jest.Mock
} {
  const extension = Object.create(
    DocumentsCollabRedisExtension.prototype,
  ) as DocumentsCollabRedisExtension
  const disconnectFanout = jest.fn()
  Object.assign(extension, {
    persistedStates: new WeakMap(),
    knownDocuments: new Map(),
    fanoutPublisher: { publish, disconnect: disconnectFanout },
    pendingFanouts: new Map(),
    activeFanouts: new Set(),
    fanoutRetryAttempts: new Map(),
    fanoutRetryTimers: new Map(),
    pendingLocalAfterStoreDelays: new Map(),
    invalidatedFanoutDocuments: new WeakSet(),
    bufferedFanouts: new WeakMap(),
    bufferedFanoutBytes: new WeakMap(),
    nextFanoutRevision: 0,
    pendingFanoutBytes: 0,
    fanoutDestroyed: false,
    locks: new Map(),
    configuration: {
      prefix: 'open-mercato:documents:collab:test',
      identifier: 'fanout-test',
    },
    messagePrefix: Buffer.concat([
      Buffer.from(['fanout-test'.length]),
      Buffer.from('fanout-test'),
    ]),
  })
  return { extension, disconnectFanout }
}

function createRedisStorePayload(document: Y.Doc): onStoreDocumentPayload {
  return {
    document,
    documentName: DOCUMENT_ID,
    instance: {},
    clientsCount: 1,
    lastContext: {},
    lastTransactionOrigin: { source: 'connection', connection: {} },
  } as unknown as onStoreDocumentPayload
}

function decodePersistedFanout(messageBuffer: Buffer): Y.Doc {
  const identifierLength = messageBuffer[0]
  if (identifierLength === undefined) throw new Error('missing Redis identifier prefix')
  const fanoutOffset = identifierLength + 1
  expect(messageBuffer.subarray(fanoutOffset, fanoutOffset + 5).toString('ascii')).toBe('OMDF1')
  expect(messageBuffer.readBigUInt64BE(fanoutOffset + 5)).toBe(1n)
  const message = new IncomingMessage(messageBuffer.subarray(fanoutOffset + 13))
  expect(message.readVarString()).toBe(DOCUMENT_ID)
  expect(message.readVarUint()).toBe(MessageType.Sync)
  expect(message.readVarUint()).toBe(2)
  const document = new Y.Doc()
  Y.applyUpdate(document, message.readVarUint8Array())
  return document
}

describe('documents collaboration Redis configuration', () => {
  it('uses a dedicated bounded publisher for post-store fanout', async () => {
    const fanoutPublisher = {
      publish: jest.fn(async () => 1),
      disconnect: jest.fn(),
    }
    const pub = Object.assign(new EventEmitter(), {
      duplicate: jest.fn(() => fanoutPublisher),
      disconnect: jest.fn(),
      publish: jest.fn(async () => 1),
      quit: jest.fn(() => new Promise<never>(() => undefined)),
    })
    const sub = Object.assign(new EventEmitter(), {
      disconnect: jest.fn(),
      publish: jest.fn(async () => 1),
      quit: jest.fn(async () => undefined),
    })
    let clientIndex = 0
    const extension = new DocumentsCollabRedisExtension({
      host: '127.0.0.1',
      port: 6379,
      prefix: 'open-mercato:documents:collab:test',
      options: { maxRetriesPerRequest: null },
      createClient: () => clientIndex++ === 0 ? pub : sub,
    } as DocumentsCollabRedisConfiguration & { createClient: () => unknown })

    expect(pub.duplicate).toHaveBeenCalledWith({
      autoResendUnfulfilledCommands: false,
      commandTimeout: 1_000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    })

    await extension.onDestroy()
    expect(fanoutPublisher.disconnect).toHaveBeenCalledWith(false)
    expect(pub.disconnect).toHaveBeenCalledWith(false)
    expect(sub.disconnect).toHaveBeenCalledWith(false)
    expect(pub.quit).not.toHaveBeenCalled()
  })

  it('releases the store lock without waiting for durable Redis fanout', async () => {
    let resolvePublish = (): void => undefined
    const publishPending = new Promise<unknown>((resolve) => {
      resolvePublish = () => resolve(1)
    })
    const publish = jest.fn<Promise<unknown>, [string, Buffer]>(() => publishPending)
    const { extension } = createRedisFanoutTestExtension(publish)
    const document = new Y.Doc()
    document.getMap('fanout').set('version', 1)
    extension.markPersisted(document, Y.encodeStateAsUpdate(document), 1)
    const release = jest.fn(async () => ({}))
    const lockKey = 'open-mercato:documents:collab:test:11111111-1111-4111-8111-111111111111:lock'
    ;(extension as unknown as {
      locks: Map<string, { lock: { release: () => Promise<unknown> } }>
    }).locks.set(lockKey, { lock: { release } })

    await expect(extension.afterStoreDocument(createRedisStorePayload(document)))
      .resolves.toBeUndefined()

    expect(release).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(release.mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[0])
    expect((extension as unknown as { locks: Map<string, unknown> }).locks.has(lockKey)).toBe(false)
    resolvePublish()
    await publishPending
    document.destroy()
  })

  it('does not retain the store mutex when Redis lock release never settles', async () => {
    jest.useFakeTimers()
    const publish = jest.fn<Promise<unknown>, [string, Buffer]>().mockResolvedValue(1)
    const { extension } = createRedisFanoutTestExtension(publish)
    const document = new Y.Doc()
    document.getMap('fanout').set('version', 1)
    extension.markPersisted(document, Y.encodeStateAsUpdate(document), 1)
    const release = jest.fn(() => new Promise<never>(() => undefined))
    const lockKey = 'open-mercato:documents:collab:test:11111111-1111-4111-8111-111111111111:lock'
    ;(extension as unknown as {
      locks: Map<string, { lock: { release: () => Promise<unknown> } }>
    }).locks.set(lockKey, { lock: { release } })

    try {
      const storing = extension.afterStoreDocument(createRedisStorePayload(document))
      await Promise.resolve()
      expect(release).toHaveBeenCalledTimes(1)
      expect(publish).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(1_250)
      await expect(storing).resolves.toBeUndefined()

      expect((extension as unknown as { locks: Map<string, unknown> }).locks.has(lockKey)).toBe(false)
      expect(publish).toHaveBeenCalledTimes(1)
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('store lock release timed out'),
        { room: DOCUMENT_ID },
      )
    } finally {
      jest.useRealTimers()
      document.destroy()
    }
  })

  it('does not let a late timed-out release delete a replacement store lock', async () => {
    jest.useFakeTimers()
    const publish = jest.fn<Promise<unknown>, [string, Buffer]>().mockResolvedValue(1)
    const { extension } = createRedisFanoutTestExtension(publish)
    const document = new Y.Doc()
    document.getMap('fanout').set('version', 1)
    extension.markPersisted(document, Y.encodeStateAsUpdate(document), 1)
    let resolveFirstRelease = (): void => undefined
    const firstReleasePending = new Promise<unknown>((resolve) => {
      resolveFirstRelease = () => resolve({})
    })
    const firstRelease = jest.fn(() => firstReleasePending)
    const replacementRelease = jest.fn(async () => ({}))
    const lockKey = 'open-mercato:documents:collab:test:11111111-1111-4111-8111-111111111111:lock'
    const locks = (extension as unknown as {
      locks: Map<string, { lock: { release: () => Promise<unknown> } }>
    }).locks
    locks.set(lockKey, { lock: { release: firstRelease } })

    try {
      const firstStore = extension.afterStoreDocument(createRedisStorePayload(document))
      await Promise.resolve()
      await jest.advanceTimersByTimeAsync(1_250)
      await firstStore

      const replacement = { lock: { release: replacementRelease } }
      locks.set(lockKey, replacement)
      resolveFirstRelease()
      await firstReleasePending
      await Promise.resolve()

      expect(locks.get(lockKey)).toBe(replacement)

      document.getMap('fanout').set('version', 2)
      extension.markPersisted(document, Y.encodeStateAsUpdate(document), 1)
      await extension.afterStoreDocument(createRedisStorePayload(document))
      expect(replacementRelease).toHaveBeenCalledTimes(1)
      expect(locks.has(lockKey)).toBe(false)
    } finally {
      jest.useRealTimers()
      document.destroy()
    }
  })

  it('does not enqueue a durable snapshot invalidated while its store lock is releasing', async () => {
    const publish = jest.fn<Promise<unknown>, [string, Buffer]>().mockResolvedValue(1)
    const { extension } = createRedisFanoutTestExtension(publish)
    const document = new Y.Doc()
    document.getMap('fanout').set('version', 1)
    extension.markPersisted(document, Y.encodeStateAsUpdate(document), 1)
    let releaseStoreLock = (): void => undefined
    const lockReleasePending = new Promise<unknown>((resolve) => {
      releaseStoreLock = () => resolve({})
    })
    const release = jest.fn(() => lockReleasePending)
    const lockKey = 'open-mercato:documents:collab:test:11111111-1111-4111-8111-111111111111:lock'
    ;(extension as unknown as {
      locks: Map<string, { lock: { release: () => Promise<unknown> } }>
    }).locks.set(lockKey, { lock: { release } })

    const storing = extension.afterStoreDocument(createRedisStorePayload(document))
    await Promise.resolve()
    expect(release).toHaveBeenCalledTimes(1)
    extension.discardPendingFanout(DOCUMENT_ID, document)
    releaseStoreLock()
    await storing

    expect(publish).not.toHaveBeenCalled()
    document.destroy()
  })

  it('rejects an in-flight durable fanout from an invalidated collaboration generation', () => {
    const publish = jest.fn<Promise<unknown>, [string, Buffer]>().mockResolvedValue(1)
    const { extension } = createRedisFanoutTestExtension(publish)
    Object.assign(extension, {
      resolveCollaborationGeneration: () => 2,
    })
    const stale = new Y.Doc()
    stale.getMap('fanout').set('stale', true)
    const replacement = new Y.Doc()
    replacement.getMap('fanout').set('current', true)

    ;(extension as unknown as {
      applyDurableFanout: (
        sender: string,
        documentName: string,
        document: Y.Doc,
        collaborationGeneration: number,
        update: Uint8Array,
      ) => void
    }).applyDurableFanout(
      'stale-replica',
      DOCUMENT_ID,
      replacement,
      1,
      Y.encodeStateAsUpdate(stale),
    )

    expect(replacement.getMap('fanout').toJSON()).toEqual({ current: true })
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('another generation'),
      expect.objectContaining({
        room: DOCUMENT_ID,
        expectedGeneration: 2,
        receivedGeneration: 1,
      }),
    )
    stale.destroy()
    replacement.destroy()
  })

  it('does not let a late old-room invalidation discard a replacement fanout', () => {
    const publish = jest.fn<Promise<unknown>, [string, Buffer]>().mockResolvedValue(1)
    const { extension } = createRedisFanoutTestExtension(publish)
    const oldDocument = new Y.Doc()
    const replacement = new Y.Doc()
    const pendingFanouts = (extension as unknown as {
      pendingFanouts: Map<string, {
        document: Y.Doc
        collaborationGeneration: number
        revision: number
        message: Uint8Array
      }>
    }).pendingFanouts
    pendingFanouts.set(DOCUMENT_ID, {
      document: replacement,
      collaborationGeneration: 2,
      revision: 2,
      message: new Uint8Array([1]),
    })

    extension.discardPendingFanout(DOCUMENT_ID, oldDocument)
    expect(pendingFanouts.get(DOCUMENT_ID)?.document).toBe(replacement)

    extension.discardPendingFanout(DOCUMENT_ID)
    expect(pendingFanouts.has(DOCUMENT_ID)).toBe(false)
    oldDocument.destroy()
    replacement.destroy()
  })

  it('retries a rejected durable fanout with the latest coalesced state', async () => {
    jest.useFakeTimers()
    const publish = jest.fn<Promise<unknown>, [string, Buffer]>()
      .mockRejectedValueOnce(new Error('Redis publish unavailable'))
      .mockResolvedValue(1)
    const { extension } = createRedisFanoutTestExtension(publish)
    const document = new Y.Doc()

    try {
      document.getMap('fanout').set('version', 1)
      extension.markPersisted(document, Y.encodeStateAsUpdate(document), 1)
      await extension.afterStoreDocument(createRedisStorePayload(document))
      await Promise.resolve()
      expect(publish).toHaveBeenCalledTimes(1)

      document.getMap('fanout').set('version', 2)
      extension.markPersisted(document, Y.encodeStateAsUpdate(document), 1)
      await extension.afterStoreDocument(createRedisStorePayload(document))
      expect(publish).toHaveBeenCalledTimes(1)

      await jest.runOnlyPendingTimersAsync()
      expect(publish).toHaveBeenCalledTimes(2)
      const retried = decodePersistedFanout(publish.mock.calls[1][1])
      expect(retried.getMap('fanout').get('version')).toBe(2)
      retried.destroy()
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('durable Redis collaboration fanout failed'),
        expect.objectContaining({ room: DOCUMENT_ID, attempt: 1 }),
      )
    } finally {
      jest.useRealTimers()
      document.destroy()
    }
  })

  it('keeps the newest durable state queued while an older publish is in flight', async () => {
    let resolveFirstPublish = (): void => undefined
    const firstPublish = new Promise<unknown>((resolve) => {
      resolveFirstPublish = () => resolve(1)
    })
    const publish = jest.fn<Promise<unknown>, [string, Buffer]>()
      .mockImplementationOnce(() => firstPublish)
      .mockResolvedValue(1)
    const { extension } = createRedisFanoutTestExtension(publish)
    const document = new Y.Doc()

    document.getMap('fanout').set('version', 1)
    extension.markPersisted(document, Y.encodeStateAsUpdate(document), 1)
    await extension.afterStoreDocument(createRedisStorePayload(document))
    document.getMap('fanout').set('version', 2)
    extension.markPersisted(document, Y.encodeStateAsUpdate(document), 1)
    await extension.afterStoreDocument(createRedisStorePayload(document))
    expect(publish).toHaveBeenCalledTimes(1)

    resolveFirstPublish()
    await firstPublish
    for (let index = 0; index < 4; index += 1) await Promise.resolve()

    expect(publish).toHaveBeenCalledTimes(2)
    const latest = decodePersistedFanout(publish.mock.calls[1][1])
    expect(latest.getMap('fanout').get('version')).toBe(2)
    latest.destroy()
    document.destroy()
  })

  it('bounds the pending fanout backlog while Redis stays unavailable across many rooms', async () => {
    jest.useFakeTimers()
    const publish = jest.fn<Promise<unknown>, [string, Buffer]>()
      .mockRejectedValue(new Error('Redis publish unavailable'))
    const { extension } = createRedisFanoutTestExtension(publish)
    const pendingFanouts = (extension as unknown as {
      pendingFanouts: Map<string, { document: Y.Doc }>
    }).pendingFanouts
    const roomCount = DOCUMENTS_COLLAB_REDIS_FANOUT_MAX_PENDING_ROOMS + 16
    const rooms: Y.Doc[] = []

    try {
      for (let index = 0; index < roomCount; index += 1) {
        const document = new Y.Doc()
        rooms.push(document)
        document.getMap('fanout').set('room', index)
        extension.markPersisted(document, Y.encodeStateAsUpdate(document), 1)
        await extension.afterStoreDocument({
          ...createRedisStorePayload(document),
          documentName: `room-${index}`,
        } as onStoreDocumentPayload)
      }

      expect(pendingFanouts.size).toBe(DOCUMENTS_COLLAB_REDIS_FANOUT_MAX_PENDING_ROOMS)
      expect(pendingFanouts.has('room-0')).toBe(false)
      expect(pendingFanouts.has(`room-${roomCount - 1}`)).toBe(true)
      // The evicted rooms must release their Y.Doc, not just their frame.
      expect([...pendingFanouts.values()].some((pending) => pending.document === rooms[0]))
        .toBe(false)
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('bound the outage backlog'),
        expect.objectContaining({ room: 'room-0' }),
      )
    } finally {
      jest.useRealTimers()
      for (const document of rooms) document.destroy()
    }
  })

  it('drops a malformed Redis frame instead of rejecting into the process', async () => {
    const fanoutPublisher = { publish: jest.fn(async () => 1), disconnect: jest.fn() }
    const pub = Object.assign(new EventEmitter(), {
      duplicate: jest.fn(() => fanoutPublisher),
      disconnect: jest.fn(),
      publish: jest.fn(async () => 1),
      quit: jest.fn(async () => undefined),
    })
    const sub = Object.assign(new EventEmitter(), {
      disconnect: jest.fn(),
      publish: jest.fn(async () => 1),
      quit: jest.fn(async () => undefined),
    })
    let clientIndex = 0
    const extension = new DocumentsCollabRedisExtension({
      host: '127.0.0.1',
      port: 6379,
      prefix: 'open-mercato:documents:collab:test',
      options: { maxRetriesPerRequest: null },
      createClient: () => clientIndex++ === 0 ? pub : sub,
    } as DocumentsCollabRedisConfiguration & { createClient: () => unknown })

    // A truncated payload: the varint string header promises bytes that the
    // frame never carries, so decoding throws inside the async listener.
    const truncated = Buffer.concat([
      Buffer.from([4]),
      Buffer.from('peer'),
      Buffer.from([0xff]),
    ])

    expect(() => sub.emit('messageBuffer', Buffer.from('channel'), truncated)).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('malformed Redis collaboration frame'),
      expect.objectContaining({ error: expect.any(String) }),
    )

    await extension.onDestroy()
  })

  it('fails a room load when the Redis subscription never completes', async () => {
    jest.useFakeTimers()
    const document = new Y.Doc()
    const subscribe = jest.fn()
    const unsubscribe = jest.fn(async () => undefined)
    const extension = Object.create(
      DocumentsCollabRedisExtension.prototype,
    ) as DocumentsCollabRedisExtension
    Object.assign(extension, {
      knownDocuments: new Map(),
      sub: { subscribe, unsubscribe },
      configuration: {
        prefix: 'open-mercato:documents:collab:test',
        identifier: 'subscribe-test',
      },
    })

    try {
      const loading = extension.onLoadDocument({
        documentName: DOCUMENT_ID,
        document,
        instance: { loadingDocuments: new Map(), documents: new Map() },
      } as unknown as onLoadDocumentPayload)
      const rejection = expect(loading).rejects.toThrow('subscription timed out')

      await jest.advanceTimersByTimeAsync(DOCUMENTS_COLLAB_REDIS_SUBSCRIBE_TIMEOUT_MS)
      await rejection

      expect(subscribe).toHaveBeenCalledTimes(1)
      expect((extension as unknown as {
        knownDocuments: Map<string, Y.Doc>
      }).knownDocuments.has(DOCUMENT_ID)).toBe(false)
    } finally {
      jest.useRealTimers()
      document.destroy()
    }
  })

  it('keeps the Redis subscription while a replacement room is loading', async () => {
    const replacement = new Y.Doc()
    const unsubscribe = jest.fn()
    const extension = Object.create(
      DocumentsCollabRedisExtension.prototype,
    ) as DocumentsCollabRedisExtension
    Object.assign(extension, {
      knownDocuments: new Map([[DOCUMENT_ID, replacement]]),
      sub: { unsubscribe },
    })

    await extension.afterUnloadDocument({
      documentName: DOCUMENT_ID,
      instance: {
        documents: new Map(),
        loadingDocuments: new Map([[DOCUMENT_ID, Promise.resolve(replacement)]]),
      },
    } as never)

    expect(unsubscribe).not.toHaveBeenCalled()
    expect(
      (extension as unknown as { knownDocuments: Map<string, Y.Doc> })
        .knownDocuments.get(DOCUMENT_ID),
    ).toBe(replacement)
    replacement.destroy()
  })

  it('uses a dedicated URL and preserves authenticated TLS configuration', () => {
    expect(resolveDocumentsCollabRedisConfiguration({
      NODE_ENV: 'production',
      DOCUMENTS_COLLAB_REDIS_URL: 'rediss://collab%20user:s3cr%40t@redis.example.test:6380/4',
      DOCUMENTS_COLLAB_REDIS_PREFIX: 'open-mercato:documents:collab:production-eu',
      REDIS_URL: 'redis://ignored.example.test:6379',
    })).toEqual({
      host: 'redis.example.test',
      port: 6380,
      prefix: 'open-mercato:documents:collab:production-eu',
      options: {
        username: 'collab user',
        password: 's3cr@t',
        db: 4,
        tls: {},
        maxRetriesPerRequest: null,
      },
    })
  })

  it('treats unset, blank, and whitespace-only Redis URLs as not configured', () => {
    expect(resolveDocumentsCollabRedisConfiguration({ NODE_ENV: 'production' })).toBeNull()
    expect(resolveDocumentsCollabRedisConfiguration({ NODE_ENV: 'development' })).toBeNull()
    expect(resolveDocumentsCollabRedisConfiguration({
      NODE_ENV: 'production',
      DOCUMENTS_COLLAB_REDIS_URL: '   ',
      REDIS_URL: '',
    })).toBeNull()
  })

  it('still rejects an explicitly configured but invalid Redis URL', () => {
    expect(() => resolveDocumentsCollabRedisConfiguration({
      NODE_ENV: 'production',
      DOCUMENTS_COLLAB_REDIS_URL: 'http://not-redis.example.test',
    })).toThrow('redis:// or rediss://')
  })

  it('requires a deployment-scoped prefix for production Redis', () => {
    expect(() => resolveDocumentsCollabRedisConfiguration({
      NODE_ENV: 'production',
      DOCUMENTS_COLLAB_REDIS_URL: 'redis://cache.example.test:6379',
    })).toThrow('DOCUMENTS_COLLAB_REDIS_PREFIX is required')
    expect(() => resolveDocumentsCollabRedisConfiguration({
      NODE_ENV: 'production',
      DOCUMENTS_COLLAB_REDIS_URL: 'redis://cache.example.test:6379',
      DOCUMENTS_COLLAB_REDIS_PREFIX: 'open-mercato:documents:collab',
    })).toThrow('deployment-scoped Redis key prefix')
    expect(() => resolveDocumentsCollabRedisConfiguration({
      NODE_ENV: 'production',
      DOCUMENTS_COLLAB_REDIS_URL: 'redis://cache.example.test:6379',
      DOCUMENTS_COLLAB_REDIS_PREFIX: 'invalid prefix',
    })).toThrow('deployment-scoped Redis key prefix')
  })

  it('uses an isolated development namespace when Redis is local', () => {
    expect(resolveDocumentsCollabRedisConfiguration({
      NODE_ENV: 'development',
      DOCUMENTS_COLLAB_REDIS_URL: 'redis://localhost:6379',
    })?.prefix).toBe('open-mercato:documents:collab:development')
  })

  it('warns about single-node mode instead of requiring Redis at startup', () => {
    mockLoggerWarn.mockClear()
    const createRedisExtension = jest.fn(() => ({ kind: 'redis-extension' }))
    expect(resolveDocumentsCollabRedisExtensions({ NODE_ENV: 'production' }, createRedisExtension))
      .toEqual([])
    expect(createRedisExtension).not.toHaveBeenCalled()
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('single-node mode'))
  })

  it('activates the Redis extension when a URL is explicitly configured', () => {
    mockLoggerWarn.mockClear()
    const createRedisExtension = jest.fn(
      (configuration: DocumentsCollabRedisConfiguration) => ({ configuration }),
    )
    const extensions = resolveDocumentsCollabRedisExtensions(
      {
        NODE_ENV: 'production',
        REDIS_URL: 'redis://cache.example.test:6380/2',
        DOCUMENTS_COLLAB_REDIS_PREFIX: 'open-mercato:documents:collab:production-eu',
      },
      createRedisExtension,
    )
    expect(extensions).toHaveLength(1)
    expect(createRedisExtension).toHaveBeenCalledWith(expect.objectContaining({
      host: 'cache.example.test',
      port: 6380,
      options: expect.objectContaining({ db: 2 }),
    }))
    expect(mockLoggerWarn).not.toHaveBeenCalled()
  })

  it('queues a complete store retry when an authenticated source loses the Redis lock', async () => {
    const contention = new Error('Another instance is already storing this document')
    contention.name = 'SkipFurtherHooksError'
    const redisStore = jest.fn(async () => {
      throw contention
    })
    const extension = enforceDocumentsCollabSourceStoreOwnership({
      onStoreDocument: redisStore,
    })
    const retryStore = jest.fn()
    const document = new Y.Doc()
    const payload = {
      document,
      documentName: DOCUMENT_ID,
      instance: { storeDocumentHooks: retryStore },
      lastTransactionOrigin: { source: 'connection', connection: {} },
    } as unknown as onStoreDocumentPayload

    await expect(extension.onStoreDocument(payload)).rejects.toBe(contention)

    expect(redisStore).toHaveBeenCalledWith(payload)
    expect(retryStore).toHaveBeenCalledWith(document, payload)
    document.destroy()
  })

})

function makeHealthResponse() {
  const headers = new Map<string, string>()
  const response = {
    statusCode: 0,
    setHeader: jest.fn((name: string, value: string | number | readonly string[]) => {
      headers.set(name, Array.isArray(value) ? value.join(', ') : String(value))
      return response
    }),
    end: jest.fn(),
  }
  return { response: response as unknown as CollabHealthResponse, headers, end: response.end }
}

function makeInboundFrame(type: MessageType, byteLength: number): Uint8Array {
  if (byteLength < 5) throw new Error('Frame fixture is too small')
  const frame = new Uint8Array(byteLength)
  // lib0 varString("doc") followed by the Hocuspocus message type.
  frame.set([3, 100, 111, 99, type])
  return frame
}

function makeAddressedFrame(documentName: string, type: MessageType): Uint8Array {
  const documentBytes = new TextEncoder().encode(documentName)
  if (documentBytes.byteLength > 127) {
    throw new Error('Addressed frame fixture only supports one-byte varuint lengths')
  }
  return new Uint8Array([
    documentBytes.byteLength,
    ...documentBytes,
    type,
  ])
}

function encodeTestVarUint(value: number): number[] {
  const bytes: number[] = []
  let remaining = value
  do {
    const next = remaining & 0x7f
    remaining >>>= 7
    bytes.push(remaining > 0 ? next | 0x80 : next)
  } while (remaining > 0)
  return bytes
}

function makeAuthenticationFrame(documentName: string, token: string): Uint8Array {
  const documentBytes = new TextEncoder().encode(documentName)
  const tokenBytes = new TextEncoder().encode(token)
  return new Uint8Array([
    ...encodeTestVarUint(documentBytes.byteLength),
    ...documentBytes,
    MessageType.Auth,
    0, // AuthMessageType.Token
    ...encodeTestVarUint(tokenBytes.byteLength),
    ...tokenBytes,
  ])
}

beforeEach(() => {
  process.env.JWT_SECRET = 'legacy-collab-test-secret'
  delete process.env.DOCUMENTS_COLLAB_JWT_SECRET
  process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2 = 'v2-collab-test-secret-at-least-32-bytes'
  jest.useRealTimers()
})

describe('documents collaboration v2 server contract', () => {
  it('sets a finite WebSocket payload ceiling above the stored Yjs limit envelope', () => {
    expect(COLLAB_SERVER_TRANSPORT_OPTIONS).toEqual({
      maxPayload: DOCUMENTS_COLLAB_MAX_PAYLOAD_BYTES,
    })
    expect(COLLAB_SERVER_TRANSPORT_OPTIONS.maxPayload).toBeLessThan(16 * 1024 * 1024)
  })

  it('wires transport and pre-authentication ceilings into the Hocuspocus runtime configuration', async () => {
    const runtime = new Server({
      port: 0,
      quiet: true,
      stopOnSignals: false,
      ...COLLAB_SERVER_RUNTIME_CONFIGURATION,
    })
    try {
      expect(runtime.configuration.websocketOptions).toEqual(
        COLLAB_SERVER_TRANSPORT_OPTIONS,
      )
      expect(runtime.configuration.maxUnauthenticatedQueueSize).toBe(
        COLLAB_SERVER_UNAUTHENTICATED_CONFIGURATION.maxUnauthenticatedQueueSize,
      )
      expect(runtime.configuration.maxUnauthenticatedQueueMessages).toBe(
        COLLAB_SERVER_UNAUTHENTICATED_CONFIGURATION.maxUnauthenticatedQueueMessages,
      )
      expect(runtime.configuration.maxPendingDocuments).toBe(
        COLLAB_SERVER_UNAUTHENTICATED_CONFIGURATION.maxPendingDocuments,
      )
      expect((runtime.configuration as Record<string, unknown>).maxPayload).toBeUndefined()
    } finally {
      await runtime.destroy()
    }
  })

  it('closes an unauthenticated socket before accepting a frame above the transport ceiling', async () => {
    const testPayloadLimit = 1024
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const runtime = new Server({
      port: 0,
      address: '127.0.0.1',
      quiet: true,
      stopOnSignals: false,
      ...COLLAB_SERVER_WEBSOCKET_CONFIGURATION,
      websocketOptions: {
        ...COLLAB_SERVER_WEBSOCKET_CONFIGURATION.websocketOptions,
        maxPayload: testPayloadLimit,
      },
    })
    let socket: WebSocket | null = null
    try {
      await runtime.listen()
      socket = new WebSocket(runtime.webSocketURL)
      await new Promise<void>((resolve, reject) => {
        socket?.addEventListener('open', () => resolve(), { once: true })
        socket?.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true })
      })
      const closed = new Promise<number>((resolve) => {
        socket?.addEventListener('close', (event) => resolve(event.code), { once: true })
      })
      socket.send(new Uint8Array(testPayloadLimit + 1))
      await expect(closed).resolves.toBe(1009)
    } finally {
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
      await runtime.destroy()
      errorSpy.mockRestore()
    }
  })

  it('rejects expensive awareness, control, and read-only sync frames before decoding', () => {
    expect(() => assertCollabInboundFramePolicy(
      makeInboundFrame(MessageType.Awareness, DOCUMENTS_COLLAB_MAX_AWARENESS_FRAME_BYTES + 1),
      { readOnly: false },
    )).toThrow('awareness frame exceeds limit')

    expect(() => assertCollabInboundFramePolicy(
      makeInboundFrame(MessageType.Stateless, DOCUMENTS_COLLAB_MAX_CONTROL_FRAME_BYTES + 1),
      { readOnly: false },
    )).toThrow('control frame exceeds limit')

    const readOnlySync = makeInboundFrame(
      MessageType.Sync,
      DOCUMENTS_COLLAB_MAX_READ_ONLY_SYNC_FRAME_BYTES + 1,
    )
    expect(() => assertCollabInboundFramePolicy(readOnlySync, { readOnly: true }))
      .toThrow('read-only sync frame exceeds limit')
    expect(() => assertCollabInboundFramePolicy(readOnlySync, { readOnly: false }))
      .not.toThrow()
    expect(() => assertCollabInboundFramePolicy(new Uint8Array([0xff]), { readOnly: false }))
      .toThrow('malformed frame envelope')
  })

  it('bounds authenticated queued bytes across multiplexed document connections', () => {
    const socket = { close: jest.fn(), readyState: 1, send: jest.fn() }
    const firstHandle = jest.fn()
    const secondHandle = jest.fn()
    const pending = new Promise<void>(() => undefined)
    const first = {
      close: jest.fn(),
      handleMessage: firstHandle,
      waitForPendingMessages: () => pending,
      webSocket: socket,
    }
    const second = {
      close: jest.fn(),
      handleMessage: secondHandle,
      waitForPendingMessages: () => pending,
      webSocket: socket,
    }

    installBoundedCollabIngress(first, { maxPendingBytes: 10, maxPendingMessages: 10 })
    installBoundedCollabIngress(second, { maxPendingBytes: 10, maxPendingMessages: 10 })
    first.handleMessage(new Uint8Array(6))
    second.handleMessage(new Uint8Array(5))

    expect(firstHandle).toHaveBeenCalledTimes(1)
    expect(secondHandle).not.toHaveBeenCalled()
    expect(second.close).toHaveBeenCalledTimes(1)
    expect(socket.close).toHaveBeenCalledWith(1009, 'Collaboration ingress limit exceeded')
  })

  it('bounds authenticated queue length and releases completed frame charges', async () => {
    let resolvePending!: () => void
    const pending = new Promise<void>((resolve) => { resolvePending = resolve })
    const socket = { close: jest.fn(), readyState: 1, send: jest.fn() }
    const originalHandle = jest.fn()
    const connection = {
      close: jest.fn(),
      handleMessage: originalHandle,
      waitForPendingMessages: () => pending,
      webSocket: socket,
    }

    installBoundedCollabIngress(connection, { maxPendingBytes: 100, maxPendingMessages: 2 })
    connection.handleMessage(new Uint8Array(1))
    connection.handleMessage(new Uint8Array(1))
    expect(originalHandle).toHaveBeenCalledTimes(2)

    resolvePending()
    await pending
    await Promise.resolve()
    connection.handleMessage(new Uint8Array(1))
    expect(originalHandle).toHaveBeenCalledTimes(3)
    expect(socket.close).not.toHaveBeenCalled()
  })

  it('charges frames drained after delayed authentication before the connected hook', async () => {
    installHocuspocusCollabIngressGuard()

    let releaseAuthentication!: () => void
    const authenticationHeld = new Promise<void>((resolve) => {
      releaseAuthentication = resolve
    })
    let signalAuthenticationStarted!: () => void
    const authenticationStarted = new Promise<void>((resolve) => {
      signalAuthenticationStarted = resolve
    })
    let releaseProcessing!: () => void
    const processingHeld = new Promise<void>((resolve) => {
      releaseProcessing = resolve
    })
    let signalConnected!: () => void
    const connected = new Promise<void>((resolve) => {
      signalConnected = resolve
    })
    let handledFrames = 0
    const socket = {
      readyState: 1,
      send: jest.fn(),
      close: jest.fn(function close(this: { readyState: number }) {
        this.readyState = 3
      }),
    }
    const runtime = new Hocuspocus({
      quiet: true,
      timeout: 60_000,
      maxUnauthenticatedQueueSize: DOCUMENTS_COLLAB_MAX_PENDING_BYTES,
      // Deliberately permit one more pre-auth frame than the module's aggregate
      // queue budget. The prototype guard must catch it during Hocuspocus' drain.
      maxUnauthenticatedQueueMessages: DOCUMENTS_COLLAB_MAX_PENDING_MESSAGES + 1,
      maxPendingDocuments: 1,
      async onAuthenticate({ token }) {
        expect(token).toBe('held-token')
        signalAuthenticationStarted()
        await authenticationHeld
      },
      async beforeHandleMessage() {
        handledFrames += 1
        await processingHeld
      },
      async connected() {
        signalConnected()
      },
    })
    const client = runtime.handleConnection(
      socket,
      new Request('http://127.0.0.1/collaboration'),
    )

    try {
      client.handleMessage(makeAuthenticationFrame('doc', 'held-token'))
      await authenticationStarted
      for (let index = 0; index < DOCUMENTS_COLLAB_MAX_PENDING_MESSAGES + 1; index += 1) {
        client.handleMessage(makeInboundFrame(MessageType.QueryAwareness, 5))
      }

      releaseAuthentication()
      await connected

      expect(socket.close).toHaveBeenCalledWith(1009, 'Collaboration ingress limit exceeded')
      expect(handledFrames).toBe(1)
    } finally {
      releaseAuthentication()
      releaseProcessing()
      client.handleClose({ code: 1000, reason: 'test complete' })
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  })

  it('bounds cumulative writable Yjs updates between durable stores', async () => {
    const hooks = createCollabHooks({
      verifyToken: verifyCollabToken,
      authorizeContext: async () => true,
      resolveAwarenessName: async () => 'Trusted collaborator',
      resolveContainer: async () => ({ resolve: () => ({}) }),
      loadContent: async () => null,
      initializeYjsState: async () => null,
      persistContent: async () => ({
        updatedAt: new Date(),
        collaborationGeneration: 1,
      }),
    })
    const document = new Y.Doc()
    const context = {
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }

    await hooks.beforeSync({
      type: 2,
      payload: new Uint8Array(DOCUMENTS_MAX_YJS_STATE_BYTES),
      document,
      connection: { readOnly: false },
      context,
    })
    await expect(hooks.beforeSync({
      type: 2,
      payload: new Uint8Array(1),
      document,
      connection: { readOnly: false },
      context,
    })).rejects.toThrow()
    await expect(hooks.beforeSync({
      type: 2,
      payload: new Uint8Array(DOCUMENTS_MAX_YJS_STATE_BYTES),
      document: new Y.Doc(),
      connection: { readOnly: true },
    })).resolves.toBeUndefined()
  })

  it('budgets the next local frame from the exact Redis-merged state', async () => {
    const hooks = createCollabHooks({
      verifyToken: verifyCollabToken,
      authorizeContext: async () => true,
      resolveContainer: async () => ({ resolve: () => ({}) }),
      loadContent: async () => null,
      initializeYjsState: async () => null,
      persistContent: async () => ({ updatedAt: new Date(), collaborationGeneration: 1 }),
    })
    const document = new Y.Doc()
    const context = {
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    hooks.recordRedisAggregate(document, DOCUMENTS_MAX_YJS_STATE_BYTES)

    await expect(hooks.beforeSync({
      type: 2,
      payload: new Uint8Array([1]),
      document,
      connection: { readOnly: false },
      context,
    })).rejects.toThrow('documents.content.tooLarge')
    document.destroy()
  })

  it('rejects a revoked writable frame before it enters the shared document', async () => {
    const invalidateRoom = jest.fn()
    const close = jest.fn()
    const authorizeContext = jest.fn(async () => false)
    const hooks = createCollabHooks({
      verifyToken: verifyCollabToken,
      authorizeContext,
      resolveContainer: async () => ({ resolve: () => ({}) }),
      loadContent: async () => null,
      initializeYjsState: async () => null,
      persistContent: async () => ({ updatedAt: new Date(), collaborationGeneration: 1 }),
      invalidateRoom,
    })
    const document = new Y.Doc()
    const context = {
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }

    await expect(hooks.beforeSync({
      type: 2,
      payload: new Uint8Array([1, 2, 3]),
      document,
      connection: { readOnly: false, close },
      context,
    })).rejects.toThrow('write authorization is no longer current')

    expect(authorizeContext).toHaveBeenCalledWith(context)
    expect(close).toHaveBeenCalledTimes(1)
    expect(invalidateRoom).toHaveBeenCalledWith(DOCUMENT_ID, document)
    expect(Y.encodeStateAsUpdate(document)).toHaveLength(2)
    document.destroy()
  })

  it('rejects a writable frame when the room is invalidated during live authorization', async () => {
    let invalidated = false
    let releaseAuthorization = (): void => undefined
    const authorizationPending = new Promise<void>((resolve) => {
      releaseAuthorization = resolve
    })
    const invalidateRoom = jest.fn(() => { invalidated = true })
    const hooks = createCollabHooks({
      verifyToken: verifyCollabToken,
      authorizeContext: async () => {
        await authorizationPending
        return true
      },
      resolveContainer: async () => ({ resolve: () => ({}) }),
      loadContent: async () => null,
      initializeYjsState: async () => null,
      persistContent: async () => ({ updatedAt: new Date(), collaborationGeneration: 1 }),
      isRoomInvalidated: () => invalidated,
      invalidateRoom,
    })
    const document = new Y.Doc()
    const context = {
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    const checking = hooks.beforeSync({
      type: 2,
      payload: new Uint8Array([1]),
      document,
      connection: { readOnly: false },
      context,
    })
    invalidated = true
    releaseAuthorization()

    await expect(checking).rejects.toThrow('write authorization is no longer current')
    expect(invalidateRoom).toHaveBeenCalledWith(DOCUMENT_ID, document)
    document.destroy()
  })

  it('rejects a Redis update whose aggregate replica state exceeds the Yjs limit', () => {
    const first = new Y.Doc()
    const second = new Y.Doc()
    first.getText('first').insert(0, 'a'.repeat(4_300_000))
    second.getText('second').insert(0, 'b'.repeat(4_300_000))
    const firstState = Y.encodeStateAsUpdate(first)
    const secondState = Y.encodeStateAsUpdate(second)
    expect(firstState.byteLength).toBeLessThan(DOCUMENTS_MAX_YJS_STATE_BYTES)
    expect(secondState.byteLength).toBeLessThan(DOCUMENTS_MAX_YJS_STATE_BYTES)

    expect(() => assertDocumentsCollabRedisAggregateUpdate(first, secondState))
      .toThrow('documents.content.tooLarge')

    first.destroy()
    second.destroy()
  })

  it('fails closed on missing or untrusted production origins', () => {
    const allowedOrigins = ['https://mercato.example']
    expect(isCollabRequestOriginAllowed({
      allowedOrigins,
      requireOrigin: true,
    })).toBe(false)
    expect(isCollabRequestOriginAllowed({
      origin: 'https://mercato.example',
      allowedOrigins: [],
      requireOrigin: true,
    })).toBe(false)
    expect(isCollabRequestOriginAllowed({
      origin: 'https://mercato.example/path',
      allowedOrigins,
      requireOrigin: true,
    })).toBe(true)
    expect(isCollabRequestOriginAllowed({
      origin: 'https://attacker.example',
      allowedOrigins,
      requireOrigin: true,
    })).toBe(false)
  })

  it('preserves local missing-Origin ergonomics while honoring an explicit allowlist', () => {
    expect(isCollabRequestOriginAllowed({ requireOrigin: false })).toBe(true)
    expect(isCollabRequestOriginAllowed({
      origin: 'http://localhost:3000',
      requireOrigin: false,
    })).toBe(true)
    expect(isCollabRequestOriginAllowed({
      origin: 'http://attacker.local',
      allowedOrigins: ['http://localhost:3000'],
      requireOrigin: false,
    })).toBe(false)
  })

  it('normalizes explicit and application origins into a deduplicated trust list', () => {
    expect(resolveCollabAllowedOrigins({
      DOCUMENTS_COLLAB_ALLOWED_ORIGINS: 'https://mercato.example/path,not-a-url',
      APP_URL: 'https://mercato.example/another-path',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000/backend',
    })).toEqual(['https://mercato.example', 'http://localhost:3000'])
  })

  it('re-authenticates for access changes without suppressing durable stores', () => {
    expect(resolveCollabRoomEventAction('documents.document.shared')).toBe('reauth')
    expect(resolveCollabRoomEventAction('documents.document.unshared')).toBe('reauth')
  })

  it('closes a content-replaced room with the browser-recognizable content-reset reason', () => {
    // A plain ResetConnection close makes the provider rejoin the reloaded
    // room with its stale Y.Doc and sync the pre-restore state back (#5361).
    const close = jest.fn()
    const otherClose = jest.fn()
    const registry = {
      documents: new Map([
        ['doc-1', { connections: new Map([[{ close }, { clients: new Set() }], [{ close }, { clients: new Set() }]]) }],
        ['doc-2', { connections: new Map([[{ close: otherClose }, { clients: new Set() }]]) }],
      ]),
    }

    expect(closeCollabRoomConnectionsForContentReset(registry, 'doc-1')).toBe(2)
    expect(close).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledWith({ code: 4205, reason: 'documents:content-reset' })
    expect(otherClose).not.toHaveBeenCalled()
    expect(closeCollabRoomConnectionsForContentReset(registry, 'missing')).toBe(0)
  })

  it('waits for captured queues and consumes a trusted final-drain mark once', async () => {
    const document = new Y.Doc()
    let liveConnections: number | null = 1
    const registry = createCollabFinalDrainRegistry(() => liveConnections)

    await expect(registry.consume(document)).resolves.toBe('unmarked')
    expect(registry.isMarked(document)).toBe(false)

    let releaseReadiness!: () => void
    const readiness = new Promise<void>((resolve) => { releaseReadiness = resolve })
    expect(registry.mark(document, readiness)).toBe(true)
    expect(registry.isMarked(document)).toBe(true)
    liveConnections = 0
    const firstConsume = registry.consume(document)
    const concurrentConsume = registry.consume(document)
    expect(registry.isMarked(document)).toBe(true)

    releaseReadiness()
    await expect(firstConsume).resolves.toBe('consumed')
    await expect(concurrentConsume).resolves.toBe('busy')
    expect(registry.isMarked(document)).toBe(true)
    registry.complete(document)
    expect(registry.isMarked(document)).toBe(true)
    await expect(registry.consume(document)).resolves.toBe('busy')
    registry.discard(document)
    expect(registry.isMarked(document)).toBe(false)

    liveConnections = 1
    expect(registry.mark(document, Promise.resolve())).toBe(true)
    await expect(registry.consume(document)).resolves.toBe('connected')
    expect(registry.isMarked(document)).toBe(true)
    registry.discard(document)
    expect(registry.isMarked(document)).toBe(false)

    expect(registry.mark(document, Promise.reject(new Error('queue failed')))).toBe(true)
    liveConnections = 0
    await expect(registry.consume(document)).resolves.toBe('failed')
    expect(registry.isMarked(document)).toBe(true)
    registry.discard(document)
    expect(registry.isMarked(document)).toBe(false)

    // A room without a live logical connection must never gain a stale mark:
    // no last-connection store is guaranteed to consume it.
    expect(registry.mark(document, Promise.resolve())).toBe(false)
    expect(registry.isMarked(document)).toBe(false)

    liveConnections = null
    expect(registry.mark(document, Promise.resolve())).toBe(false)
    expect(registry.isMarked(document)).toBe(false)

    liveConnections = 1
    expect(registry.mark(document, Promise.resolve())).toBe(true)
    registry.discard(document)
    expect(registry.isMarked(document)).toBe(false)
    await expect(registry.consume(document)).resolves.toBe('unmarked')
  })

  it('bounds authorization epochs to documents with active authentication', () => {
    const registry = createCollabFinalDrainRegistry(() => 0)
    const first = registry.beginAuthorization(DOCUMENT_ID)
    const second = registry.beginAuthorization(DOCUMENT_ID)
    expect(registry.isAuthorizationCurrent(first)).toBe(true)
    expect(registry.isAuthorizationCurrent(second)).toBe(true)

    registry.bumpAuthorization(DOCUMENT_ID)
    expect(registry.isAuthorizationCurrent(first)).toBe(false)
    expect(registry.isAuthorizationCurrent(second)).toBe(false)
    registry.endAuthorization(first)
    registry.endAuthorization(second)

    // With no active authentication, bumps retain no per-document state.
    registry.bumpAuthorization(DOCUMENT_ID)
    const replacement = registry.beginAuthorization(DOCUMENT_ID)
    expect(registry.isAuthorizationCurrent(replacement)).toBe(true)
    registry.endAuthorization(replacement)
  })

  it('isolates authorization epochs by trusted tenant and organization scope', () => {
    const registry = createCollabFinalDrainRegistry(() => 0)
    const ownScope = { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
    const foreignTenantScope = {
      tenantId: '55555555-5555-4555-8555-555555555555',
      organizationId: ORGANIZATION_ID,
    }
    const foreignOrganizationScope = {
      tenantId: TENANT_ID,
      organizationId: '66666666-6666-4666-8666-666666666666',
    }
    const own = registry.beginAuthorization(DOCUMENT_ID, ownScope)
    const foreignTenant = registry.beginAuthorization(DOCUMENT_ID, foreignTenantScope)
    const foreignOrganization = registry.beginAuthorization(DOCUMENT_ID, foreignOrganizationScope)

    registry.bumpAuthorization(DOCUMENT_ID, foreignTenantScope)
    expect(registry.isAuthorizationCurrent(own)).toBe(true)
    expect(registry.isAuthorizationCurrent(foreignTenant)).toBe(false)
    expect(registry.isAuthorizationCurrent(foreignOrganization)).toBe(true)

    registry.bumpAuthorization(DOCUMENT_ID, foreignOrganizationScope)
    expect(registry.isAuthorizationCurrent(own)).toBe(true)
    expect(registry.isAuthorizationCurrent(foreignOrganization)).toBe(false)

    registry.endAuthorization(own)
    registry.endAuthorization(foreignTenant)
    registry.endAuthorization(foreignOrganization)
  })

  it('expires an orphaned pre-connection authorization ticket without retaining its document', () => {
    jest.useFakeTimers()
    try {
      const registry = createCollabFinalDrainRegistry(() => 0)
      const orphaned = registry.beginAuthorization(DOCUMENT_ID)
      expect(registry.isAuthorizationCurrent(orphaned)).toBe(true)

      jest.advanceTimersByTime(DOCUMENTS_COLLAB_AUTHORIZATION_TICKET_TIMEOUT_MS)
      expect(registry.isAuthorizationCurrent(orphaned)).toBe(false)

      // Expiry deleted the last active state; an event with no active auth is
      // not retained and a later authentication starts with a clean ticket.
      registry.bumpAuthorization(DOCUMENT_ID)
      const replacement = registry.beginAuthorization(DOCUMENT_ID)
      expect(registry.isAuthorizationCurrent(replacement)).toBe(true)
      registry.endAuthorization(replacement)
    } finally {
      jest.useRealTimers()
    }
  })

  it('captures every closable connection queue before a reauth drain', async () => {
    let resolveFirst!: () => void
    let resolveSecond!: () => void
    const firstPending = new Promise<void>((resolve) => { resolveFirst = resolve })
    const secondPending = new Promise<void>((resolve) => { resolveSecond = resolve })
    const firstWait = jest.fn(() => firstPending)
    const secondWait = jest.fn(() => secondPending)
    let socketConnections: unknown[] = [
      { waitForPendingMessages: firstWait },
      { waitForPendingMessages: secondWait },
    ]
    let totalConnections = 2
    const document = new Y.Doc() as Y.Doc & {
      getConnections: () => unknown[]
      getConnectionsCount: () => number
    }
    document.getConnections = () => socketConnections
    document.getConnectionsCount = () => totalConnections
    const registry = createCollabFinalDrainRegistry()

    expect(markCollabFinalDrainForReauth(document, registry)).toBe(true)
    expect(firstWait).toHaveBeenCalledTimes(1)
    expect(secondWait).toHaveBeenCalledTimes(1)

    // Model closeConnections removing the exact captured sockets.
    socketConnections = []
    totalConnections = 0
    const consuming = registry.consume(document)
    expect(registry.isMarked(document)).toBe(true)

    resolveFirst()
    await Promise.resolve()
    expect(registry.isMarked(document)).toBe(true)

    resolveSecond()
    await expect(consuming).resolves.toBe('consumed')
    expect(registry.isMarked(document)).toBe(true)
    registry.complete(document)
    expect(registry.isMarked(document)).toBe(true)
    registry.discard(document)
    expect(registry.isMarked(document)).toBe(false)
  })

  it('marks a reauth drain only for a room with a closable queue-aware connection', async () => {
    const document = new Y.Doc() as Y.Doc & {
      getConnections: () => unknown[]
      getConnectionsCount: () => number
    }
    let socketConnections: unknown[] = []
    let totalConnections = 1 // A direct-only connection is not closed by closeConnections.
    document.getConnections = () => socketConnections
    document.getConnectionsCount = () => totalConnections
    const registry = createCollabFinalDrainRegistry()

    expect(markCollabFinalDrainForReauth(document, registry)).toBe(false)
    expect(registry.isMarked(document)).toBe(false)

    totalConnections = 0
    expect(markCollabFinalDrainForReauth(document, registry)).toBe(false)
    expect(registry.isMarked(document)).toBe(false)

    socketConnections = [{ waitForPendingMessages: () => Promise.resolve() }]
    totalConnections = 1
    expect(markCollabFinalDrainForReauth(document, registry)).toBe(true)
    expect(registry.isMarked(document)).toBe(true)
    totalConnections = 0
    await expect(registry.consume(document)).resolves.toBe('consumed')
    registry.complete(document)
    expect(registry.isMarked(document)).toBe(true)
    registry.discard(document)

    socketConnections = [{}]
    totalConnections = 1
    expect(markCollabFinalDrainForReauth(document, registry)).toBe(true)
    totalConnections = 0
    await expect(registry.consume(document)).resolves.toBe('failed')
    expect(registry.isMarked(document)).toBe(true)
    registry.discard(document)
    expect(registry.isMarked(document)).toBe(false)
  })

  it.each(['owned-grant', 'late-mark'] as const)(
    'retires the real Hocuspocus room after a %s final-drain store failure',
    async (mode) => {
      const context = {
        userId: USER_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        documentId: DOCUMENT_ID,
        tier: 'editor' as const,
        readOnly: false,
        exp: null,
      }
      let liveConnections = 1
      const finalDrainRegistry = createCollabFinalDrainRegistry(() => liveConnections)
      const invalidatedRooms = new WeakSet<Y.Doc>()
      let signalPersistenceStarted!: () => void
      let rejectPersistence!: (reason?: unknown) => void
      const persistenceStarted = new Promise<void>((resolve) => {
        signalPersistenceStarted = resolve
      })
      const persistence = new Promise<never>((_resolve, reject) => {
        rejectPersistence = reject
      })
      mockLoggerError.mockClear()
      let runtime!: Hocuspocus<typeof context>
      const hooks = createCollabHooks({
        verifyToken: () => null,
        authorizeContext: async () => true,
        resolveContainer: async () => ({
          resolve: (name: string) => name === 'em' ? {} : { indexRecordById: async () => undefined },
        }),
        loadContent: async () => ({
          yjsState: null,
          contentHtml: null,
          updatedAt: '2026-07-10T10:00:00.000Z',
          collaborationGeneration: 1,
        }),
        initializeYjsState: async () => null,
        persistContent: async () => {
          signalPersistenceStarted()
          return persistence
        },
        finalDrainRegistry,
        resolveRoomDocument: (name) => runtime.documents.get(name),
        isRoomInvalidated: (_name, document) => Boolean(
          document && invalidatedRooms.has(document),
        ),
        invalidateRoom: (_name, document) => invalidatedRooms.add(document),
      })
      runtime = new Hocuspocus<typeof context>({
        quiet: true,
        debounce: 0,
        maxDebounce: 0,
        unloadImmediately: true,
        onLoadDocument: (data) => hooks.onLoadDocument({
          documentName: data.documentName,
          context: data.context,
          document: data.document,
        }),
        onStoreDocument: (data) => hooks.onStoreDocument({
          documentName: data.documentName,
          context: data.lastContext,
          document: data.document,
        }),
      })

      try {
        const document = await runtime.createDocument(
          DOCUMENT_ID,
          new Request('http://127.0.0.1/collaboration'),
          'lifecycle-socket',
          { readOnly: false, isAuthenticated: true },
          context,
        )
        if (mode === 'owned-grant') {
          expect(finalDrainRegistry.mark(document, Promise.resolve())).toBe(true)
          liveConnections = 0
        }

        const storing = runtime.storeDocumentHooks(document, {
          instance: runtime,
          clientsCount: 0,
          document,
          documentName: DOCUMENT_ID,
          lastContext: context,
          lastTransactionOrigin: { source: 'local', context },
        }, true)
        await persistenceStarted

        if (mode === 'late-mark') {
          expect(finalDrainRegistry.mark(document, Promise.resolve())).toBe(true)
          liveConnections = 0
        }
        rejectPersistence(new Error('durable store unavailable'))
        await storing

        for (let attempt = 0; attempt < 5 && runtime.documents.has(DOCUMENT_ID); attempt += 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
        expect(finalDrainRegistry.isMarked(document)).toBe(false)
        expect(invalidatedRooms.has(document)).toBe(true)
        expect(runtime.documents.has(DOCUMENT_ID)).toBe(false)
        expect(mockLoggerError).toHaveBeenCalledWith(
          expect.stringContaining('final drain failed; retiring in-memory room'),
        )
      } finally {
        for (const document of runtime.documents.values()) {
          await runtime.unloadDocument(document)
        }
      }
    },
  )

  it('unloads the real Hocuspocus room when invalidation lands during setup failure', async () => {
    const context = {
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    const finalDrainRegistry = createCollabFinalDrainRegistry()
    const invalidatedRooms = new WeakSet<Y.Doc>()
    let signalSetupStarted!: () => void
    let rejectSetup!: (reason?: unknown) => void
    const setupStarted = new Promise<void>((resolve) => { signalSetupStarted = resolve })
    const failedSetup = new Promise<never>((_resolve, reject) => { rejectSetup = reject })
    const container = {
      resolve: (name: string) => name === 'em' ? {} : { indexRecordById: async () => undefined },
    }
    let containerCalls = 0
    mockLoggerError.mockClear()
    let runtime!: Hocuspocus<typeof context>
    const hooks = createCollabHooks({
      verifyToken: () => null,
      authorizeContext: async () => true,
      resolveContainer: async () => {
        containerCalls += 1
        if (containerCalls === 1) return container
        signalSetupStarted()
        return failedSetup
      },
      loadContent: async () => ({
        yjsState: null,
        contentHtml: null,
        updatedAt: '2026-07-10T10:00:00.000Z',
        collaborationGeneration: 1,
      }),
      initializeYjsState: async () => null,
      persistContent: async () => ({
        updatedAt: '2026-07-10T10:00:01.000Z',
        collaborationGeneration: 1,
      }),
      finalDrainRegistry,
      resolveRoomDocument: (name) => runtime.documents.get(name),
      isRoomInvalidated: (_name, document) => Boolean(
        document && invalidatedRooms.has(document),
      ),
      invalidateRoom: (_name, document) => invalidatedRooms.add(document),
    })
    runtime = new Hocuspocus<typeof context>({
      quiet: true,
      debounce: 0,
      maxDebounce: 0,
      unloadImmediately: true,
      onLoadDocument: (data) => hooks.onLoadDocument({
        documentName: data.documentName,
        context: data.context,
        document: data.document,
      }),
      onStoreDocument: (data) => hooks.onStoreDocument({
        documentName: data.documentName,
        context: data.lastContext,
        document: data.document,
      }),
    })

    try {
      const document = await runtime.createDocument(
        DOCUMENT_ID,
        new Request('http://127.0.0.1/collaboration'),
        'invalidate-setup-socket',
        { readOnly: false, isAuthenticated: true },
        context,
      )
      const storing = runtime.storeDocumentHooks(document, {
        instance: runtime,
        clientsCount: 0,
        document,
        documentName: DOCUMENT_ID,
        lastContext: context,
        lastTransactionOrigin: { source: 'local', context },
      }, true)
      await setupStarted

      // Model an explicit content-reset event while request-container setup is
      // awaiting infrastructure that subsequently rejects.
      finalDrainRegistry.discard(document)
      invalidatedRooms.add(document)
      rejectSetup(new Error('request container unavailable'))
      await storing

      for (let attempt = 0; attempt < 5 && runtime.documents.has(DOCUMENT_ID); attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      expect(runtime.documents.has(DOCUMENT_ID)).toBe(false)
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.stringContaining('invalidated store failed; retiring in-memory room'),
      )
    } finally {
      for (const document of runtime.documents.values()) {
        await runtime.unloadDocument(document)
      }
    }
  })

  it('finishes a final-drain CAS merge without scheduling a contextless Hocuspocus store', async () => {
    const context = {
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    const authoritativeDocument = new Y.Doc()
    authoritativeDocument.getText('cas-lifecycle').insert(0, 'B')
    let liveConnections = 1
    const finalDrainRegistry = createCollabFinalDrainRegistry(() => liveConnections)
    const loadContent = jest.fn()
      .mockResolvedValueOnce({
        yjsState: null,
        contentHtml: null,
        updatedAt: '2026-07-10T10:00:00.000Z',
        collaborationGeneration: 1,
      })
      .mockResolvedValueOnce({
        yjsState: Buffer.from(Y.encodeStateAsUpdate(authoritativeDocument)),
        contentHtml: null,
        updatedAt: '2026-07-10T10:00:01.000Z',
        collaborationGeneration: 1,
      })
    const persistContent = jest.fn()
      .mockRejectedValueOnce(new CrudHttpError(409, {
        error: 'Record changed by another user',
        code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      }))
      .mockResolvedValueOnce({
        updatedAt: '2026-07-10T10:00:02.000Z',
        collaborationGeneration: 1,
      })
    const authorizeContext = jest.fn(async () => true)
    let runtime!: Hocuspocus<typeof context>
    const hooks = createCollabHooks({
      verifyToken: () => null,
      authorizeContext,
      resolveContainer: async () => ({
        resolve: (name: string) => name === 'em' ? {} : { indexRecordById: async () => undefined },
      }),
      loadContent,
      initializeYjsState: async () => null,
      persistContent,
      finalDrainRegistry,
      resolveRoomDocument: (name) => runtime.documents.get(name),
    })
    runtime = new Hocuspocus<typeof context>({
      quiet: true,
      debounce: 0,
      maxDebounce: 0,
      unloadImmediately: true,
      onLoadDocument: (data) => hooks.onLoadDocument({
        documentName: data.documentName,
        context: data.context,
        document: data.document,
      }),
      onStoreDocument: (data) => hooks.onStoreDocument({
        documentName: data.documentName,
        context: data.lastContext,
        document: data.document,
      }),
    })

    try {
      const document = await runtime.createDocument(
        DOCUMENT_ID,
        new Request('http://127.0.0.1/collaboration'),
        'cas-lifecycle-socket',
        { readOnly: false, isAuthenticated: true },
        context,
      )
      document.transact(() => {
        document.getText('cas-lifecycle').insert(0, 'A')
      }, { source: 'local', skipStoreHooks: true, context })
      expect(finalDrainRegistry.mark(document, Promise.resolve())).toBe(true)
      liveConnections = 0

      await runtime.storeDocumentHooks(document, {
        instance: runtime,
        clientsCount: 0,
        document,
        documentName: DOCUMENT_ID,
        lastContext: context,
        lastTransactionOrigin: { source: 'local', context },
      }, true)

      for (let attempt = 0; attempt < 5 && runtime.documents.has(DOCUMENT_ID); attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      expect(persistContent).toHaveBeenCalledTimes(2)
      expect(authorizeContext).toHaveBeenCalledTimes(1)
      const retriedState = persistContent.mock.calls[1]?.[3]?.yjsState as Buffer
      const durable = new Y.Doc()
      Y.applyUpdate(durable, new Uint8Array(retriedState))
      expect(new Set(durable.getText('cas-lifecycle').toString())).toEqual(new Set(['A', 'B']))
      expect(durable.getText('cas-lifecycle')).toHaveLength(2)
      expect(finalDrainRegistry.isMarked(document)).toBe(true)
      expect(runtime.documents.has(DOCUMENT_ID)).toBe(false)
    } finally {
      for (const document of runtime.documents.values()) {
        await runtime.unloadDocument(document)
      }
    }
  })

  it('rejects pre-event authentication before and after the drained room unmaps', async () => {
    const context = {
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    const token = mintCollabTokenV2({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor',
      tokenVersion: 2,
      readOnly: false,
    })
    let liveConnections = 1
    let authorized = true
    const finalDrainRegistry = createCollabFinalDrainRegistry(() => liveConnections)
    let releaseFirstLabel!: () => void
    let releaseSecondLabel!: () => void
    const firstLabelHeld = new Promise<void>((resolve) => { releaseFirstLabel = resolve })
    const secondLabelHeld = new Promise<void>((resolve) => { releaseSecondLabel = resolve })
    let signalBothLabelsStarted!: () => void
    const bothLabelsStarted = new Promise<void>((resolve) => { signalBothLabelsStarted = resolve })
    let labelCalls = 0
    let runtime!: Hocuspocus<typeof context>
    const hooks = createCollabHooks({
      verifyToken: verifyCollabToken,
      verifyTokenV2: verifyCollabTokenV2,
      authorizeContext: async () => authorized,
      resolveAwarenessName: async () => {
        const call = labelCalls
        labelCalls += 1
        if (labelCalls === 2) signalBothLabelsStarted()
        if (call === 0) await firstLabelHeld
        if (call === 1) await secondLabelHeld
        return 'Trusted collaborator'
      },
      resolveContainer: async () => ({
        resolve: (name: string) => name === 'em' ? {} : { indexRecordById: async () => undefined },
      }),
      loadContent: async () => ({
        yjsState: null,
        contentHtml: null,
        updatedAt: '2026-07-10T10:00:00.000Z',
        collaborationGeneration: 1,
      }),
      initializeYjsState: async () => null,
      persistContent: async () => ({
        updatedAt: '2026-07-10T10:00:01.000Z',
        collaborationGeneration: 1,
      }),
      finalDrainRegistry,
      resolveRoomDocument: (name) => runtime.documents.get(name),
    })
    runtime = new Hocuspocus<typeof context>({
      quiet: true,
      debounce: 0,
      maxDebounce: 0,
      unloadImmediately: true,
      onLoadDocument: (data) => hooks.onLoadDocument({
        documentName: data.documentName,
        context: data.context,
        document: data.document,
      }),
      onStoreDocument: (data) => hooks.onStoreDocument({
        documentName: data.documentName,
        context: data.lastContext,
        document: data.document,
      }),
    })

    try {
      const oldDocument = await runtime.createDocument(
        DOCUMENT_ID,
        new Request('http://127.0.0.1/collaboration'),
        'stale-auth-socket',
        { readOnly: false, isAuthenticated: true },
        context,
      )
      const firstAuthentication = hooks.onAuthenticate({
        token,
        documentName: DOCUMENT_ID,
        connection: { readOnly: false },
      })
      const secondAuthentication = hooks.onAuthenticate({
        token,
        documentName: DOCUMENT_ID,
        connection: { readOnly: false },
      })
      await bothLabelsStarted

      expect(finalDrainRegistry.mark(oldDocument, Promise.resolve())).toBe(true)
      liveConnections = 0
      await runtime.storeDocumentHooks(oldDocument, {
        instance: runtime,
        clientsCount: 0,
        document: oldDocument,
        documentName: DOCUMENT_ID,
        lastContext: context,
        lastTransactionOrigin: { source: 'local', context },
      }, true)
      expect(finalDrainRegistry.isMarked(oldDocument)).toBe(true)
      expect(runtime.documents.get(DOCUMENT_ID)).toBe(oldDocument)

      // This stale authorization resumes before the delayed unload. Even when
      // its second live check returns true, the exact-Y.Doc tombstone wins.
      releaseFirstLabel()
      await expect(firstAuthentication).rejects.toThrow('room is draining accepted edits')

      for (let attempt = 0; attempt < 5 && runtime.documents.has(DOCUMENT_ID); attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      expect(runtime.documents.has(DOCUMENT_ID)).toBe(false)

      // This second pre-event authentication resumes after unmapping, where
      // only the final fresh authorization check can observe revocation.
      authorized = false
      releaseSecondLabel()
      await expect(secondAuthentication).rejects.toThrow('stale or revoked token')

      authorized = true
      const replacement = await runtime.createDocument(
        DOCUMENT_ID,
        new Request('http://127.0.0.1/collaboration'),
        'replacement-auth-socket',
        { readOnly: false, isAuthenticated: true },
        context,
      )
      expect(replacement).not.toBe(oldDocument)
      expect(finalDrainRegistry.isMarked(replacement)).toBe(false)
      await expect(hooks.onAuthenticate({
        token,
        documentName: DOCUMENT_ID,
        connection: { readOnly: false },
      })).resolves.toMatchObject({ documentId: DOCUMENT_ID, readOnly: false })
    } finally {
      for (const document of runtime.documents.values()) {
        await runtime.unloadDocument(document)
      }
    }
  })

  it('rejects a stale final authorization that resolves after the event and unmap', async () => {
    const context = {
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    const token = mintCollabTokenV2({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor',
      tokenVersion: 2,
      readOnly: false,
    })
    let liveConnections = 1
    let authorizationCalls = 0
    let signalFinalAuthorizationStarted!: () => void
    let releaseFinalAuthorization!: () => void
    const finalAuthorizationStarted = new Promise<void>((resolve) => {
      signalFinalAuthorizationStarted = resolve
    })
    const finalAuthorizationHeld = new Promise<void>((resolve) => {
      releaseFinalAuthorization = resolve
    })
    const finalDrainRegistry = createCollabFinalDrainRegistry(() => liveConnections)
    let runtime!: Hocuspocus<typeof context>
    const hooks = createCollabHooks({
      verifyToken: verifyCollabToken,
      verifyTokenV2: verifyCollabTokenV2,
      authorizeContext: async () => {
        authorizationCalls += 1
        if (authorizationCalls === 2) {
          signalFinalAuthorizationStarted()
          await finalAuthorizationHeld
        }
        return true
      },
      resolveAwarenessName: async () => 'Trusted collaborator',
      resolveContainer: async () => ({
        resolve: (name: string) => name === 'em' ? {} : { indexRecordById: async () => undefined },
      }),
      loadContent: async () => ({
        yjsState: null,
        contentHtml: null,
        updatedAt: '2026-07-10T10:00:00.000Z',
        collaborationGeneration: 1,
      }),
      initializeYjsState: async () => null,
      persistContent: async () => ({
        updatedAt: '2026-07-10T10:00:01.000Z',
        collaborationGeneration: 1,
      }),
      finalDrainRegistry,
      resolveRoomDocument: (name) => runtime.documents.get(name),
    })
    runtime = new Hocuspocus<typeof context>({
      quiet: true,
      debounce: 0,
      maxDebounce: 0,
      unloadImmediately: true,
      onLoadDocument: (data) => hooks.onLoadDocument({
        documentName: data.documentName,
        context: data.context,
        document: data.document,
      }),
      onStoreDocument: (data) => hooks.onStoreDocument({
        documentName: data.documentName,
        context: data.lastContext,
        document: data.document,
      }),
    })

    try {
      const oldDocument = await runtime.createDocument(
        DOCUMENT_ID,
        new Request('http://127.0.0.1/collaboration'),
        'final-auth-race-socket',
        { readOnly: false, isAuthenticated: true },
        context,
      )
      const authenticating = hooks.onAuthenticate({
        token,
        documentName: DOCUMENT_ID,
        connection: { readOnly: false },
      })
      await finalAuthorizationStarted

      // The trusted event crosses the already-running final authorization,
      // drains the room, and lets Hocuspocus unmap it before stale true returns.
      finalDrainRegistry.bumpAuthorization(DOCUMENT_ID, {
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
      })
      expect(finalDrainRegistry.mark(oldDocument, Promise.resolve())).toBe(true)
      liveConnections = 0
      await runtime.storeDocumentHooks(oldDocument, {
        instance: runtime,
        clientsCount: 0,
        document: oldDocument,
        documentName: DOCUMENT_ID,
        lastContext: context,
        lastTransactionOrigin: { source: 'local', context },
      }, true)
      for (let attempt = 0; attempt < 5 && runtime.documents.has(DOCUMENT_ID); attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      expect(runtime.documents.has(DOCUMENT_ID)).toBe(false)

      releaseFinalAuthorization()
      await expect(authenticating).rejects.toThrow('access changed during authentication')

      const replacement = await runtime.createDocument(
        DOCUMENT_ID,
        new Request('http://127.0.0.1/collaboration'),
        'post-epoch-auth-socket',
        { readOnly: false, isAuthenticated: true },
        context,
      )
      expect(replacement).not.toBe(oldDocument)
      await expect(hooks.onAuthenticate({
        token,
        documentName: DOCUMENT_ID,
        connection: { readOnly: false },
      })).resolves.toMatchObject({ documentId: DOCUMENT_ID })
    } finally {
      for (const document of runtime.documents.values()) {
        await runtime.unloadDocument(document)
      }
    }
  })

  it('rejects a ticket bumped while Hocuspocus is loading an unmapped room', async () => {
    const context = {
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    const token = mintCollabTokenV2({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor',
      tokenVersion: 2,
      readOnly: false,
    })
    const finalDrainRegistry = createCollabFinalDrainRegistry()
    let loadCalls = 0
    let signalFirstLoadStarted!: () => void
    let releaseFirstLoad!: () => void
    const firstLoadStarted = new Promise<void>((resolve) => { signalFirstLoadStarted = resolve })
    const firstLoadHeld = new Promise<void>((resolve) => { releaseFirstLoad = resolve })
    let signalReplacementConnected!: () => void
    const replacementConnected = new Promise<void>((resolve) => {
      signalReplacementConnected = resolve
    })
    const admittedFrames = jest.fn()
    let runtime!: Hocuspocus<typeof context>
    const hooks = createCollabHooks({
      verifyToken: verifyCollabToken,
      verifyTokenV2: verifyCollabTokenV2,
      authorizeContext: async () => true,
      resolveAwarenessName: async () => 'Trusted collaborator',
      resolveContainer: async () => ({
        resolve: (name: string) => name === 'em' ? {} : { indexRecordById: async () => undefined },
      }),
      loadContent: async () => {
        loadCalls += 1
        if (loadCalls === 1) {
          signalFirstLoadStarted()
          await firstLoadHeld
        }
        return {
          yjsState: null,
          contentHtml: null,
          updatedAt: '2026-07-10T10:00:00.000Z',
          collaborationGeneration: 1,
        }
      },
      initializeYjsState: async () => null,
      persistContent: async () => ({
        updatedAt: '2026-07-10T10:00:01.000Z',
        collaborationGeneration: 1,
      }),
      finalDrainRegistry,
      resolveRoomDocument: (name) => runtime.documents.get(name),
    })
    runtime = new Hocuspocus<typeof context>({
      quiet: true,
      debounce: 0,
      maxDebounce: 0,
      unloadImmediately: true,
      onAuthenticate: (data) => hooks.onAuthenticate({
        token: data.token,
        documentName: data.documentName,
        connection: data.connectionConfig,
      }),
      async onLoadDocument(data) {
        try {
          hooks.assertConnectionAuthorization(data.context)
          const document = await hooks.onLoadDocument({
            documentName: data.documentName,
            context: data.context,
            document: data.document,
          })
          hooks.assertConnectionAuthorization(data.context)
          return document
        } catch (error) {
          hooks.releaseConnectionAuthorization(data.context)
          data.document.destroy()
          throw error
        }
      },
      async afterLoadDocument(data) {
        try {
          hooks.assertConnectionAuthorization(data.context)
        } catch (error) {
          hooks.releaseConnectionAuthorization(data.context)
          data.document.destroy()
          throw error
        }
      },
      async beforeHandleMessage(data) {
        try {
          hooks.assertConnectionAuthorization(data.context)
        } catch (error) {
          data.connection.close()
          hooks.releaseConnectionAuthorization(data.context)
          throw error
        }
        admittedFrames()
      },
      async connected(data) {
        try {
          hooks.establishConnectionAuthorization(data.context)
        } catch (error) {
          data.connection.close()
          hooks.releaseConnectionAuthorization(data.context)
          throw error
        }
        signalReplacementConnected()
      },
      async onDisconnect(data) {
        hooks.releaseConnectionAuthorization(data.context)
      },
    })
    const makeSocket = () => {
      const socket = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn(() => { socket.readyState = 3 }),
      }
      return socket
    }
    const firstSocket = makeSocket()
    const replacementSocket = makeSocket()
    const firstClient = runtime.handleConnection(
      firstSocket,
      new Request('http://127.0.0.1/collaboration'),
    )
    let replacementClient: ReturnType<typeof runtime.handleConnection> | null = null

    try {
      firstClient.handleMessage(makeAuthenticationFrame(DOCUMENT_ID, token))
      firstClient.handleMessage(makeAddressedFrame(DOCUMENT_ID, MessageType.QueryAwareness))
      await firstLoadStarted
      expect(runtime.documents.has(DOCUMENT_ID)).toBe(false)

      // The trusted event has no mapped room to mark, but the active setup
      // ticket is bumped and must fail the post-load assertion.
      finalDrainRegistry.bumpAuthorization(DOCUMENT_ID, {
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
      })
      releaseFirstLoad()
      for (let attempt = 0; attempt < 10 && runtime.loadingDocuments.has(DOCUMENT_ID); attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      expect(runtime.loadingDocuments.has(DOCUMENT_ID)).toBe(false)
      expect(runtime.documents.has(DOCUMENT_ID)).toBe(false)
      expect(admittedFrames).not.toHaveBeenCalled()

      replacementClient = runtime.handleConnection(
        replacementSocket,
        new Request('http://127.0.0.1/collaboration'),
      )
      replacementClient.handleMessage(makeAuthenticationFrame(DOCUMENT_ID, token))
      await replacementConnected
      expect(runtime.documents.has(DOCUMENT_ID)).toBe(true)
      expect(runtime.documents.get(DOCUMENT_ID)?.getConnectionsCount()).toBe(1)
    } finally {
      firstClient.handleClose()
      replacementClient?.handleClose()
      for (let attempt = 0; attempt < 5 && runtime.documents.has(DOCUMENT_ID); attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      for (const document of runtime.documents.values()) {
        await runtime.unloadDocument(document)
      }
    }
  })

  it('suppresses stale room stores only when authoritative content is invalidated', () => {
    expect(resolveCollabRoomEventAction('documents.document.deleted')).toBe('invalidate')
    expect(resolveCollabRoomEventAction('documents.version.restored')).toBe('invalidate')
    expect(resolveCollabRoomEventAction('documents.document.updated', { contentEpochReset: true })).toBe('invalidate')
    expect(resolveCollabRoomEventAction('documents.document.updated', { contentEpochReset: false })).toBe('ignore')
    expect(resolveCollabRoomEventAction('documents.comment.created')).toBe('ignore')
  })

  it('requires Documents publisher provenance and trusted envelope scope for room events', () => {
    const trusted = resolveTrustedDocumentsCrossProcessEvent({
      event: 'documents.document.deleted',
      payload: {
        id: DOCUMENT_ID,
        tenantId: 'payload-controlled-tenant',
        organizationId: 'payload-controlled-org',
      },
      options: {
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        emitterModuleId: 'documents',
      },
    })

    expect(trusted).toEqual({
      action: 'invalidate',
      documentId: DOCUMENT_ID,
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    })
    expect(isTrustedDocumentsCollabRoomScope(
      trusted!,
      { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    )).toBe(true)
    expect(isTrustedDocumentsCollabRoomScope(
      trusted!,
      { tenantId: 'foreign-tenant', organizationId: ORGANIZATION_ID },
    )).toBe(false)
    expect(isTrustedDocumentsCollabRoomScope(
      trusted!,
      { tenantId: TENANT_ID, organizationId: 'foreign-organization' },
    )).toBe(false)

    expect(resolveTrustedDocumentsCrossProcessEvent({
      event: 'documents.document.deleted',
      payload: { id: DOCUMENT_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      options: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
    })).toBeNull()
    expect(resolveTrustedDocumentsCrossProcessEvent({
      event: 'documents.document.deleted',
      payload: { id: DOCUMENT_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      options: {
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        emitterModuleId: 'workflows',
      },
    })).toBeNull()
  })

  it('ignores only cross-process bridge events emitted by this sidecar process', () => {
    expect(isOwnDocumentsCrossProcessEvent({
      event: 'documents.document.updated',
      payload: { id: DOCUMENT_ID },
      originPid: process.pid,
      originInstanceId: 'sidecar-a',
    }, 'sidecar-a')).toBe(true)
    expect(isOwnDocumentsCrossProcessEvent({
      event: 'documents.document.updated',
      payload: { id: DOCUMENT_ID },
      originPid: process.pid + 1,
      originInstanceId: 'sidecar-b',
    }, 'sidecar-a')).toBe(false)
    expect(isOwnDocumentsCrossProcessEvent({
      event: 'documents.document.updated',
      payload: { id: DOCUMENT_ID },
    }, 'sidecar-a')).toBe(false)
  })

  it('decides self-origin by instance id, not pid, when both sidecars supply one', () => {
    // Containers commonly share a pid (typically 1), so the instance id must
    // win in both directions once the publisher supplies one.
    expect(isOwnDocumentsCrossProcessEvent({
      event: 'documents.document.updated',
      payload: { id: DOCUMENT_ID },
      originPid: process.pid + 1,
      originInstanceId: 'sidecar-a',
    }, 'sidecar-a')).toBe(true)
    expect(isOwnDocumentsCrossProcessEvent({
      event: 'documents.document.updated',
      payload: { id: DOCUMENT_ID },
      originPid: process.pid,
      originInstanceId: 'sidecar-b',
    }, 'sidecar-a')).toBe(false)
  })

  it('keeps a rolling-deploy envelope that omits the instance id and shares this pid', () => {
    // The publisher always stamps originInstanceId, so an envelope without one
    // is provably foreign. Containers commonly run as pid 1, so falling back to
    // the pid would drop an older replica's reauth and invalidation events for
    // the whole upgrade window.
    for (const event of ['documents.document.deleted', 'documents.share.revoked']) {
      expect(isOwnDocumentsCrossProcessEvent({
        event,
        payload: { id: DOCUMENT_ID },
        originPid: process.pid,
      }, 'sidecar-a')).toBe(false)
    }
  })

  it('uses the signed v2 readOnly claim instead of relationship tier', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-10T10:00:00.000Z') })
    const token = mintCollabTokenV2({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'owner',
      tokenVersion: 2,
      readOnly: true,
    })
    const persistContent = jest.fn(async () => ({
      updatedAt: new Date(),
      collaborationGeneration: 1,
    }))
    const hooks = createCollabHooks({
      verifyToken: verifyCollabToken,
      verifyTokenV2: verifyCollabTokenV2,
      authorizeContext: async () => true,
      resolveAwarenessName: async () => 'Trusted collaborator',
      resolveContainer: async () => ({
        resolve: (name: string) => name === 'em' ? {} : { indexRecordById: async () => undefined },
      }),
      loadContent: async () => null,
      initializeYjsState: async () => null,
      persistContent,
    })
    const connection = { readOnly: false }

    const context = await hooks.onAuthenticate({
      token,
      documentName: DOCUMENT_ID,
      connection,
    })

    expect(connection.readOnly).toBe(true)
    expect(context).toMatchObject({
      tier: 'owner',
      readOnly: true,
      exp: Math.floor(Date.now() / 1000) + 60,
    })
    await hooks.onStoreDocument({
      documentName: DOCUMENT_ID,
      context,
      document: new Y.Doc(),
    })
    expect(persistContent).not.toHaveBeenCalled()
  })

  it('rejects replay of a still-signed token after authoritative share revocation', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-10T10:00:00.000Z') })
    const token = mintCollabTokenV2({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor',
      tokenVersion: 2,
      readOnly: false,
    })
    let authorized = true
    const hooks = createCollabHooks({
      verifyToken: verifyCollabToken,
      verifyTokenV2: verifyCollabTokenV2,
      authorizeContext: async () => authorized,
      resolveAwarenessName: async () => 'Trusted collaborator',
      resolveContainer: async () => ({ resolve: () => ({}) }),
      loadContent: async () => null,
      initializeYjsState: async () => null,
      persistContent: async () => ({
        updatedAt: new Date(),
        collaborationGeneration: 1,
      }),
    })

    await expect(hooks.onAuthenticate({
      token,
      documentName: DOCUMENT_ID,
      connection: { readOnly: false },
    })).resolves.toMatchObject({ tier: 'editor', readOnly: false })

    authorized = false
    await expect(hooks.onAuthenticate({
      token,
      documentName: DOCUMENT_ID,
      connection: { readOnly: false },
    })).rejects.toThrow('stale or revoked token')
  })

  it('rejects downgraded capabilities and preserves wildcard manager access', () => {
    const editorContext = {
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor' as const,
      readOnly: false,
      exp: null,
    }
    expect(isCollabAuthorizationCurrent(editorContext, {
      relationshipTier: 'viewer',
      isSuperAdmin: false,
      features: ['documents.view', 'documents.edit'],
      organizations: [ORGANIZATION_ID],
    })).toBe(false)
    expect(isCollabAuthorizationCurrent({
      ...editorContext,
      tier: 'owner',
    }, {
      relationshipTier: null,
      isSuperAdmin: false,
      features: ['documents.*'],
      organizations: [ORGANIZATION_ID],
    })).toBe(true)
    expect(isCollabAuthorizationCurrent(editorContext, {
      relationshipTier: 'editor',
      isSuperAdmin: false,
      features: ['documents.view', 'documents.edit'],
      organizations: ['55555555-5555-4555-8555-555555555555'],
    })).toBe(false)
    expect(isCollabAuthorizationCurrent(editorContext, {
      relationshipTier: 'editor',
      isSuperAdmin: false,
      features: ['documents.view', 'documents.edit'],
      organizations: ['55555555-5555-4555-8555-555555555555'],
      organizationScope: {
        selectedId: ORGANIZATION_ID,
        allowedIds: ['55555555-5555-4555-8555-555555555555', ORGANIZATION_ID],
      },
    })).toBe(true)
  })

  it('expires only the connected socket and clears its timer on close', () => {
    jest.useFakeTimers({ now: new Date('2026-07-10T10:00:00.000Z') })
    const closeCallbacks: Array<() => void> = []
    const firstConnection = {
      close: jest.fn(),
      onClose: jest.fn((callback: () => void) => closeCallbacks.push(callback)),
    }
    const secondConnection = {
      close: jest.fn(),
      onClose: jest.fn(),
    }

    scheduleCollabConnectionExpiry(firstConnection, Math.floor(Date.now() / 1000) + 60)
    scheduleCollabConnectionExpiry(secondConnection, Math.floor(Date.now() / 1000) + 120)
    jest.advanceTimersByTime(60_000)

    expect(firstConnection.close).toHaveBeenCalledTimes(1)
    expect(secondConnection.close).not.toHaveBeenCalled()

    const cleanupConnection = {
      close: jest.fn(),
      onClose: jest.fn((callback: () => void) => closeCallbacks.push(callback)),
    }
    scheduleCollabConnectionExpiry(cleanupConnection, Math.floor(Date.now() / 1000) + 60)
    closeCallbacks.at(-1)?.()
    jest.advanceTimersByTime(60_000)
    expect(cleanupConnection.close).not.toHaveBeenCalled()
  })

  it('serves the exact no-store v2 readiness contract', () => {
    const { response, headers, end } = makeHealthResponse()

    expect(handleCollabHealthRequest({ method: 'GET', url: '/healthz' }, response)).toBe(true)
    expect(response.statusCode).toBe(200)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Cache-Control')).toBe('no-store')
    expect(end).toHaveBeenCalledWith(JSON.stringify({
      status: 'ok',
      service: 'documents-collab',
      capabilityTokenVersion: 2,
    }))
  })

  it('reports a stable unavailable contract when the v2 secret is missing', () => {
    delete process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2
    const { response, headers, end } = makeHealthResponse()

    expect(handleCollabHealthRequest({ method: 'GET', url: '/healthz' }, response)).toBe(true)
    expect(response.statusCode).toBe(503)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Cache-Control')).toBe('no-store')
    expect(end).toHaveBeenCalledWith(JSON.stringify({
      status: 'unavailable',
      service: 'documents-collab',
      capabilityTokenVersion: 2,
    }))
  })

  it('reports unavailable when the v2 secret is shorter than 32 UTF-8 bytes', () => {
    process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2 = 'weak-v2-secret'
    const { response, headers, end } = makeHealthResponse()

    expect(handleCollabHealthRequest({ method: 'GET', url: '/healthz' }, response)).toBe(true)
    expect(response.statusCode).toBe(503)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Cache-Control')).toBe('no-store')
    expect(end).toHaveBeenCalledWith(JSON.stringify({
      status: 'unavailable',
      service: 'documents-collab',
      capabilityTokenVersion: 2,
    }))
  })

  it('reports unavailable when v2 reuses the explicitly configured v1 secret', () => {
    const reusedSecret = 'reused-collab-secret-at-least-32-bytes'
    process.env.DOCUMENTS_COLLAB_JWT_SECRET_V2 = reusedSecret
    const token = mintCollabTokenV2({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor',
      tokenVersion: 2,
      readOnly: false,
    })
    process.env.DOCUMENTS_COLLAB_JWT_SECRET = reusedSecret
    const { response, end } = makeHealthResponse()

    expect(handleCollabHealthRequest({ method: 'GET', url: '/healthz' }, response)).toBe(true)
    expect(response.statusCode).toBe(503)
    expect(end).toHaveBeenCalledWith(JSON.stringify({
      status: 'unavailable',
      service: 'documents-collab',
      capabilityTokenVersion: 2,
    }))
    expect(verifyCollabTokenV2(token)).toBeNull()
    expect(() => mintCollabTokenV2({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor',
      tokenVersion: 2,
      readOnly: false,
    })).toThrow('DOCUMENTS_COLLAB_JWT_SECRET_V2')
  })

  it('rejects handled health requests before the default welcome response', async () => {
    const health = makeHealthResponse()
    await expect(handleCollabServerRequest({
      request: { method: 'GET', url: '/healthz' },
      response: health.response,
    })).rejects.toBeUndefined()

    const normal = makeHealthResponse()
    await expect(handleCollabServerRequest({
      request: { method: 'GET', url: '/' },
      response: normal.response,
    })).resolves.toBeUndefined()
    expect(normal.end).not.toHaveBeenCalled()
  })

  it('returns method not allowed for non-GET health checks', () => {
    const { response, headers, end } = makeHealthResponse()

    expect(handleCollabHealthRequest({ method: 'POST', url: '/healthz' }, response)).toBe(true)
    expect(response.statusCode).toBe(405)
    expect(headers.get('Allow')).toBe('GET')
    expect(end).toHaveBeenCalledWith()
  })
})

describe('documents collaboration read-only lastContext store fallback', () => {
  const VIEWER_USER_ID = '55555555-5555-4555-8555-555555555555'
  const editorContext = {
    userId: USER_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    documentId: DOCUMENT_ID,
    tier: 'editor' as const,
    readOnly: false,
    exp: null,
  }
  const viewerContext = {
    ...editorContext,
    userId: VIEWER_USER_ID,
    tier: 'viewer' as const,
    readOnly: true,
  }

  function makeStoreHooks() {
    const persistContent = jest.fn(async () => ({
      updatedAt: '2026-07-10T10:00:01.000Z',
      collaborationGeneration: 1,
    }))
    const authorizeContext = jest.fn(async () => true)
    const hooks = createCollabHooks({
      verifyToken: () => null,
      authorizeContext,
      resolveContainer: async () => ({ resolve: () => ({}) }),
      loadContent: async () => ({
        yjsState: null,
        contentHtml: null,
        updatedAt: '2026-07-10T10:00:00.000Z',
        collaborationGeneration: 1,
      }),
      initializeYjsState: async () => null,
      persistContent,
      allowedOrigins: null,
    })
    return { hooks, persistContent, authorizeContext }
  }

  it('persists editor-authored edits when a viewer is the last-seen store context', async () => {
    const { hooks, persistContent, authorizeContext } = makeStoreHooks()
    const document = new Y.Doc()

    await hooks.onLoadDocument({ documentName: DOCUMENT_ID, context: editorContext, document })
    document.getMap('edits').set('body', 'editor change')
    await hooks.onStoreDocument({ documentName: DOCUMENT_ID, context: viewerContext, document })

    expect(persistContent).toHaveBeenCalledTimes(1)
    const call = persistContent.mock.calls[0] as unknown[]
    expect(call[2]).toEqual({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
    expect(Buffer.isBuffer((call[3] as { yjsState: unknown }).yjsState)).toBe(true)
    expect(authorizeContext).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      tier: 'editor',
      readOnly: false,
    }))
  })

  it('keeps skipping the store for a room that never had a writable context', async () => {
    const { hooks, persistContent, authorizeContext } = makeStoreHooks()
    const document = new Y.Doc()

    await hooks.onLoadDocument({ documentName: DOCUMENT_ID, context: viewerContext, document })
    await hooks.onStoreDocument({ documentName: DOCUMENT_ID, context: viewerContext, document })

    expect(persistContent).not.toHaveBeenCalled()
    expect(authorizeContext).not.toHaveBeenCalled()
  })

  it('refreshes the remembered writable context from writable sync frames', async () => {
    const { hooks, persistContent, authorizeContext } = makeStoreHooks()
    const document = new Y.Doc()

    await hooks.onLoadDocument({ documentName: DOCUMENT_ID, context: viewerContext, document })
    await hooks.beforeSync({
      type: 2,
      payload: new Uint8Array([0]),
      document,
      connection: { readOnly: false },
      context: editorContext,
    })
    await hooks.onStoreDocument({ documentName: DOCUMENT_ID, context: viewerContext, document })

    expect(persistContent).toHaveBeenCalledTimes(1)
    expect(authorizeContext).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      readOnly: false,
    }))
  })

  it('persists a Redis-fanned edit from the authenticated source when the receiver races first', async () => {
    const source = makeStoreHooks()
    const receiver = makeStoreHooks()
    const sourceDocument = new Y.Doc()
    const receiverDocument = new Y.Doc()
    await source.hooks.onLoadDocument({
      documentName: DOCUMENT_ID,
      context: editorContext,
      document: sourceDocument,
    })
    await receiver.hooks.onLoadDocument({
      documentName: DOCUMENT_ID,
      context: viewerContext,
      document: receiverDocument,
    })
    sourceDocument.getMap('edits').set('body', 'source replica edit')
    Y.applyUpdate(
      receiverDocument,
      Y.encodeStateAsUpdate(sourceDocument),
      { source: 'redis' },
    )

    const lockAttempts: string[] = []
    const makeExtension = (replica: string) => enforceDocumentsCollabSourceStoreOwnership({
      async onStoreDocument(_payload: onStoreDocumentPayload) {
        lockAttempts.push(replica)
      },
    })
    const receiverPayload = {
      lastTransactionOrigin: { source: 'redis' },
    } as onStoreDocumentPayload
    const sourcePayload = {
      lastTransactionOrigin: { source: 'connection', connection: {} },
    } as onStoreDocumentPayload

    // Force the unsafe ordering: the receiver reaches the Redis extension
    // before the authenticated source. The receiver must neither lock nor run
    // the database hook; the source then persists the exact fanned-out edit.
    await makeExtension('receiver').onStoreDocument(receiverPayload)
    if (isDocumentsCollabSourceStore(receiverPayload)) {
      await receiver.hooks.onStoreDocument({
        documentName: DOCUMENT_ID,
        context: {} as typeof viewerContext,
        document: receiverDocument,
      })
    }
    await makeExtension('source').onStoreDocument(sourcePayload)
    if (isDocumentsCollabSourceStore(sourcePayload)) {
      await source.hooks.onStoreDocument({
        documentName: DOCUMENT_ID,
        context: editorContext,
        document: sourceDocument,
      })
    }

    expect(lockAttempts).toEqual(['source'])
    expect(receiver.persistContent).not.toHaveBeenCalled()
    expect(source.persistContent).toHaveBeenCalledTimes(1)
    const persistedInput = source.persistContent.mock.calls[0]?.[3] as {
      yjsState: Buffer
    }
    const durableDocument = new Y.Doc()
    Y.applyUpdate(durableDocument, new Uint8Array(persistedInput.yjsState))
    expect(durableDocument.getMap('edits').get('body')).toBe('source replica edit')
  })
})
