import { HocuspocusProvider } from '@hocuspocus/provider'
import { Server } from '@hocuspocus/server'
import { Pool } from 'pg'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import * as Y from 'yjs'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  createCollabHooks,
  DocumentsCollabRedisExtension,
  enforceDocumentsCollabSourceStoreOwnership,
  isDocumentsCollabSourceStore,
  resolveDocumentsCollabRedisConfiguration,
  type CollabContext,
  type CollabHooksDeps,
} from '../../../../server/documents-collab-server'
import { mintCollabToken, verifyCollabToken } from '../lib/collabToken'
import { DOCUMENTS_MAX_YJS_STATE_BYTES } from '../lib/resourceLimits'

const describeWithDocker = process.env.OM_DOCUMENTS_MULTI_INSTANCE_INTEGRATION === '1'
  ? describe
  : describe.skip

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '44444444-4444-4444-8444-444444444444'
const SECOND_USER_ID = '55555555-5555-4555-8555-555555555555'
const BASE_VERSION_TIME = Date.parse('2026-07-14T10:00:00.000Z')

function versionTimestamp(version: number): string {
  return new Date(BASE_VERSION_TIME + version).toISOString()
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

function createProvider(url: string, document: Y.Doc, token: string, documentName = DOCUMENT_ID): {
  provider: HocuspocusProvider
  synced: Promise<void>
} {
  let provider!: HocuspocusProvider
  const synced = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out syncing provider ${url}`)), 10_000)
    provider = new HocuspocusProvider({
      url,
      name: documentName,
      document,
      token,
      onSynced: ({ state }) => {
        if (!state) return
        clearTimeout(timeout)
        resolve()
      },
    })
  })
  return { provider, synced }
}

describeWithDocker('documents collaboration real multi-instance durability', () => {
  let redis: StartedTestContainer | null = null
  let postgres: StartedTestContainer | null = null
  let pool: Pool | null = null
  let firstServer: Server<CollabContext> | null = null
  let secondServer: Server<CollabContext> | null = null
  let firstProvider: HocuspocusProvider | null = null
  let secondProvider: HocuspocusProvider | null = null
  let reloadProvider: HocuspocusProvider | null = null
  const firstDocument = new Y.Doc()
  const secondDocument = new Y.Doc()
  const reloadDocument = new Y.Doc()
  let holdNextPersist = false
  let releaseFirstPersist = (): void => undefined
  let firstPersistAllowed = Promise.resolve()
  let resolveLockContention = (): void => undefined
  let lockContentionObserved = Promise.resolve()
  let lockContentionCount = 0
  let firstPersistedKeys: string[] = []
  const revokedUsers = new Set<string>()
  const rejectedAggregateDocuments: string[] = []
  let heldLoadDocumentId: string | null = null
  let releaseHeldLoad = (): void => undefined
  let heldLoadAllowed = Promise.resolve()
  let signalHeldLoadStarted = (): void => undefined
  let heldLoadStarted = Promise.resolve()
  let observedPublishedDocumentId: string | null = null
  let signalPersistedPublish = (): void => undefined
  let persistedPublishObserved = Promise.resolve()

  beforeAll(async () => {
    process.env.JWT_SECRET = 'documents-real-multi-instance-test-secret'
    ;[redis, postgres] = await Promise.all([
      new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
        .start(),
      new GenericContainer('postgres:16')
        .withEnvironment({
          POSTGRES_DB: 'documents_test',
          POSTGRES_USER: 'documents',
          POSTGRES_PASSWORD: 'documents',
        })
        .withExposedPorts(5432)
        .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
        .start(),
    ])

    pool = new Pool({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      database: 'documents_test',
      user: 'documents',
      password: 'documents',
    })
    await pool.query(`
      CREATE TABLE document_content (
        document_id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        organization_id uuid NOT NULL,
        yjs_state bytea NOT NULL,
        version integer NOT NULL
      )
    `)
    await pool.query(
      `INSERT INTO document_content
        (document_id, tenant_id, organization_id, yjs_state, version)
       VALUES ($1, $2, $3, $4, 0)`,
      [DOCUMENT_ID, TENANT_ID, ORGANIZATION_ID, Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()))],
    )

    const loadContent: CollabHooksDeps['loadContent'] = async (_em, documentId, scope) => {
      const result = await pool!.query<{
        yjs_state: Buffer
        version: number
      }>(
        `SELECT yjs_state, version
           FROM document_content
          WHERE document_id = $1 AND tenant_id = $2 AND organization_id = $3`,
        [documentId, scope.tenantId, scope.organizationId],
      )
      if (heldLoadDocumentId === documentId) {
        heldLoadDocumentId = null
        signalHeldLoadStarted()
        await heldLoadAllowed
      }
      const row = result.rows[0]
      return row
        ? {
            yjsState: row.yjs_state,
            contentHtml: null,
            updatedAt: versionTimestamp(row.version),
            collaborationGeneration: 1,
          }
        : null
    }
    const persistContent: CollabHooksDeps['persistContent'] = async (
      _em,
      documentId,
      scope,
      input,
      deps,
    ) => {
      if (holdNextPersist) {
        holdNextPersist = false
        const snapshot = new Y.Doc()
        Y.applyUpdate(snapshot, new Uint8Array(input.yjsState))
        firstPersistedKeys = Array.from(snapshot.getMap('multi-instance').keys()).sort()
        snapshot.destroy()
        await firstPersistAllowed
      }
      const result = await pool!.query<{ version: number }>(
        `UPDATE document_content
            SET yjs_state = $1, version = version + 1
          WHERE document_id = $2
            AND tenant_id = $3
            AND organization_id = $4
            AND version = $5
        RETURNING version`,
        [
          input.yjsState,
          documentId,
          scope.tenantId,
          scope.organizationId,
          Date.parse(deps.expectedUpdatedAt) - BASE_VERSION_TIME,
        ],
      )
      const row = result.rows[0]
      if (!row) {
        throw new CrudHttpError(409, {
          error: 'Record changed by another user',
          code: OPTIMISTIC_LOCK_CONFLICT_CODE,
        })
      }
      return { updatedAt: versionTimestamp(row.version), collaborationGeneration: 1 }
    }
    const redisEnvironment = {
      NODE_ENV: 'test',
      DOCUMENTS_COLLAB_REDIS_URL: `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`,
      DOCUMENTS_COLLAB_REDIS_PREFIX: `open-mercato:documents:test:${Date.now()}`,
    }
    const redisConfiguration = resolveDocumentsCollabRedisConfiguration(redisEnvironment)
    if (!redisConfiguration) throw new Error('Real Redis configuration was not resolved')

    const createServer = (): Server<CollabContext> => {
      let server!: Server<CollabContext>
      let redisExtension!: DocumentsCollabRedisExtension
      const invalidatedDocuments = new WeakSet<Y.Doc>()
      const invalidateRoom = (documentName: string, document: Y.Doc): void => {
        invalidatedDocuments.add(document)
        server?.hocuspocus.closeConnections(documentName)
      }
      const hooks = createCollabHooks({
        verifyToken: (candidate) => verifyCollabToken(candidate),
        authorizeContext: async (context) => !revokedUsers.has(context.userId),
        resolveAwarenessName: async () => 'Multi-instance editor',
        resolveContainer: async () => ({
          resolve: (name: string) => (name === 'em' ? {} : { indexRecordById: async () => undefined }),
        }),
        loadContent,
        initializeYjsState: async () => null,
        persistContent,
        onPersisted: (document, yjsState, collaborationGeneration) => {
          redisExtension.markPersisted(document, yjsState, collaborationGeneration)
        },
        allowedOrigins: null,
        requireOrigin: false,
        resolveRoomDocument: (documentName) => server.hocuspocus.documents.get(documentName),
        isRoomInvalidated: (_documentName, document) => Boolean(
          document && invalidatedDocuments.has(document),
        ),
        invalidateRoom,
      })
      redisExtension = new DocumentsCollabRedisExtension(redisConfiguration, {
        resolveCollaborationGeneration: hooks.resolveCollaborationGeneration,
        onAcceptedAggregate: (document, byteLength) => {
          hooks.recordRedisAggregate(document, byteLength)
        },
        onRejectedAggregate: (documentName, document) => {
          rejectedAggregateDocuments.push(documentName)
          invalidateRoom(documentName, document)
        },
      })
      const acquireStoreLock = redisExtension.onStoreDocument.bind(redisExtension)
      redisExtension.onStoreDocument = async (data) => {
        try {
          return await acquireStoreLock(data)
        } catch (error) {
          if (error instanceof Error && error.name === 'SkipFurtherHooksError') {
            lockContentionCount += 1
            resolveLockContention()
          }
          throw error
        }
      }
      const publishPersistedState = redisExtension.afterStoreDocument.bind(redisExtension)
      redisExtension.afterStoreDocument = async (data) => {
        await publishPersistedState(data)
        if (data.documentName === observedPublishedDocumentId) {
          signalPersistedPublish()
        }
      }

      server = new Server<CollabContext>({
        port: 0,
        address: '127.0.0.1',
        quiet: true,
        stopOnSignals: false,
        debounce: 25,
        maxDebounce: 100,
        extensions: [enforceDocumentsCollabSourceStoreOwnership(redisExtension)],
        onAuthenticate: async (data) => hooks.onAuthenticate({
          token: data.token,
          documentName: data.documentName,
          connection: data.connectionConfig,
        }),
        connected: async (data) => hooks.establishConnectionAuthorization(data.context),
        beforeSync: async (data) => hooks.beforeSync({
          type: data.type,
          payload: data.payload,
          document: data.document,
          connection: data.connection,
          context: data.context,
        }),
        onLoadDocument: async (data) => hooks.onLoadDocument({
          documentName: data.documentName,
          context: data.context,
          document: data.document,
        }),
        onStoreDocument: async (data) => {
          if (!isDocumentsCollabSourceStore(data)) return
          await hooks.onStoreDocument({
            documentName: data.documentName,
            context: data.lastContext,
            document: data.document,
          })
        },
        onDisconnect: async (data) => hooks.releaseConnectionAuthorization(data.context),
      })
      return server
    }

    firstServer = createServer()
    secondServer = createServer()
    await Promise.all([firstServer.listen(), secondServer.listen()])
  }, 120_000)

  afterAll(async () => {
    firstProvider?.destroy()
    secondProvider?.destroy()
    reloadProvider?.destroy()
    firstDocument.destroy()
    secondDocument.destroy()
    reloadDocument.destroy()
    await Promise.allSettled([
      firstServer?.destroy(),
      secondServer?.destroy(),
      pool?.end(),
    ])
    await Promise.allSettled([
      redis?.stop(),
      postgres?.stop(),
    ])
  }, 30_000)

  it('retries a contended source store and reloads the concurrent merge from PostgreSQL', async () => {
    const token = mintCollabToken({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId: DOCUMENT_ID,
      tier: 'editor',
    })
    const first = createProvider(firstServer!.webSocketURL, firstDocument, token)
    const second = createProvider(secondServer!.webSocketURL, secondDocument, token)
    firstProvider = first.provider
    secondProvider = second.provider
    await Promise.all([first.synced, second.synced])

    holdNextPersist = true
    firstPersistAllowed = new Promise<void>((resolve) => {
      releaseFirstPersist = resolve
    })
    lockContentionObserved = new Promise<void>((resolve) => {
      resolveLockContention = resolve
    })

    // Durable-state fanout never publishes either write before its source
    // store succeeds. Hold the first database snapshot under the Redis lock so
    // the other authenticated source deterministically loses that lock.
    firstDocument.getMap('multi-instance').set('first', 'A')
    secondDocument.getMap('multi-instance').set('second', 'B')
    expect(firstDocument.getMap('multi-instance').get('second')).toBeUndefined()
    expect(secondDocument.getMap('multi-instance').get('first')).toBeUndefined()

    try {
      await waitFor(
        async () => {
          await Promise.race([
            lockContentionObserved,
            new Promise((resolve) => setTimeout(resolve, 25)),
          ])
          return lockContentionCount > 0
        },
        'The two authenticated source stores did not contend for the Redis lock',
      )
      expect(firstPersistedKeys).toHaveLength(1)
    } finally {
      // Always release the test-only gates so failed assertions cannot strand
      // the sidecar destroy hooks behind an intentionally blocked store.
      releaseFirstPersist()
    }

    await waitFor(
      () => (
        firstDocument.getMap('multi-instance').get('first') === 'A'
        && firstDocument.getMap('multi-instance').get('second') === 'B'
        && secondDocument.getMap('multi-instance').get('first') === 'A'
        && secondDocument.getMap('multi-instance').get('second') === 'B'
      ),
      'Redis did not converge the concurrent edits on both sidecars',
    )

    firstProvider.destroy()
    secondProvider.destroy()
    firstProvider = null
    secondProvider = null
    await waitFor(
      () => (
        !firstServer!.hocuspocus.documents.has(DOCUMENT_ID)
        && !secondServer!.hocuspocus.documents.has(DOCUMENT_ID)
      ),
      'The sidecars did not unload the converged in-memory rooms',
      20_000,
    )

    const durableResult = await pool!.query<{ yjs_state: Buffer; version: number }>(
      'SELECT yjs_state, version FROM document_content WHERE document_id = $1',
      [DOCUMENT_ID],
    )
    const durable = new Y.Doc()
    Y.applyUpdate(durable, new Uint8Array(durableResult.rows[0].yjs_state))
    expect(durable.getMap('multi-instance').toJSON()).toEqual({ first: 'A', second: 'B' })
    expect(durableResult.rows[0].version).toBeGreaterThanOrEqual(2)
    durable.destroy()

    const reloaded = createProvider(firstServer!.webSocketURL, reloadDocument, token)
    reloadProvider = reloaded.provider
    await reloaded.synced
    expect(reloadDocument.getMap('multi-instance').toJSON()).toEqual({ first: 'A', second: 'B' })
  }, 45_000)

  it('rejects a revoked source edit before an authorized replica can persist it', async () => {
    const documentId = '66666666-6666-4666-8666-666666666666'
    await pool!.query(
      `INSERT INTO document_content
        (document_id, tenant_id, organization_id, yjs_state, version)
       VALUES ($1, $2, $3, $4, 0)`,
      [documentId, TENANT_ID, ORGANIZATION_ID, Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()))],
    )
    const revokedDocument = new Y.Doc()
    const authorizedDocument = new Y.Doc()
    const revokedToken = mintCollabToken({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId,
      tier: 'editor',
    })
    const authorizedToken = mintCollabToken({
      userId: SECOND_USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId,
      tier: 'editor',
    })
    const revoked = createProvider(
      firstServer!.webSocketURL,
      revokedDocument,
      revokedToken,
      documentId,
    )
    const authorized = createProvider(
      secondServer!.webSocketURL,
      authorizedDocument,
      authorizedToken,
      documentId,
    )

    try {
      await Promise.all([revoked.synced, authorized.synced])
      revokedUsers.add(USER_ID)
      revokedDocument.getMap('revocation').set('revoked', 'A')
      authorizedDocument.getMap('revocation').set('authorized', 'B')

      await waitFor(async () => {
        const result = await pool!.query<{ yjs_state: Buffer }>(
          'SELECT yjs_state FROM document_content WHERE document_id = $1',
          [documentId],
        )
        const durable = new Y.Doc()
        Y.applyUpdate(durable, new Uint8Array(result.rows[0].yjs_state))
        const stored = durable.getMap('revocation').toJSON()
        durable.destroy()
        return stored.authorized === 'B'
      }, 'The authorized replica edit did not become durable')

      const result = await pool!.query<{ yjs_state: Buffer }>(
        'SELECT yjs_state FROM document_content WHERE document_id = $1',
        [documentId],
      )
      const durable = new Y.Doc()
      Y.applyUpdate(durable, new Uint8Array(result.rows[0].yjs_state))
      expect(durable.getMap('revocation').toJSON()).toEqual({ authorized: 'B' })
      expect(authorizedDocument.getMap('revocation').get('revoked')).toBeUndefined()
      durable.destroy()
    } finally {
      revokedUsers.delete(USER_ID)
      revoked.provider.destroy()
      authorized.provider.destroy()
      revokedDocument.destroy()
      authorizedDocument.destroy()
    }
  }, 30_000)

  it('captures a durable publish that races a replica database load', async () => {
    const documentId = '88888888-8888-4888-8888-888888888888'
    await pool!.query(
      `INSERT INTO document_content
        (document_id, tenant_id, organization_id, yjs_state, version)
       VALUES ($1, $2, $3, $4, 0)`,
      [documentId, TENANT_ID, ORGANIZATION_ID, Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()))],
    )
    const sourceDocument = new Y.Doc()
    const loadingDocument = new Y.Doc()
    const token = mintCollabToken({
      userId: USER_ID,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      documentId,
      tier: 'editor',
    })
    const source = createProvider(
      firstServer!.webSocketURL,
      sourceDocument,
      token,
      documentId,
    )
    let loading: ReturnType<typeof createProvider> | null = null

    try {
      await source.synced
      heldLoadStarted = new Promise<void>((resolve) => {
        signalHeldLoadStarted = resolve
      })
      heldLoadAllowed = new Promise<void>((resolve) => {
        releaseHeldLoad = resolve
      })
      persistedPublishObserved = new Promise<void>((resolve) => {
        signalPersistedPublish = resolve
      })
      heldLoadDocumentId = documentId
      observedPublishedDocumentId = documentId

      loading = createProvider(
        secondServer!.webSocketURL,
        loadingDocument,
        token,
        documentId,
      )
      await heldLoadStarted

      // The receiving replica has already read version 0 but is deliberately
      // paused before returning it. The source now persists version 1 and
      // publishes it while the receiver is subscribed but not yet registered
      // in Hocuspocus.instance.documents.
      sourceDocument.getMap('load-race').set('durable', 'captured')
      await persistedPublishObserved
      releaseHeldLoad()
      await loading.synced

      await waitFor(
        () => loadingDocument.getMap('load-race').get('durable') === 'captured',
        'The loading replica missed the durable Redis publish',
      )
    } finally {
      heldLoadDocumentId = null
      observedPublishedDocumentId = null
      releaseHeldLoad()
      source.provider.destroy()
      loading?.provider.destroy()
      sourceDocument.destroy()
      loadingDocument.destroy()
    }
  }, 30_000)

  it('rejects an over-limit aggregate before Redis exposes or persists the union', async () => {
    const documentId = '77777777-7777-4777-8777-777777777777'
    await pool!.query(
      `INSERT INTO document_content
        (document_id, tenant_id, organization_id, yjs_state, version)
       VALUES ($1, $2, $3, $4, 0)`,
      [documentId, TENANT_ID, ORGANIZATION_ID, Buffer.from(Y.encodeStateAsUpdate(new Y.Doc()))],
    )
    const firstLarge = new Y.Doc()
    const secondLarge = new Y.Doc()
    const first = createProvider(
      firstServer!.webSocketURL,
      firstLarge,
      mintCollabToken({
        userId: USER_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        documentId,
        tier: 'editor',
      }),
      documentId,
    )
    const second = createProvider(
      secondServer!.webSocketURL,
      secondLarge,
      mintCollabToken({
        userId: SECOND_USER_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        documentId,
        tier: 'editor',
      }),
      documentId,
    )

    try {
      await Promise.all([first.synced, second.synced])
      holdNextPersist = true
      firstPersistAllowed = new Promise<void>((resolve) => {
        releaseFirstPersist = resolve
      })
      const contentionBefore = lockContentionCount
      lockContentionObserved = new Promise<void>((resolve) => {
        resolveLockContention = resolve
      })

      firstLarge.getText('first-large').insert(0, 'a'.repeat(4_300_000))
      secondLarge.getText('second-large').insert(0, 'b'.repeat(4_300_000))
      expect(Y.encodeStateAsUpdate(firstLarge).byteLength)
        .toBeLessThan(DOCUMENTS_MAX_YJS_STATE_BYTES)
      expect(Y.encodeStateAsUpdate(secondLarge).byteLength)
        .toBeLessThan(DOCUMENTS_MAX_YJS_STATE_BYTES)

      try {
        await waitFor(
          async () => {
            await Promise.race([
              lockContentionObserved,
              new Promise((resolve) => setTimeout(resolve, 25)),
            ])
            return lockContentionCount > contentionBefore
          },
          'The under-limit source stores did not contend for the Redis lock',
        )
      } finally {
        releaseFirstPersist()
      }

      await waitFor(
        () => rejectedAggregateDocuments.includes(documentId),
        'Redis did not reject the over-limit aggregate before applying it',
      )

      const result = await pool!.query<{ yjs_state: Buffer }>(
        'SELECT yjs_state FROM document_content WHERE document_id = $1',
        [documentId],
      )
      expect(result.rows[0].yjs_state.byteLength).toBeLessThan(DOCUMENTS_MAX_YJS_STATE_BYTES)
      const durable = new Y.Doc()
      Y.applyUpdate(durable, new Uint8Array(result.rows[0].yjs_state))
      const durableTextKeys = ['first-large', 'second-large']
        .filter((key) => durable.getText(key).length > 0)
      expect(durableTextKeys).toHaveLength(1)
      durable.destroy()
    } finally {
      releaseFirstPersist()
      first.provider.destroy()
      second.provider.destroy()
      firstLarge.destroy()
      secondLarge.destroy()
    }
  }, 45_000)
})
