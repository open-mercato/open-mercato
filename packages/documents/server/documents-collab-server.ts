import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import {
  Connection as HocuspocusConnection,
  IncomingMessage as HocuspocusIncomingMessage,
  MessageReceiver as HocuspocusMessageReceiver,
  MessageType,
  OutgoingMessage as HocuspocusOutgoingMessage,
} from '@hocuspocus/server'
import { Redis as HocuspocusRedis } from '@hocuspocus/extension-redis'
import type {
  afterLoadDocumentPayload,
  afterStoreDocumentPayload,
  afterUnloadDocumentPayload,
  beforeHandleAwarenessPayload,
  beforeHandleMessagePayload,
  beforeSyncPayload,
  connectedPayload,
  onAuthenticatePayload,
  onDisconnectPayload,
  onLoadDocumentPayload,
  onChangePayload,
  onRequestPayload,
  onStoreDocumentPayload,
  Server as HocuspocusServer,
} from '@hocuspocus/server'
import * as Y from 'yjs'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  COLLAB_TOKEN_CLOCK_SKEW_SECONDS,
  COLLAB_TOKEN_TTL_SECONDS,
  isCollabTokenV2Ready,
  resolveLegacyCollabTokenVerifier,
  verifyCollabTokenV2,
  type CollabTokenClaims,
  type VerifiedCollabTokenV2Claims,
} from '@open-mercato/documents/modules/documents/lib/collabToken'
import {
  advanceDocumentCollaborationGeneration,
  loadDocumentCollaborationGeneration,
  loadDocumentContentForCollaboration,
  normalizeDocumentCollaborationGeneration,
  persistDocumentContent,
  type PersistDocumentContentDeps,
} from '@open-mercato/documents/modules/documents/lib/contentService'
import {
  htmlToYDoc,
  yDocToContent,
} from '@open-mercato/documents/modules/documents/lib/collabMaterializer'
import { Document, DocumentContent } from '@open-mercato/documents/modules/documents/data/entities'
import { deriveDocumentCapabilities } from '@open-mercato/documents/modules/documents/lib/capabilities'
import { resolveUserAccess } from '@open-mercato/documents/modules/documents/lib/permissions'
import { resolveUserLabels } from '@open-mercato/documents/modules/documents/lib/userLabels'
import { resolveOrganizationScopeService } from '@open-mercato/documents/modules/documents/lib/platformServices'
import {
  hasResolvedDocumentsOrganizationAccess,
  type ResolvedDocumentsOrganizationScope,
} from '@open-mercato/documents/modules/documents/lib/organizationAccess'
import {
  createCanonicalCollaborationAwarenessUser,
  type CanonicalCollaborationAwarenessUser,
} from '@open-mercato/documents/modules/documents/lib/collaborationAwareness'
import {
  assertDocumentContentResourceLimits,
  assertDocumentYjsStateByteLength,
  DOCUMENTS_COLLAB_MAX_PAYLOAD_BYTES,
} from '@open-mercato/documents/modules/documents/lib/resourceLimits'

export { htmlToYDoc, yDocToContent }

const logger = createLogger('documents-collab')

const MAX_COLLAB_STORE_ATTEMPTS = 4
export const DOCUMENTS_COLLAB_MAX_AWARENESS_STATE_BYTES = 8 * 1024
export const DOCUMENTS_COLLAB_MAX_AWARENESS_CLIENT_IDS_PER_CONNECTION = 1
export const DOCUMENTS_COLLAB_MAX_AWARENESS_CLIENT_IDS_PER_ROOM = 256
const MAX_YJS_CLIENT_ID = 0xffff_ffff
export const COLLAB_SERVER_TRANSPORT_OPTIONS = {
  maxPayload: DOCUMENTS_COLLAB_MAX_PAYLOAD_BYTES,
} as const
export const DOCUMENTS_COLLAB_MAX_PENDING_MESSAGES = 128
export const DOCUMENTS_COLLAB_MAX_PENDING_BYTES = DOCUMENTS_COLLAB_MAX_PAYLOAD_BYTES * 2
export const DOCUMENTS_COLLAB_MAX_PENDING_DOCUMENTS = 32
export const DOCUMENTS_COLLAB_MAX_AWARENESS_FRAME_BYTES = 32 * 1024
export const DOCUMENTS_COLLAB_MAX_CONTROL_FRAME_BYTES = 64 * 1024
export const DOCUMENTS_COLLAB_MAX_READ_ONLY_SYNC_FRAME_BYTES = 256 * 1024
export const DOCUMENTS_COLLAB_AUTHORIZATION_TICKET_TIMEOUT_MS = 60_000
export const DOCUMENTS_COLLAB_ACTIVE_REAUTHORIZATION_INTERVAL_MS = 15_000
export const COLLAB_SERVER_WEBSOCKET_CONFIGURATION = {
  websocketOptions: COLLAB_SERVER_TRANSPORT_OPTIONS,
} as const
export const COLLAB_SERVER_UNAUTHENTICATED_CONFIGURATION = {
  maxUnauthenticatedQueueSize: DOCUMENTS_COLLAB_MAX_PENDING_BYTES,
  maxUnauthenticatedQueueMessages: DOCUMENTS_COLLAB_MAX_PENDING_MESSAGES,
  maxPendingDocuments: DOCUMENTS_COLLAB_MAX_PENDING_DOCUMENTS,
} as const
export const COLLAB_SERVER_RUNTIME_CONFIGURATION = {
  ...COLLAB_SERVER_WEBSOCKET_CONFIGURATION,
  ...COLLAB_SERVER_UNAUTHENTICATED_CONFIGURATION,
} as const

export type DocumentsCollabRedisConfiguration = {
  host: string
  port: number
  prefix: string
  options: {
    username?: string
    password?: string
    db?: number
    tls?: Record<string, never>
    maxRetriesPerRequest: null
  }
}

const DEFAULT_DOCUMENTS_COLLAB_REDIS_PREFIX = 'open-mercato:documents:collab:development'
const LEGACY_DOCUMENTS_COLLAB_REDIS_PREFIX = 'open-mercato:documents:collab'
const DOCUMENTS_COLLAB_REDIS_PREFIX_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,158}[A-Za-z0-9])?$/

function resolveDocumentsCollabRedisPrefix(environment: NodeJS.ProcessEnv): string {
  const configured = environment.DOCUMENTS_COLLAB_REDIS_PREFIX?.trim() ?? ''
  if (!configured && environment.NODE_ENV === 'production') {
    throw new Error(
      '[internal] DOCUMENTS_COLLAB_REDIS_PREFIX is required in production when collaboration Redis is configured',
    )
  }
  const prefix = configured || DEFAULT_DOCUMENTS_COLLAB_REDIS_PREFIX
  if (
    prefix === LEGACY_DOCUMENTS_COLLAB_REDIS_PREFIX
    || !DOCUMENTS_COLLAB_REDIS_PREFIX_PATTERN.test(prefix)
  ) {
    throw new Error(
      '[internal] DOCUMENTS_COLLAB_REDIS_PREFIX must be a deployment-scoped Redis key prefix using letters, numbers, dot, underscore, colon, or dash',
    )
  }
  return prefix
}

export function resolveDocumentsCollabRedisConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): DocumentsCollabRedisConfiguration | null {
  const configured = environment.DOCUMENTS_COLLAB_REDIS_URL?.trim()
    || environment.REDIS_URL?.trim()
    || ''
  if (!configured) return null

  let parsed: URL
  try {
    parsed = new URL(configured)
  } catch {
    throw new Error('[internal] Documents collaboration Redis URL is invalid')
  }
  if ((parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') || !parsed.hostname) {
    throw new Error('[internal] Documents collaboration Redis URL must use redis:// or rediss://')
  }
  const port = parsed.port ? Number(parsed.port) : 6379
  const databasePath = parsed.pathname.replace(/^\//, '')
  const db = databasePath ? Number(databasePath) : undefined
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('[internal] Documents collaboration Redis port is invalid')
  }
  if (db !== undefined && (!Number.isInteger(db) || db < 0)) {
    throw new Error('[internal] Documents collaboration Redis database is invalid')
  }

  return {
    host: parsed.hostname,
    port,
    prefix: resolveDocumentsCollabRedisPrefix(environment),
    options: {
      ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
      ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
      ...(db !== undefined ? { db } : {}),
      ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
      maxRetriesPerRequest: null,
    },
  }
}

type DocumentsCollabRedisStorePayload = Pick<
  onStoreDocumentPayload,
  'lastTransactionOrigin'
>

type DocumentsCollabRedisStoreExtension = {
  onStoreDocument: (payload: onStoreDocumentPayload) => unknown
}

type DocumentsCollabRedisReplicationOptions = {
  onRejectedAggregate?: (documentName: string, document: Y.Doc) => void
  onAcceptedAggregate?: (document: Y.Doc, byteLength: number) => void
  resolveCollaborationGeneration?: (document: Y.Doc) => number | undefined
}

type DocumentsCollabRedisFanoutPublisher = {
  publish: (channel: string, message: Buffer) => Promise<unknown>
  disconnect: (reconnect?: boolean) => void
}

type DocumentsCollabPendingFanout = {
  document: Y.Doc
  collaborationGeneration: number
  revision: number
  message: Uint8Array
}

type DocumentsCollabBufferedFanout = {
  collaborationGeneration: number
  update: Uint8Array
}

const DOCUMENTS_COLLAB_REDIS_FANOUT_COMMAND_TIMEOUT_MS = 1_000
const DOCUMENTS_COLLAB_REDIS_FANOUT_RETRY_MIN_MS = 250
const DOCUMENTS_COLLAB_REDIS_FANOUT_RETRY_MAX_MS = 5_000
const DOCUMENTS_COLLAB_REDIS_FANOUT_SHUTDOWN_TIMEOUT_MS = 1_500
const DOCUMENTS_COLLAB_REDIS_LOCK_RELEASE_TIMEOUT_MS = 1_250
// The collaboration clients run with maxRetriesPerRequest: null, which disables
// ioredis' offline-queue flush. Every awaited Redis command therefore needs its
// own deadline or a prolonged outage parks the caller forever.
export const DOCUMENTS_COLLAB_REDIS_SUBSCRIBE_TIMEOUT_MS = 5_000
export const DOCUMENTS_COLLAB_REDIS_FANOUT_MAX_PENDING_ROOMS = 256
export const DOCUMENTS_COLLAB_REDIS_FANOUT_MAX_PENDING_BYTES = DOCUMENTS_COLLAB_MAX_PAYLOAD_BYTES * 8
const DOCUMENTS_COLLAB_REDIS_FANOUT_MAGIC = Buffer.from('OMDF1', 'ascii')
const DOCUMENTS_COLLAB_REDIS_FANOUT_GENERATION_BYTES = 8

function isHocuspocusStoreLockContention(error: unknown): error is Error {
  // @hocuspocus/extension-redis throws this cross-package error when another
  // replica owns the room's store lock. Match by the stable error name rather
  // than instanceof so duplicated Hocuspocus packages do not hide contention.
  return error instanceof Error && error.name === 'SkipFurtherHooksError'
}

/**
 * Redis replicas receive an authenticated source replica's Yjs update, but
 * they do not receive its browser authorization context. Only a store caused
 * by a local authenticated connection may compete for the distributed store
 * lock. A receiving replica therefore mirrors the update in memory while the
 * source replica remains responsible for making it durable. When two source
 * replicas race, Hocuspocus otherwise swallows the Redis lock loser's
 * SkipFurtherHooksError and may unload it even though a later Redis merge does
 * not schedule store hooks. Queue a complete Hocuspocus store retry before
 * propagating the sentinel so the room stays mapped and the retry still runs
 * the Redis lock, live authorization, and optimistic merge hooks in order.
 */
export function isDocumentsCollabSourceStore(
  payload: DocumentsCollabRedisStorePayload,
): boolean {
  const origin = payload.lastTransactionOrigin
  return !(
    origin
    && typeof origin === 'object'
    && 'source' in origin
    && origin.source === 'redis'
  )
}

export function enforceDocumentsCollabSourceStoreOwnership<
  RedisExtension extends DocumentsCollabRedisStoreExtension,
>(extension: RedisExtension): RedisExtension {
  const onStoreDocument = extension.onStoreDocument.bind(extension)
  extension.onStoreDocument = async (payload: onStoreDocumentPayload) => {
    if (!isDocumentsCollabSourceStore(payload)) return
    try {
      return await onStoreDocument(payload)
    } catch (error) {
      if (isHocuspocusStoreLockContention(error)) {
        // Register the retry synchronously. shouldUnloadDocument() observes
        // the debounced work when Hocuspocus catches the sentinel on the
        // current attempt, including when the last client just disconnected.
        void payload.instance.storeDocumentHooks(payload.document, payload)
      }
      throw error
    }
  }
  return extension
}

/**
 * Verify a durable update against the receiver's complete in-memory state
 * before Redis is allowed to apply or broadcast it. Each source replica
 * enforces the same limits before persistence, but two individually valid
 * replicas can still exceed the aggregate limit when their states merge.
 */
export function assertDocumentsCollabRedisAggregateUpdate(
  document: Y.Doc,
  update: Uint8Array,
): number {
  const candidate = new Y.Doc()
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document))
    Y.applyUpdate(candidate, update)
    return assertDocumentsCollabRedisAggregateState(candidate)
  } finally {
    candidate.destroy()
  }
}

function assertDocumentsCollabRedisAggregateState(document: Y.Doc): number {
  const materialized = yDocToContent(document)
  const yjsState = Y.encodeStateAsUpdate(document)
  assertDocumentContentResourceLimits({
    yjsState,
    contentHtml: materialized?.html,
    contentText: materialized?.text,
  })
  return yjsState.byteLength
}

/**
 * Documents collaboration deliberately does not use Hocuspocus Redis' Yjs
 * state-vector handshake. That handshake reads the live room and can fan out
 * an edit before its source replica has re-authorized and durably persisted
 * it. Instead, this extension keeps Redis awareness behaviour and the
 * distributed store lock, but publishes one complete Yjs update only after
 * the Documents store hook confirms the exact state became durable.
 */
export class DocumentsCollabRedisExtension extends HocuspocusRedis {
  private readonly persistedStates = new WeakMap<Y.Doc, {
    collaborationGeneration: number
    state: Uint8Array
  }>()

  /**
   * Durable fanout uses a dedicated fail-fast Redis connection. The stock
   * publisher is also the Redlock client and intentionally waits for Redis to
   * recover before allowing another replica to persist; post-store delivery
   * must not keep that distributed lock or Hocuspocus' save mutex occupied.
   */
  private readonly fanoutPublisher: DocumentsCollabRedisFanoutPublisher

  private readonly pendingFanouts = new Map<string, DocumentsCollabPendingFanout>()

  private readonly activeFanouts = new Set<string>()

  private readonly fanoutRetryAttempts = new Map<string, number>()

  private readonly fanoutRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()

  private readonly pendingLocalAfterStoreDelays = new Map<string, {
    timeout: ReturnType<typeof setTimeout>
    resolve: () => void
  }>()

  private readonly invalidatedFanoutDocuments = new WeakSet<Y.Doc>()

  private readonly bufferedFanouts = new WeakMap<
    Y.Doc,
    Map<string, DocumentsCollabBufferedFanout>
  >()

  private readonly bufferedFanoutBytes = new WeakMap<Y.Doc, number>()

  private nextFanoutRevision = 0

  private pendingFanoutBytes = 0

  private fanoutDestroyed = false

  /**
   * Hocuspocus does not publish a loading document in instance.documents until
   * after afterLoadDocument completes. Keep the hook payload reachable so a
   * Redis update received while the scoped database snapshot is loading can be
   * applied to that same Y.Doc instead of being silently dropped.
   */
  private readonly knownDocuments = new Map<string, onLoadDocumentPayload['document']>()

  private readonly onRejectedAggregate?: (
    documentName: string,
    document: Y.Doc,
  ) => void

  private readonly onAcceptedAggregate?: (
    document: Y.Doc,
    byteLength: number,
  ) => void

  private readonly resolveCollaborationGeneration?: (
    document: Y.Doc,
  ) => number | undefined

  constructor(
    configuration: DocumentsCollabRedisConfiguration,
    options: DocumentsCollabRedisReplicationOptions = {},
  ) {
    super(configuration)
    this.onRejectedAggregate = options.onRejectedAggregate
    this.onAcceptedAggregate = options.onAcceptedAggregate
    this.resolveCollaborationGeneration = options.resolveCollaborationGeneration
    this.fanoutPublisher = (
      this.pub as unknown as {
        duplicate: (options: {
          autoResendUnfulfilledCommands: boolean
          commandTimeout: number
          enableOfflineQueue: boolean
          maxRetriesPerRequest: number
        }) => DocumentsCollabRedisFanoutPublisher
      }
    ).duplicate({
      autoResendUnfulfilledCommands: false,
      commandTimeout: DOCUMENTS_COLLAB_REDIS_FANOUT_COMMAND_TIMEOUT_MS,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    })

    // Redis registers its stock state-vector receiver in super(). Replace only
    // that freshly-created client's messageBuffer listener with the durable
    // update receiver below; connection/error listeners remain untouched.
    for (const listener of this.sub.listeners('messageBuffer')) {
      this.sub.off('messageBuffer', listener)
    }
    this.sub.on('messageBuffer', this.receiveDocumentsRedisMessage)
  }

  /**
   * EventEmitter never observes the promise an async listener returns, so a
   * truncated frame, a receiver failure, or a failed reply publish would become
   * an unhandled rejection and terminate the sidecar. Keep the registered
   * listener synchronous and terminate every rejection here instead: one
   * malformed frame must cost at most that frame.
   */
  private readonly receiveDocumentsRedisMessage = (channel: Buffer, data: Buffer): void => {
    void this.handleDocumentsRedisMessage(channel, data).catch((error: unknown) => {
      logger.warn('rejected malformed Redis collaboration frame', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  markPersisted(
    document: Y.Doc,
    yjsState: Uint8Array,
    collaborationGeneration: number,
  ): void {
    if (this.invalidatedFanoutDocuments.has(document)) return
    this.persistedStates.set(document, {
      collaborationGeneration,
      state: Uint8Array.from(yjsState),
    })
  }

  async onLoadDocument(data: onLoadDocumentPayload): Promise<void> {
    const { documentName, document } = data
    this.knownDocuments.set(documentName, document)
    const loadingDocument = data.instance.loadingDocuments.get(documentName)
    if (loadingDocument) {
      void loadingDocument.catch(() => {
        if (
          this.knownDocuments.get(documentName) === document
          && !data.instance.documents.has(documentName)
        ) {
          this.knownDocuments.delete(documentName)
          void this.sub.unsubscribe(this.redisKey(documentName)).catch(() => undefined)
        }
      })
    }
    try {
      await this.subscribeDocument(documentName)
    } catch (error) {
      if (this.knownDocuments.get(documentName) === document) {
        this.knownDocuments.delete(documentName)
      }
      throw error
    }
  }

  override async afterLoadDocument({
    documentName,
    document,
  }: afterLoadDocumentPayload): Promise<void> {
    let aggregateByteLength: number
    try {
      this.applyBufferedFanouts(documentName, document)
      // A durable Redis update can arrive after the database snapshot was read
      // but before it is applied. Validate and re-budget their final union.
      aggregateByteLength = assertDocumentsCollabRedisAggregateState(document)
    } catch (error) {
      this.onRejectedAggregate?.(documentName, document)
      throw error
    }
    this.onAcceptedAggregate?.(document, aggregateByteLength)

    const awarenessQuery = new HocuspocusOutgoingMessage(documentName)
      .writeQueryAwareness()
      .toUint8Array()
    await this.publishRedisMessage(documentName, awarenessQuery)
  }

  override async afterUnloadDocument(data: afterUnloadDocumentPayload): Promise<void> {
    // The old room can finish unloading after a reconnect has already begun.
    // Keep the replacement's early subscription intact until its load either
    // succeeds or the failed-load cleanup above releases it.
    if (
      data.instance.documents.has(data.documentName)
      || data.instance.loadingDocuments.has(data.documentName)
    ) return

    this.knownDocuments.delete(data.documentName)
    await super.afterUnloadDocument(data)
  }

  /**
   * The subscriber client keeps ioredis' offline queue enabled, so a room load
   * started during a Redis outage would otherwise wait for recovery with no
   * deadline while its socket stays open. Fail the load instead: onLoadDocument
   * releases the early subscription and Hocuspocus rejects the connection, so
   * the client can retry rather than hanging against a green health check.
   */
  private async subscribeDocument(documentName: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        reject(new Error('[internal] documents collab: Redis room subscription timed out'))
      }, DOCUMENTS_COLLAB_REDIS_SUBSCRIBE_TIMEOUT_MS)
      deadline.unref?.()
      this.sub.subscribe(this.redisKey(documentName), (error: Error | null | undefined) => {
        clearTimeout(deadline)
        if (error) reject(error)
        else resolve()
      })
    })
  }

  override async onChange(_data: onChangePayload): Promise<void> {
    // Document updates are published from afterStoreDocument only. Awareness
    // and stateless hooks continue to use the parent extension unchanged.
  }

  override async afterStoreDocument(data: afterStoreDocumentPayload): Promise<void> {
    const persistedState = this.persistedStates.get(data.document)
    this.persistedStates.delete(data.document)
    try {
      await this.releaseStoreLock(data)
    } finally {
      if (
        persistedState
        && isDocumentsCollabSourceStore(data)
        && !this.invalidatedFanoutDocuments.has(data.document)
      ) {
        this.queuePersistedFanout(
          data.documentName,
          data.document,
          persistedState.state,
          persistedState.collaborationGeneration,
        )
      }
    }
  }

  private async releaseStoreLock(data: afterStoreDocumentPayload): Promise<void> {
    const lockKey = `${this.redisKey(data.documentName)}:lock`
    const lockState = this.locks.get(lockKey)
    if (lockState) {
      let timeout: ReturnType<typeof setTimeout> | null = null
      try {
        const releasing = lockState.lock.release()
        lockState.release = releasing
        const deadline = new Promise<false>((resolve) => {
          timeout = setTimeout(
            () => resolve(false),
            DOCUMENTS_COLLAB_REDIS_LOCK_RELEASE_TIMEOUT_MS,
          )
          timeout.unref?.()
        })
        const released = await Promise.race([
          releasing.then(
            () => true as const,
            () => true as const,
          ),
          deadline,
        ])
        if (!released) {
          // The Redlock token expires after one second. Do not retain the
          // room's save mutex forever when ioredis keeps the release command
          // queued during an outage. The old promise is deliberately detached:
          // unlike the parent hook, its late settlement cannot delete a newer
          // lock entry installed for the same room.
          void releasing.catch(() => undefined)
          logger.warn('Redis collaboration store lock release timed out; continuing after TTL', {
            room: data.documentName,
          })
        }
      } catch {
        // Match the parent extension: Redlock expiry is the release fallback.
      } finally {
        if (timeout) clearTimeout(timeout)
        if (this.locks.get(lockKey) === lockState) this.locks.delete(lockKey)
      }
    }

    await this.delayLocalAfterStore(data)
  }

  private async delayLocalAfterStore(data: afterStoreDocumentPayload): Promise<void> {
    const origin = data.lastTransactionOrigin
    if (
      !origin
      || typeof origin !== 'object'
      || !('source' in origin)
      || origin.source !== 'local'
    ) return

    // Mirror the parent extension's direct-connection debounce without calling
    // its lock cleanup after our bounded release. Keeping this map subclass-
    // owned also makes every cleanup identity-safe.
    const previous = this.pendingLocalAfterStoreDelays.get(data.documentName)
    if (previous) {
      clearTimeout(previous.timeout)
      this.pendingLocalAfterStoreDelays.delete(data.documentName)
      previous.resolve()
    }

    await new Promise<void>((resolve) => {
      const finish = (): void => {
        const current = this.pendingLocalAfterStoreDelays.get(data.documentName)
        if (current?.resolve === finish) {
          this.pendingLocalAfterStoreDelays.delete(data.documentName)
        }
        resolve()
      }
      const timeout = setTimeout(finish, this.configuration.disconnectDelay)
      this.pendingLocalAfterStoreDelays.set(data.documentName, { timeout, resolve: finish })
    })
  }

  discardPendingFanout(documentName: string, document?: Y.Doc): void {
    if (document) this.invalidatedFanoutDocuments.add(document)
    const pending = this.pendingFanouts.get(documentName)
    if (document && pending && pending.document !== document) return
    this.forgetPendingFanout(documentName)
  }

  private removePendingFanoutEntry(documentName: string): void {
    const pending = this.pendingFanouts.get(documentName)
    if (!pending) return
    this.pendingFanoutBytes -= pending.message.byteLength
    this.pendingFanouts.delete(documentName)
  }

  private forgetPendingFanout(documentName: string): void {
    this.removePendingFanoutEntry(documentName)
    this.fanoutRetryAttempts.delete(documentName)
    const retryTimer = this.fanoutRetryTimers.get(documentName)
    if (retryTimer) clearTimeout(retryTimer)
    this.fanoutRetryTimers.delete(documentName)
  }

  /**
   * A pending fanout carries the room's complete post-store state and pins its
   * Y.Doc, so an unreachable Redis would otherwise let one entry per edited
   * document accumulate for the whole outage — long after those rooms unload.
   * Bound the backlog by dropping the least recently refreshed rooms: their
   * state is already durable, every later fanout for a room supersedes the one
   * dropped here, and a peer that never sees the frame reloads authoritative
   * content on its next load anyway.
   */
  private evictOverflowingFanouts(retainedDocumentName: string): void {
    for (const documentName of this.pendingFanouts.keys()) {
      if (
        this.pendingFanouts.size <= DOCUMENTS_COLLAB_REDIS_FANOUT_MAX_PENDING_ROOMS
        && this.pendingFanoutBytes <= DOCUMENTS_COLLAB_REDIS_FANOUT_MAX_PENDING_BYTES
      ) return
      if (documentName === retainedDocumentName) continue
      this.forgetPendingFanout(documentName)
      logger.warn('dropped a stale pending Redis collaboration fanout to bound the outage backlog', {
        room: documentName,
        pendingRooms: this.pendingFanouts.size,
        pendingBytes: this.pendingFanoutBytes,
      })
    }
  }

  private queuePersistedFanout(
    documentName: string,
    document: Y.Doc,
    persistedState: Uint8Array,
    collaborationGeneration: number,
  ): void {
    if (this.fanoutDestroyed) return
    const message = new HocuspocusOutgoingMessage(documentName)
      .createSyncMessage()
      .writeUpdate(persistedState)
      .toUint8Array()
    // Re-insert rather than overwrite so the map stays ordered by how recently
    // each room was refreshed; eviction below relies on that ordering. The
    // room's retry attempts and backoff timer deliberately survive: a coalesced
    // update must not reset an outage's exponential backoff.
    this.removePendingFanoutEntry(documentName)
    this.pendingFanouts.set(documentName, {
      document,
      collaborationGeneration,
      revision: ++this.nextFanoutRevision,
      message,
    })
    this.pendingFanoutBytes += message.byteLength
    this.evictOverflowingFanouts(documentName)
    this.startPersistedFanout(documentName)
  }

  private startPersistedFanout(documentName: string): void {
    if (
      this.fanoutDestroyed
      || this.activeFanouts.has(documentName)
      || this.fanoutRetryTimers.has(documentName)
      || !this.pendingFanouts.has(documentName)
    ) return

    this.activeFanouts.add(documentName)
    void this.drainPersistedFanout(documentName).finally(() => {
      this.activeFanouts.delete(documentName)
      if (
        !this.fanoutDestroyed
        && this.pendingFanouts.has(documentName)
        && !this.fanoutRetryTimers.has(documentName)
      ) {
        this.startPersistedFanout(documentName)
      }
    })
  }

  private async drainPersistedFanout(documentName: string): Promise<void> {
    const pending = this.pendingFanouts.get(documentName)
    if (!pending || this.fanoutDestroyed) return

    try {
      await this.publishRedisMessage(
        documentName,
        pending.message,
        this.fanoutPublisher,
        pending.collaborationGeneration,
      )
    } catch (error) {
      if (this.fanoutDestroyed || !this.pendingFanouts.has(documentName)) return
      const attempt = (this.fanoutRetryAttempts.get(documentName) ?? 0) + 1
      this.fanoutRetryAttempts.set(documentName, attempt)
      const delay = Math.min(
        DOCUMENTS_COLLAB_REDIS_FANOUT_RETRY_MAX_MS,
        DOCUMENTS_COLLAB_REDIS_FANOUT_RETRY_MIN_MS * 2 ** Math.min(attempt - 1, 8),
      )
      logger.warn('durable Redis collaboration fanout failed; retrying latest state', {
        room: documentName,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      })
      const retryTimer = setTimeout(() => {
        this.fanoutRetryTimers.delete(documentName)
        this.startPersistedFanout(documentName)
      }, delay)
      retryTimer.unref?.()
      this.fanoutRetryTimers.set(documentName, retryTimer)
      return
    }

    this.fanoutRetryAttempts.delete(documentName)
    if (this.pendingFanouts.get(documentName)?.revision === pending.revision) {
      this.removePendingFanoutEntry(documentName)
    }
  }

  private redisKey(documentName: string): string {
    return `${this.configuration.prefix}:${documentName}`
  }

  private encodeRedisMessage(message: Uint8Array): Buffer {
    return Buffer.concat([this.messagePrefix, Buffer.from(message)])
  }

  private encodeDurableFanoutMessage(
    message: Uint8Array,
    collaborationGeneration: number,
  ): Buffer {
    if (
      !Number.isSafeInteger(collaborationGeneration)
      || collaborationGeneration < 1
    ) {
      throw new Error('[internal] documents collab: invalid Redis fanout generation')
    }
    const generation = Buffer.allocUnsafe(DOCUMENTS_COLLAB_REDIS_FANOUT_GENERATION_BYTES)
    generation.writeBigUInt64BE(BigInt(collaborationGeneration))
    return Buffer.concat([
      this.messagePrefix,
      DOCUMENTS_COLLAB_REDIS_FANOUT_MAGIC,
      generation,
      Buffer.from(message),
    ])
  }

  private async publishRedisMessage(
    documentName: string,
    message: Uint8Array,
    publisher: DocumentsCollabRedisFanoutPublisher | Pick<DocumentsCollabRedisFanoutPublisher, 'publish'> = this.pub,
    collaborationGeneration?: number,
  ): Promise<unknown> {
    return await publisher.publish(
      this.redisKey(documentName),
      collaborationGeneration === undefined
        ? this.encodeRedisMessage(message)
        : this.encodeDurableFanoutMessage(message, collaborationGeneration),
    )
  }

  private bufferDurableFanout(
    sender: string,
    documentName: string,
    document: Y.Doc,
    collaborationGeneration: number,
    update: Uint8Array,
  ): void {
    const buffered = this.bufferedFanouts.get(document) ?? new Map()
    const previous = buffered.get(sender)
    const bufferedBytes = (this.bufferedFanoutBytes.get(document) ?? 0)
      - (previous?.update.byteLength ?? 0)
      + update.byteLength
    if (
      (!previous && buffered.size >= DOCUMENTS_COLLAB_MAX_PENDING_MESSAGES)
      || bufferedBytes > DOCUMENTS_COLLAB_MAX_PENDING_BYTES
    ) {
      this.bufferedFanouts.delete(document)
      this.bufferedFanoutBytes.delete(document)
      this.onRejectedAggregate?.(documentName, document)
      logger.warn('rejected buffered Redis collaboration updates that exceeded load limits', {
        room: documentName,
      })
      return
    }
    buffered.set(sender, {
      collaborationGeneration,
      update: Uint8Array.from(update),
    })
    this.bufferedFanouts.set(document, buffered)
    this.bufferedFanoutBytes.set(document, bufferedBytes)
  }

  private applyDurableFanout(
    sender: string,
    documentName: string,
    document: Y.Doc,
    collaborationGeneration: number,
    update: Uint8Array,
  ): void {
    const loadedGeneration = this.resolveCollaborationGeneration?.(document)
    if (loadedGeneration === undefined) {
      this.bufferDurableFanout(
        sender,
        documentName,
        document,
        collaborationGeneration,
        update,
      )
      return
    }
    if (loadedGeneration !== collaborationGeneration) {
      logger.warn('rejected stale Redis collaboration update from another generation', {
        room: documentName,
        expectedGeneration: loadedGeneration,
        receivedGeneration: collaborationGeneration,
      })
      return
    }

    let aggregateByteLength: number
    try {
      aggregateByteLength = assertDocumentsCollabRedisAggregateUpdate(document, update)
    } catch (error) {
      if (isCrudHttpError(error) && error.status === 413) {
        this.onRejectedAggregate?.(documentName, document)
        logger.warn('rejected Redis collaboration update that exceeded room limits', {
          room: documentName,
        })
        return
      }
      logger.warn('rejected malformed Redis collaboration update', {
        room: documentName,
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }
    // Refresh the receiver's aggregate budget before Yjs forwards the accepted
    // update to local connections.
    this.onAcceptedAggregate?.(document, aggregateByteLength)
    Y.applyUpdate(document, update, this.redisTransactionOrigin)
  }

  private applyBufferedFanouts(documentName: string, document: Y.Doc): void {
    const buffered = this.bufferedFanouts.get(document)
    this.bufferedFanouts.delete(document)
    this.bufferedFanoutBytes.delete(document)
    if (!buffered) return
    const loadedGeneration = this.resolveCollaborationGeneration?.(document)
    if (loadedGeneration === undefined) {
      this.onRejectedAggregate?.(documentName, document)
      throw new Error('[internal] documents collab: loaded room has no collaboration generation')
    }
    for (const [sender, fanout] of buffered) {
      this.applyDurableFanout(
        sender,
        documentName,
        document,
        fanout.collaborationGeneration,
        fanout.update,
      )
    }
  }

  private readonly handleDocumentsRedisMessage = async (
    _channel: Buffer,
    data: Buffer,
  ): Promise<void> => {
    const identifierLength = data[0]
    if (identifierLength === undefined || data.byteLength <= identifierLength + 1) return
    const identifier = data.toString('utf8', 1, identifierLength + 1)
    if (identifier === this.configuration.identifier) return

    const redisPayload = data.subarray(identifierLength + 1)
    let collaborationGeneration: number | undefined
    let messageBuffer = redisPayload
    if (
      redisPayload.byteLength
        >= DOCUMENTS_COLLAB_REDIS_FANOUT_MAGIC.byteLength
          + DOCUMENTS_COLLAB_REDIS_FANOUT_GENERATION_BYTES
      && redisPayload.subarray(0, DOCUMENTS_COLLAB_REDIS_FANOUT_MAGIC.byteLength)
        .equals(DOCUMENTS_COLLAB_REDIS_FANOUT_MAGIC)
    ) {
      const generationOffset = DOCUMENTS_COLLAB_REDIS_FANOUT_MAGIC.byteLength
      const encodedGeneration = redisPayload.readBigUInt64BE(generationOffset)
      if (encodedGeneration > BigInt(Number.MAX_SAFE_INTEGER) || encodedGeneration < 1n) return
      collaborationGeneration = Number(encodedGeneration)
      messageBuffer = redisPayload.subarray(
        generationOffset + DOCUMENTS_COLLAB_REDIS_FANOUT_GENERATION_BYTES,
      )
    }
    const header = new HocuspocusIncomingMessage(messageBuffer)
    const documentName = header.readVarString()
    const document = this.instance.documents.get(documentName)
      ?? this.knownDocuments.get(documentName)
    if (!document) return

    const messageType = header.readVarUint()
    if (messageType === MessageType.Sync || messageType === MessageType.SyncReply) {
      // The Documents protocol accepts only complete, post-persistence update
      // frames. Ignore state vectors/step-two replies so no peer can ask this
      // replica to reveal transient browser-authored room state.
      const syncType = header.readVarUint()
      if (messageType !== MessageType.Sync || syncType !== 2) return
      if (collaborationGeneration === undefined) {
        logger.warn('rejected unversioned Redis collaboration update', { room: documentName })
        return
      }
      const update = header.readVarUint8Array()
      this.applyDurableFanout(
        identifier,
        documentName,
        document,
        collaborationGeneration,
        update,
      )
      return
    }

    const receiverMessage = new HocuspocusIncomingMessage(messageBuffer)
    receiverMessage.readVarString()
    receiverMessage.writeVarString(documentName)
    const receiver = new HocuspocusMessageReceiver(
      receiverMessage,
      this.redisTransactionOrigin,
    )
    await receiver.apply(document, undefined, (reply) => {
      void this.publishRedisMessage(documentName, reply).catch((error: unknown) => {
        logger.warn('failed to publish Redis collaboration reply', {
          room: documentName,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    })
  }

  private async flushPendingFanoutsBeforeDestroy(): Promise<void> {
    const pending = [...this.pendingFanouts.entries()]
    if (pending.length === 0) return

    const attempts = Promise.allSettled(pending.map(async ([documentName, fanout]) => {
      await this.publishRedisMessage(
        documentName,
        fanout.message,
        this.fanoutPublisher,
        fanout.collaborationGeneration,
      )
    }))
    let timeout: ReturnType<typeof setTimeout> | null = null
    const deadline = new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), DOCUMENTS_COLLAB_REDIS_FANOUT_SHUTDOWN_TIMEOUT_MS)
      timeout.unref?.()
    })
    const results = await Promise.race([attempts, deadline])
    if (timeout) clearTimeout(timeout)

    if (results === null) {
      logger.warn('durable Redis collaboration fanout did not drain before shutdown', {
        pending: pending.length,
      })
      return
    }
    const failed = results.filter((result) => result.status === 'rejected').length
    if (failed > 0) {
      logger.warn('durable Redis collaboration fanout failed during shutdown', {
        pending: pending.length,
        failed,
      })
    }
  }

  override async onDestroy(): Promise<void> {
    this.fanoutDestroyed = true
    for (const retryTimer of this.fanoutRetryTimers.values()) clearTimeout(retryTimer)
    this.fanoutRetryTimers.clear()
    const pendingLocalDelays = [...this.pendingLocalAfterStoreDelays.values()]
    this.pendingLocalAfterStoreDelays.clear()
    for (const pending of pendingLocalDelays) {
      clearTimeout(pending.timeout)
      pending.resolve()
    }
    try {
      await this.flushPendingFanoutsBeforeDestroy()
    } finally {
      this.pendingFanouts.clear()
      this.pendingFanoutBytes = 0
      this.fanoutRetryAttempts.clear()
      this.fanoutPublisher.disconnect(false)
      // The stock extension calls Redlock.quit(), which can wait forever when
      // its shared client uses maxRetriesPerRequest=null during a Redis outage.
      // Shutdown has already made every room inert and attempted a bounded
      // durable drain, so force-close the transport clients instead.
      this.pub.disconnect(false)
      this.sub.disconnect(false)
    }
  }
}

/**
 * The Redis extension replicates updates and awareness across sidecar
 * replicas. It is activated only when a Redis URL is explicitly configured:
 * defaulting to a localhost instance could silently attach the sidecar to an
 * unrelated Redis, and failing hard would block valid single-node
 * deployments. Without Redis the sidecar runs in single-node mode and logs a
 * prominent startup warning, because multi-instance deployments require
 * Redis for cross-instance document sync.
 */
export function resolveDocumentsCollabRedisExtensions<RedisExtension>(
  environment: NodeJS.ProcessEnv,
  createRedisExtension: (configuration: DocumentsCollabRedisConfiguration) => RedisExtension,
): RedisExtension[] {
  const configuration = resolveDocumentsCollabRedisConfiguration(environment)
  if (!configuration) {
    logger.warn(
      'DOCUMENTS_COLLAB_REDIS_URL and REDIS_URL are unset; '
      + 'running in single-node mode. Multi-instance deployments require Redis '
      + 'for cross-instance document sync.',
    )
    return []
  }
  return [createRedisExtension(configuration)]
}

export type CollabFinalDrainConsumeResult =
  | 'unmarked'
  | 'busy'
  | 'connected'
  | 'failed'
  | 'consumed'

export type CollabAuthorizationTicket = {
  readonly documentName: string
  readonly epoch: number
  readonly state: object
}

export type CollabFinalDrainRegistry = {
  /**
   * Mark the exact trusted in-memory room before its sockets are closed, but
   * only when it currently has at least one live logical connection.
   */
  mark: (document: Y.Doc, readiness: Promise<void>) => boolean
  /** Read-only identity check used to keep reconnects out until the drain starts. */
  isMarked: (document: Y.Doc) => boolean
  /**
   * Consume the mark once, but only after every captured connection queue has
   * drained and the room has no live connections.
   */
  consume: (document: Y.Doc) => Promise<CollabFinalDrainConsumeResult>
  /** Seal the old room identity after durable success; unmapping releases it via WeakMap. */
  complete: (document: Y.Doc) => void
  /** Permanently withdraw a pending exception when another guard wins. */
  discard: (document: Y.Doc) => void
  /** Begin a bounded auth ticket for one currently authenticating scoped document. */
  beginAuthorization: (
    documentName: string,
    scope?: { tenantId: string; organizationId: string },
  ) => CollabAuthorizationTicket
  /** Advance only in-flight tickets for this exact document and scope. */
  bumpAuthorization: (
    documentName: string,
    scope?: { tenantId: string; organizationId: string },
  ) => void
  /** Verify no trusted access event crossed any authentication await. */
  isAuthorizationCurrent: (ticket: CollabAuthorizationTicket) => boolean
  /** Release the ticket and delete its document state when the last auth ends. */
  endAuthorization: (ticket: CollabAuthorizationTicket) => void
}

type ConnectionCountedYDoc = Y.Doc & {
  getConnectionsCount?: () => unknown
  getConnections?: () => unknown
}

type PendingMessagesConnection = {
  waitForPendingMessages?: () => unknown
}

type CollabFinalDrainState = {
  /** Resolves false when any captured queue cannot be proven drained. */
  readiness: Promise<boolean>
  /** Only the caller that installs this promise may receive the drain grant. */
  consuming?: Promise<CollabFinalDrainConsumeResult>
  /** The one store invocation allowed to finish the final durable write. */
  granted?: boolean
  /** Durable success seals this old room identity until Hocuspocus unmaps it. */
  completed?: boolean
}

type CollabAuthorizationState = {
  active: number
  epoch: number
}

type InternalCollabAuthorizationTicket = CollabAuthorizationTicket & {
  expiry?: ReturnType<typeof setTimeout>
  released: boolean
  stateKey: string
}

function collabAuthorizationStateKey(
  documentName: string,
  scope?: { tenantId: string; organizationId: string },
): string {
  return scope
    ? `${documentName}\u0000${scope.tenantId}\u0000${scope.organizationId}`
    : documentName
}

function liveCollabConnectionCount(document: Y.Doc): number | null {
  const getConnectionsCount = (document as ConnectionCountedYDoc).getConnectionsCount
  if (typeof getConnectionsCount !== 'function') return null
  try {
    const count = getConnectionsCount.call(document)
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0
      ? count
      : null
  } catch {
    return null
  }
}

function captureCollabPendingMessageReadiness(document: Y.Doc): Promise<void> | null {
  const getConnections = (document as ConnectionCountedYDoc).getConnections
  if (typeof getConnections !== 'function') return null

  let connections: unknown
  try {
    connections = getConnections.call(document)
  } catch {
    return null
  }
  if (!Array.isArray(connections) || connections.length === 0) return null

  // Capture the public queue promises synchronously, while the exact
  // connections are still registered and before closeConnections removes
  // them from the room. A missing/throwing/non-Promise readiness contract is
  // represented by a rejection so the registry can fail the drain closed.
  const pending = connections.map((candidate) => {
    const connection = candidate as PendingMessagesConnection | null
    if (typeof connection?.waitForPendingMessages !== 'function') {
      return Promise.reject(new Error(
        '[internal] documents collab: connection queue readiness is unavailable',
      ))
    }
    try {
      const readiness = connection.waitForPendingMessages()
      if (
        !readiness
        || (typeof readiness !== 'object' && typeof readiness !== 'function')
        || typeof (readiness as PromiseLike<unknown>).then !== 'function'
      ) {
        return Promise.reject(new Error(
          '[internal] documents collab: connection queue readiness is invalid',
        ))
      }
      return Promise.resolve(readiness)
    } catch (error) {
      return Promise.reject(error)
    }
  })

  return Promise.all(pending).then(() => undefined)
}

/**
 * One-shot, room-identity-bound exception for draining edits accepted before
 * a trusted share-change event closed the room. Unknown connection state is
 * deliberately treated as connected. No timer can make a marked room become
 * eligible: every exact pre-close connection queue must drain and the live
 * connection count must then be zero.
 */
export function createCollabFinalDrainRegistry(
  resolveLiveConnections: (document: Y.Doc) => number | null = liveCollabConnectionCount,
): CollabFinalDrainRegistry {
  const markedDocuments = new WeakMap<Y.Doc, CollabFinalDrainState>()
  const authorizationStates = new Map<string, CollabAuthorizationState>()
  const releaseAuthorization = (ticket: InternalCollabAuthorizationTicket): void => {
    if (ticket.released) return
    ticket.released = true
    if (ticket.expiry) clearTimeout(ticket.expiry)
    const state = authorizationStates.get(ticket.stateKey)
    if (state !== ticket.state) return
    state.active = Math.max(0, state.active - 1)
    if (state.active === 0) authorizationStates.delete(ticket.stateKey)
  }
  return {
    mark(document, readiness) {
      const guardedReadiness = readiness.then(
        () => true,
        () => false,
      )
      if ((resolveLiveConnections(document) ?? 0) <= 0) return false
      if (markedDocuments.has(document)) return true
      markedDocuments.set(document, {
        readiness: guardedReadiness,
      })
      return true
    },
    isMarked(document) {
      return markedDocuments.has(document)
    },
    async consume(document) {
      const state = markedDocuments.get(document)
      if (!state) return 'unmarked'
      // A non-owner store must not invalidate or release the room while the
      // owner is waiting for captured queues or completing its durable write.
      if (state.consuming || state.granted) return 'busy'

      const consuming = (async (): Promise<CollabFinalDrainConsumeResult> => {
        const ready = await state.readiness
        if (markedDocuments.get(document) !== state) return 'unmarked'

        // Every terminal outcome stays marked until its caller synchronously
        // installs invalidation or Hocuspocus unmaps the successfully drained
        // old Y.Doc. Deleting here would create a microtask gap in which an
        // in-flight authentication could enter before invalidation is visible.
        if (!ready) return 'failed'
        if (resolveLiveConnections(document) !== 0) return 'connected'
        state.granted = true
        return 'consumed'
      })()
      state.consuming = consuming
      return consuming
    },
    complete(document) {
      const state = markedDocuments.get(document)
      if (state?.granted) state.completed = true
    },
    discard(document) {
      markedDocuments.delete(document)
    },
    beginAuthorization(documentName, scope) {
      const stateKey = collabAuthorizationStateKey(documentName, scope)
      let state = authorizationStates.get(stateKey)
      if (!state) {
        state = { active: 0, epoch: 0 }
        authorizationStates.set(stateKey, state)
      }
      state.active += 1
      const ticket: InternalCollabAuthorizationTicket = {
        documentName,
        epoch: state.epoch,
        released: false,
        stateKey,
        state,
      }
      ticket.expiry = setTimeout(() => {
        releaseAuthorization(ticket)
      }, DOCUMENTS_COLLAB_AUTHORIZATION_TICKET_TIMEOUT_MS)
      ticket.expiry.unref?.()
      return ticket
    },
    bumpAuthorization(documentName, scope) {
      const state = authorizationStates.get(collabAuthorizationStateKey(documentName, scope))
      if (state) state.epoch += 1
    },
    isAuthorizationCurrent(ticket) {
      const internalTicket = ticket as InternalCollabAuthorizationTicket
      const state = authorizationStates.get(internalTicket.stateKey)
      return !internalTicket.released
        && state === ticket.state
        && state.epoch === ticket.epoch
    },
    endAuthorization(ticket) {
      releaseAuthorization(ticket as InternalCollabAuthorizationTicket)
    },
  }
}

/**
 * Prepare the current room for a trusted share-event close. Direct-only or
 * already-disconnected rooms are deliberately left unmarked because
 * closeConnections cannot produce a last-websocket store for them.
 */
export function markCollabFinalDrainForReauth(
  document: Y.Doc,
  registry: CollabFinalDrainRegistry,
): boolean {
  const readiness = captureCollabPendingMessageReadiness(document)
  if (!readiness) return false
  return registry.mark(document, readiness)
}

type CollabIngressLimits = {
  maxPendingBytes: number
  maxPendingMessages: number
}

type CollabIngressState = {
  blocked: boolean
  pendingBytes: number
  pendingMessages: number
}

type BoundedCollabConnection = Pick<
  HocuspocusConnection<CollabContext>,
  'close' | 'handleMessage' | 'waitForPendingMessages' | 'webSocket'
>

const collabIngressStates = new WeakMap<object, CollabIngressState>()
const boundedCollabConnections = new WeakSet<object>()
const guardedCollabConnectionPrototypes = new WeakSet<object>()

function closeCollabIngress(
  connection: BoundedCollabConnection,
  state: CollabIngressState,
): void {
  if (state.blocked) return
  state.blocked = true
  try {
    connection.close()
  } catch {
    // The transport close below is authoritative even if the logical room was
    // concurrently removed.
  }
  try {
    connection.webSocket.close(1009, 'Collaboration ingress limit exceeded')
  } catch {
    // A concurrently closed socket is already in the required terminal state.
  }
}

function handleBoundedCollabIngress(
  connection: BoundedCollabConnection,
  data: Uint8Array,
  handleMessage: (input: Uint8Array) => void,
  limits: CollabIngressLimits,
): void {
  const socketKey = connection.webSocket as object
  let state = collabIngressStates.get(socketKey)
  if (!state) {
    state = { blocked: false, pendingBytes: 0, pendingMessages: 0 }
    collabIngressStates.set(socketKey, state)
  }
  if (state.blocked) return

  const pendingBytes = state.pendingBytes + data.byteLength
  const pendingMessages = state.pendingMessages + 1
  if (
    pendingBytes > limits.maxPendingBytes
    || pendingMessages > limits.maxPendingMessages
  ) {
    closeCollabIngress(connection, state)
    return
  }

  state.pendingBytes = pendingBytes
  state.pendingMessages = pendingMessages
  let released = false
  const release = () => {
    if (released) return
    released = true
    state.pendingBytes = Math.max(0, state.pendingBytes - data.byteLength)
    state.pendingMessages = Math.max(0, state.pendingMessages - 1)
  }

  try {
    handleMessage(data)
    void connection.waitForPendingMessages().then(release, release)
  } catch (error) {
    release()
    throw error
  }
}

/**
 * Bound Hocuspocus' otherwise-unbounded authenticated message queue.
 *
 * The state is keyed by the physical socket, not the logical document
 * connection, because one provider can multiplex several documents. Every
 * accepted frame stays charged until Hocuspocus reports that its serial queue
 * drained, including frames rejected by a later hook.
 */
export function installBoundedCollabIngress(
  connection: BoundedCollabConnection,
  limits: CollabIngressLimits = {
    maxPendingBytes: DOCUMENTS_COLLAB_MAX_PENDING_BYTES,
    maxPendingMessages: DOCUMENTS_COLLAB_MAX_PENDING_MESSAGES,
  },
): void {
  const connectionKey = connection as object
  if (boundedCollabConnections.has(connectionKey)) return
  boundedCollabConnections.add(connectionKey)

  const handleMessage = connection.handleMessage.bind(connection)
  connection.handleMessage = (data: Uint8Array): void => {
    handleBoundedCollabIngress(connection, data, handleMessage, limits)
  }
}

type HocuspocusConnectionClass = {
  prototype: BoundedCollabConnection
}

/**
 * Guard every logical Hocuspocus connection before the server can drain its
 * pre-authentication queue. Hocuspocus invokes `connected` only after that
 * synchronous drain, so installing the guard from the hook would miss the
 * oldest (and usually largest) retained batch.
 */
export function installHocuspocusCollabIngressGuard(
  ConnectionClass: HocuspocusConnectionClass = HocuspocusConnection,
): void {
  const prototype = ConnectionClass.prototype
  if (guardedCollabConnectionPrototypes.has(prototype as object)) return
  guardedCollabConnectionPrototypes.add(prototype as object)

  const handleMessage = prototype.handleMessage
  prototype.handleMessage = function guardedHandleMessage(
    this: BoundedCollabConnection,
    data: Uint8Array,
  ): void {
    if (boundedCollabConnections.has(this as object)) {
      handleMessage.call(this, data)
      return
    }
    handleBoundedCollabIngress(
      this,
      data,
      (input) => handleMessage.call(this, input),
      {
        maxPendingBytes: DOCUMENTS_COLLAB_MAX_PENDING_BYTES,
        maxPendingMessages: DOCUMENTS_COLLAB_MAX_PENDING_MESSAGES,
      },
    )
  }
}

/** Reject expensive control/read-only frames before Hocuspocus decodes Yjs/JSON payloads. */
export function assertCollabInboundFramePolicy(
  update: Uint8Array,
  options: { readOnly: boolean },
): void {
  if (update.byteLength > DOCUMENTS_COLLAB_MAX_PAYLOAD_BYTES) {
    throw new Error('[internal] documents collab: frame exceeds transport limit')
  }

  let messageType: number
  try {
    const message = new HocuspocusIncomingMessage(update)
    message.readVarString()
    messageType = message.readVarUint()
  } catch {
    throw new Error('[internal] documents collab: malformed frame envelope')
  }

  const isSync = messageType === MessageType.Sync || messageType === MessageType.SyncReply
  if (
    messageType === MessageType.Awareness
    && update.byteLength > DOCUMENTS_COLLAB_MAX_AWARENESS_FRAME_BYTES
  ) {
    throw new Error('[internal] documents collab: awareness frame exceeds limit')
  }
  if (
    !isSync
    && update.byteLength > DOCUMENTS_COLLAB_MAX_CONTROL_FRAME_BYTES
  ) {
    throw new Error('[internal] documents collab: control frame exceeds limit')
  }
  if (
    options.readOnly
    && isSync
    && update.byteLength > DOCUMENTS_COLLAB_MAX_READ_ONLY_SYNC_FRAME_BYTES
  ) {
    throw new Error('[internal] documents collab: read-only sync frame exceeds limit')
  }
}

export type CollabConnection = { readOnly: boolean }
type CollabTier = CollabTokenClaims['tier']
export type CollabContext = {
  userId: string
  tenantId: string
  organizationId: string
  documentId: string
  tier: CollabTier
  readOnly: boolean
  exp: number | null
  awarenessUser?: CanonicalCollaborationAwarenessUser
}
const COLLAB_AUTHORIZATION_LIFECYCLE = Symbol('documents.collab.authorization-lifecycle')
type CollabAuthorizationLifecycle = {
  established: boolean
  ticket?: CollabAuthorizationTicket
}
type TicketedCollabContext = CollabContext & {
  [COLLAB_AUTHORIZATION_LIFECYCLE]?: CollabAuthorizationLifecycle
}
type CollabScope = { tenantId: string; organizationId: string }
type CollabContainer = { resolve: (name: string) => unknown }
type CollabAcl = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}
type CollabRbacService = {
  invalidateUserCache: (userId: string) => Promise<void>
  loadAcl: (
    userId: string,
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<CollabAcl>
}

async function loadFreshCollabAcl(
  rbacService: CollabRbacService,
  userId: string,
  scope: { tenantId: string | null; organizationId: string | null },
): Promise<CollabAcl | null> {
  if (
    typeof rbacService?.invalidateUserCache !== 'function'
    || typeof rbacService.loadAcl !== 'function'
  ) {
    return null
  }
  await rbacService.invalidateUserCache(userId)
  return rbacService.loadAcl(userId, scope)
}
export type CollabHooksDeps = {
  verifyToken?: (token: string) => CollabTokenClaims | null
  verifyTokenV2?: (token: string) => VerifiedCollabTokenV2Claims | null
  authorizeContext: (context: CollabContext) => Promise<boolean>
  resolveAwarenessName?: (context: CollabContext) => Promise<unknown>
  resolveContainer: () => Promise<CollabContainer>
  loadContent: (
    em: unknown,
    documentId: string,
    scope: CollabScope,
  ) => Promise<{
    yjsState: Buffer | null
    contentHtml: string | null
    updatedAt: string | Date
    collaborationGeneration: number
  } | null>
  loadCollaborationGeneration?: (
    em: unknown,
    documentId: string,
    scope: CollabScope,
  ) => Promise<number | null>
  initializeYjsState: (
    em: unknown,
    documentId: string,
    scope: CollabScope,
  ) => Promise<Buffer | null>
  persistContent: (
    em: unknown,
    documentId: string,
    scope: CollabScope,
    input: { yjsState: Buffer; contentHtml?: string | null; contentText?: string | null },
    deps: {
      searchIndexer: unknown
      expectedUpdatedAt: string
      expectedCollaborationGeneration: number
      requireExpectedVersion: true
    },
  ) => Promise<{ updatedAt: string | Date; collaborationGeneration: number }>
  /** Notify the replication layer only after this exact generation/state is durable. */
  onPersisted?: (
    document: Y.Doc,
    yjsState: Uint8Array,
    collaborationGeneration: number,
  ) => void
  allowedOrigins?: string[] | null
  /** Require both an Origin header and a configured exact-match trusted origin. */
  requireOrigin?: boolean
  isRoomInvalidated?: (documentName: string, document?: Y.Doc) => boolean
  invalidateRoom?: (documentName: string, document: Y.Doc) => void
  finalDrainRegistry?: CollabFinalDrainRegistry
  /** Resolve only the room identity currently mapped by Hocuspocus. */
  resolveRoomDocument?: (documentName: string) => Y.Doc | undefined
  /** @deprecated Use isRoomInvalidated. Kept for extension compatibility. */
  isRoomClosing?: (documentName: string, document: Y.Doc) => boolean
}

export type CollabExpiryConnection = {
  close: () => void
  onClose: (callback: () => void) => unknown
}

export type CollabHealthRequest = Pick<IncomingMessage, 'method' | 'url'>
export type CollabHealthResponse = Pick<ServerResponse, 'statusCode' | 'setHeader' | 'end'>

type CollabAwarenessOwnership = {
  ownedClientIds: ReadonlySet<number>
  occupiedClientIds: ReadonlySet<number>
  /** All client ids admitted during this websocket connection's lifetime. */
  claimedClientIds?: Set<number>
  /** Stable room-lifetime binding that prevents a different actor recycling an id. */
  roomClientOwners?: Map<number, string>
}

type RequestHeaders = Record<string, string | string[] | undefined>

function readHeader(headers: RequestHeaders | undefined, name: string): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
}

function normalizeTrustedOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.origin : null
  } catch {
    return null
  }
}

export function resolveCollabAllowedOrigins(
  env: { DOCUMENTS_COLLAB_ALLOWED_ORIGINS?: string; APP_URL?: string; NEXT_PUBLIC_APP_URL?: string },
): string[] {
  const candidates = [
    ...(env.DOCUMENTS_COLLAB_ALLOWED_ORIGINS ?? '').split(','),
    env.APP_URL ?? '',
    env.NEXT_PUBLIC_APP_URL ?? '',
  ]
  return Array.from(new Set(candidates
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map(normalizeTrustedOrigin)
    .filter((origin): origin is string => Boolean(origin))))
}

export function isCollabRequestOriginAllowed(input: {
  origin?: string
  allowedOrigins?: string[] | null
  requireOrigin: boolean
}): boolean {
  if (!input.origin) return !input.requireOrigin
  const origin = normalizeTrustedOrigin(input.origin)
  if (!origin) return false
  const allowedOrigins = input.allowedOrigins ?? []
  if (allowedOrigins.length === 0) return !input.requireOrigin
  return allowedOrigins.includes(origin)
}

function assertScopedContext(context: CollabContext | null | undefined): asserts context is CollabContext {
  if (!context?.tenantId || !context.organizationId) {
    throw new Error('[internal] documents collab: missing tenant scope')
  }
}

function normalizeContentVersion(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null
  }
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function isReadOnlyTier(tier: CollabTier): boolean {
  return tier === 'viewer' || tier === 'commenter'
}

function toContext(
  claims: CollabTokenClaims,
  readOnly: boolean,
  exp: number | null,
): CollabContext {
  return {
    userId: claims.userId,
    tenantId: claims.tenantId,
    organizationId: claims.organizationId,
    documentId: claims.documentId,
    tier: claims.tier,
    readOnly,
    exp,
  }
}

function resolveCollabClaims(deps: CollabHooksDeps, token: string): CollabContext | null {
  const v2Claims = deps.verifyTokenV2?.(token) ?? null
  if (v2Claims) return toContext(v2Claims, v2Claims.readOnly, v2Claims.exp)

  const legacyClaims = deps.verifyToken?.(token) ?? null
  if (!legacyClaims) return null
  const exp = readLegacyTokenExpiration(token)
  return exp === null
    ? null
    : toContext(legacyClaims, isReadOnlyTier(legacyClaims.tier), exp)
}

export function bindCollabAwarenessStates(
  context: CollabContext | null | undefined,
  states: Map<number, Record<string, unknown>>,
  ownership?: CollabAwarenessOwnership,
): void {
  if (!context?.awarenessUser) {
    throw new Error('[internal] documents collab: awareness identity is not authenticated')
  }

  const admittedThisUpdate = new Set<number>()
  for (const [clientId, state] of states) {
    // Hocuspocus decodes the inbound update through a scratch Awareness whose
    // constructor creates one empty local state. Never turn that decoder-only
    // entry into a broadcast collaborator or retain it in the room.
    if (
      !state
      || typeof state !== 'object'
      || Array.isArray(state)
      || Object.keys(state).length === 0
    ) {
      states.delete(clientId)
      continue
    }
    if (
      !Number.isSafeInteger(clientId)
      || clientId < 0
      || clientId > MAX_YJS_CLIENT_ID
      || !isBoundedAwarenessState(state)
    ) {
      states.delete(clientId)
      continue
    }
    if (
      ownership?.occupiedClientIds.has(clientId)
      && !ownership.ownedClientIds.has(clientId)
    ) {
      // Hocuspocus providers echo awareness updates received from peers. An
      // occupied id owned by another socket is therefore either a harmless
      // echo or an attempted overwrite; in both cases it must be discarded,
      // never rebound to the sender or treated as a reason to disconnect it.
      states.delete(clientId)
      continue
    }

    const roomOwner = ownership?.roomClientOwners?.get(clientId)
    if (roomOwner !== undefined && roomOwner !== context.awarenessUser.id) {
      states.delete(clientId)
      continue
    }

    const knownToConnection = Boolean(
      ownership?.ownedClientIds.has(clientId)
      || ownership?.claimedClientIds?.has(clientId),
    )
    const connectionClientCount = new Set([
      ...(ownership?.ownedClientIds ?? []),
      ...(ownership?.claimedClientIds ?? []),
      ...admittedThisUpdate,
    ]).size
    if (
      !knownToConnection
      && connectionClientCount >= DOCUMENTS_COLLAB_MAX_AWARENESS_CLIENT_IDS_PER_CONNECTION
    ) {
      states.delete(clientId)
      continue
    }
    if (
      roomOwner === undefined
      && (ownership?.roomClientOwners?.size ?? 0)
        >= DOCUMENTS_COLLAB_MAX_AWARENESS_CLIENT_IDS_PER_ROOM
    ) {
      states.delete(clientId)
      continue
    }

    const cursor = sanitizeAwarenessCursor(state.cursor)
    const canonicalState: Record<string, unknown> = {
      user: { ...context.awarenessUser },
    }
    if (cursor) canonicalState.cursor = cursor
    states.set(clientId, canonicalState)
    admittedThisUpdate.add(clientId)
    ownership?.claimedClientIds?.add(clientId)
    if (roomOwner === undefined) {
      ownership?.roomClientOwners?.set(clientId, context.awarenessUser.id)
    }
  }
}

function isBoundedAwarenessState(state: Record<string, unknown>): boolean {
  try {
    const serialized = JSON.stringify(state)
    return typeof serialized === 'string'
      && Buffer.byteLength(serialized, 'utf8') <= DOCUMENTS_COLLAB_MAX_AWARENESS_STATE_BYTES
  } catch {
    return false
  }
}

type SanitizedAwarenessPosition = {
  assoc: number
  item?: { client: number; clock: number }
  tname?: string
  type?: { client: number; clock: number }
}

function sanitizeAwarenessId(value: unknown): { client: number; clock: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    !Number.isSafeInteger(record.client)
    || (record.client as number) < 0
    || (record.client as number) > MAX_YJS_CLIENT_ID
    || !Number.isSafeInteger(record.clock)
    || (record.clock as number) < 0
  ) {
    return null
  }
  return { client: record.client as number, clock: record.clock as number }
}

function sanitizeAwarenessPosition(value: unknown): SanitizedAwarenessPosition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const assoc = record.assoc === undefined ? 0 : record.assoc
  if (!Number.isSafeInteger(assoc) || (assoc as number) < -1 || (assoc as number) > 1) {
    return null
  }

  const item = sanitizeAwarenessId(record.item)
  if (item) return { item, assoc: assoc as number }
  if (typeof record.tname === 'string' && record.tname.length > 0 && record.tname.length <= 120) {
    return { tname: record.tname, assoc: assoc as number }
  }
  const type = sanitizeAwarenessId(record.type)
  return type ? { type, assoc: assoc as number } : null
}

function sanitizeAwarenessCursor(value: unknown): {
  anchor: SanitizedAwarenessPosition
  head: SanitizedAwarenessPosition
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const anchor = sanitizeAwarenessPosition(record.anchor)
  const head = sanitizeAwarenessPosition(record.head)
  return anchor && head ? { anchor, head } : null
}

function readLegacyTokenExpiration(token: string): number | null {
  const encodedPayload = token.split('.')[1]
  if (!encodedPayload) return null
  try {
    const payload: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    if (!payload || typeof payload !== 'object') return null
    const { exp, iat } = payload as Record<string, unknown>
    const now = Math.floor(Date.now() / 1000)
    if (
      typeof exp !== 'number'
      || !Number.isInteger(exp)
      || typeof iat !== 'number'
      || !Number.isInteger(iat)
      || exp <= now
      || exp <= iat
      || exp - iat > COLLAB_TOKEN_TTL_SECONDS
      || iat > now + COLLAB_TOKEN_CLOCK_SKEW_SECONDS
      || exp > now + COLLAB_TOKEN_TTL_SECONDS + COLLAB_TOKEN_CLOCK_SKEW_SECONDS
    ) {
      return null
    }
    return exp
  } catch {
    return null
  }
}

export function scheduleCollabConnectionExpiry(
  connection: CollabExpiryConnection,
  exp: number,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const clearExpiry = () => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }
  timer = setTimeout(() => {
    timer = null
    connection.close()
  }, Math.max(0, exp * 1000 - Date.now()))
  connection.onClose(clearExpiry)
  return clearExpiry
}

/**
 * Revalidate one active logical connection without retaining or scanning a
 * process-wide connection registry. Refreshes never overlap, and the timer is
 * released with the connection even when authorization infrastructure fails.
 */
export function scheduleCollabConnectionReauthorization(
  connection: CollabExpiryConnection,
  authorize: () => Promise<boolean>,
  intervalMs = DOCUMENTS_COLLAB_ACTIVE_REAUTHORIZATION_INTERVAL_MS,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const stop = (): void => {
    stopped = true
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }
  const schedule = (): void => {
    if (stopped) return
    timer = setTimeout(() => {
      timer = null
      void (async () => {
        let authorized = false
        try {
          authorized = await authorize()
        } catch {
          authorized = false
        }
        if (stopped) return
        if (!authorized) {
          stop()
          connection.close()
          return
        }
        schedule()
      })()
    }, Math.max(1, intervalMs))
    timer.unref?.()
  }

  connection.onClose(stop)
  schedule()
  return stop
}

export function handleCollabHealthRequest(
  request: CollabHealthRequest,
  response: CollabHealthResponse,
): boolean {
  const pathname = new URL(request.url ?? '/', 'http://documents-collab.local').pathname
  if (pathname !== '/healthz') return false

  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'GET') {
    response.statusCode = 405
    response.setHeader('Allow', 'GET')
    response.end()
    return true
  }

  const ready = isCollabTokenV2Ready()
  response.statusCode = ready ? 200 : 503
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({
    status: ready ? 'ok' : 'unavailable',
    service: 'documents-collab',
    capabilityTokenVersion: 2,
  }))
  return true
}

export async function handleCollabServerRequest(input: {
  request: CollabHealthRequest
  response: CollabHealthResponse
}): Promise<void> {
  if (handleCollabHealthRequest(input.request, input.response)) {
    return Promise.reject()
  }
}

/**
 * HTML-only legacy rows need one durable Yjs identity before they are sent to
 * a client. Hocuspocus installs its change listener after onLoadDocument, so a
 * conversion performed only in that hook is never scheduled for persistence.
 * A reconnect would then convert the same HTML with a new Yjs client ID and
 * merge duplicate content into the provider's retained local Y.Doc.
 *
 * The bootstrap is internal representation work, not a user edit: nativeUpdate
 * intentionally leaves updated_at unchanged and avoids a redundant reindex.
 */
export async function initializeDocumentYjsState(
  em: EntityManager,
  documentId: string,
  scope: CollabScope,
): Promise<Buffer | null> {
  return em.transactional(async (transactionalEm) => {
    // Serialize legacy-content bootstrap behind the aggregate root. This also
    // lets two first-time sockets safely repair a pre-M6 document that has no
    // DocumentContent row without racing the document_id unique constraint.
    const document = await findOneWithDecryption(
      transactionalEm,
      Document,
      {
        id: documentId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      scope,
    )
    if (!document) return null

    let content = await findOneWithDecryption(
      transactionalEm,
      DocumentContent,
      {
        documentId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE },
      scope,
    )
    if (!content) {
      content = transactionalEm.create(DocumentContent, {
        id: randomUUID(),
        documentId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        contentHtml: '',
        contentText: '',
        yjsState: null,
        collaborationGeneration: 1,
        deletedAt: null,
        updatedAt: new Date(),
      })
      transactionalEm.persist(content)
      await transactionalEm.flush()
      return null
    }
    if (content.deletedAt) {
      // A live document with a tombstoned content row represents a logically
      // blank body (for example an undo of its first legacy content write).
      // Repair the one-row invariant without reviving the tombstoned body.
      const now = new Date()
      content.yjsState = null
      content.contentHtml = ''
      content.contentText = ''
      content.deletedAt = null
      advanceDocumentCollaborationGeneration(content)
      content.updatedAt = now.getTime() > content.updatedAt.getTime()
        ? now
        : new Date(content.updatedAt.getTime() + 1)
      await transactionalEm.flush()
    }
    if (content.yjsState && content.yjsState.length > 0) {
      assertDocumentContentResourceLimits({
        yjsState: content.yjsState,
        contentHtml: content.contentHtml,
        contentText: content.contentText,
      })
      return Buffer.from(content.yjsState)
    }
    if (!content.contentHtml) return null

    assertDocumentContentResourceLimits({
      contentHtml: content.contentHtml,
      contentText: content.contentText,
    })
    const materialized = htmlToYDoc(content.contentHtml)
    const yjsState = Buffer.from(Y.encodeStateAsUpdate(materialized))
    assertDocumentContentResourceLimits({ yjsState, contentHtml: content.contentHtml })
    await transactionalEm.nativeUpdate(
      DocumentContent,
      {
        id: content.id,
        documentId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      { yjsState },
    )
    return yjsState
  })
}

export type CollabAuthorizationSnapshot = {
  relationshipTier: CollabTier | null
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
  organizationScope?: ResolvedDocumentsOrganizationScope | null
  archived?: boolean
}

export function isCollabAuthorizationCurrent(
  context: CollabContext,
  snapshot: CollabAuthorizationSnapshot,
): boolean {
  if (!hasResolvedDocumentsOrganizationAccess(
    snapshot,
    context.organizationId,
    snapshot.organizationScope,
  )) {
    return false
  }

  const features = snapshot.isSuperAdmin ? ['*'] : snapshot.features
  const managerOverride = hasAllFeatures(['documents.manage'], features)
  const relationshipTier = managerOverride ? 'owner' : snapshot.relationshipTier
  const capabilities = deriveDocumentCapabilities({
    relationshipTier,
    managerOverride,
    archived: snapshot.archived === true,
    userFeatures: features,
  })

  return capabilities.canView
    && relationshipTier === context.tier
    && context.readOnly === !capabilities.canEdit
}

/**
 * Re-resolve the actor's current ACL and document relationship whenever a
 * socket authenticates. Share events close existing sockets; this check makes
 * replaying their still-signed short-lived token fail even after a sidecar
 * restart, and also rejects capability downgrades or role-share removal.
 */
export async function authorizeCollabContext(
  container: CollabContainer,
  context: CollabContext,
): Promise<boolean> {
  try {
    const scope = {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    }
    const em = container.resolve('em') as EntityManager
    const rbacService = container.resolve('rbacService') as CollabRbacService
    let acl = await loadFreshCollabAcl(rbacService, context.userId, scope)
    if (!acl) return false

    let organizationScope: ResolvedDocumentsOrganizationScope | null = null
    if (!hasResolvedDocumentsOrganizationAccess(acl, context.organizationId)) {
      // Organization hierarchy resolution performs its own ACL read. Route it
      // through the same fail-closed fresh-load primitive so no secondary
      // lookup can revive a warm sidecar cache after a role/ACL revocation.
      const organizationScopeService = resolveOrganizationScopeService(container)
      if (!organizationScopeService) return false
      const freshAuthorization = await organizationScopeService.resolveFresh({
        auth: {
          sub: context.userId,
          userId: context.userId,
          tenantId: context.tenantId,
          orgId: context.organizationId,
          isSuperAdmin: false,
        },
        selectedId: context.organizationId,
        tenantId: context.tenantId,
      })
      organizationScope = freshAuthorization.scope
      acl = freshAuthorization.acl
      if (!hasResolvedDocumentsOrganizationAccess(
        acl,
        context.organizationId,
        organizationScope,
      )) {
        return false
      }
    }
    const features = acl.isSuperAdmin ? ['*'] : acl.features
    const managerOverride = hasAllFeatures(['documents.manage'], features)
    const relationshipTier = managerOverride
      ? 'owner'
      : await resolveUserAccess(
          em,
          context.documentId,
          scope,
          context.userId,
          container,
        )
    const documentRow = await findOneWithDecryption(
      em,
      Document,
      { id: context.documentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { fields: ['id', 'archivedAt', 'deletedAt'], filters: false },
      scope,
    )
    if (!documentRow || documentRow.deletedAt) return false
    return isCollabAuthorizationCurrent(context, {
      relationshipTier,
      isSuperAdmin: acl.isSuperAdmin,
      features: acl.features,
      organizations: acl.organizations,
      organizationScope,
      archived: documentRow?.archivedAt != null,
    })
  } catch (error) {
    // Fail closed, but leave a trace: an RBAC/DB outage otherwise surfaces
    // only as an unexplained mass disconnect.
    logger.warn('collab authorization check failed; failing closed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export function createCollabHooks(deps: CollabHooksDeps) {
  const materializationWarningRooms = new Set<string>()
  const loadedContentVersions = new WeakMap<Y.Doc, string>()
  const loadedCollaborationGenerations = new WeakMap<Y.Doc, number>()
  const roomResourceBudgets = new WeakMap<Y.Doc, { bytes: number; revision: number }>()
  const roomScopes = new WeakMap<Y.Doc, CollabScope>()
  const awarenessConnectionClientIds = new WeakMap<object, Set<number>>()
  const awarenessRoomClientOwners = new WeakMap<Y.Doc, Map<number, string>>()
  // Hocuspocus hands onStoreDocument only the room's lastContext, which can be
  // a read-only viewer even when the retained edits were authored by an
  // editor. Remember the most recent writable authorization per room identity
  // so a debounced store can still persist under a freshly re-validated
  // writable context. The WeakMap releases the entry with the Y.Doc when
  // Hocuspocus unloads or destroys the room.
  const roomWritableContexts = new WeakMap<Y.Doc, CollabContext>()

  const rememberWritableContext = (
    document: Y.Doc | undefined,
    context: CollabContext | undefined,
  ): void => {
    if (!document || !context || context.readOnly) return
    roomWritableContexts.set(document, context)
  }

  const isInvalidated = (documentName: string, document?: Y.Doc): boolean => (
    deps.isRoomInvalidated?.(documentName, document)
    ?? (document ? deps.isRoomClosing?.(documentName, document) : false)
    ?? false
  )

  const isFinalDrainPending = (documentName: string): boolean => {
    const room = deps.resolveRoomDocument?.(documentName)
    return Boolean(room && deps.finalDrainRegistry?.isMarked(room))
  }

  const assertRoomAcceptsAuthentication = (documentName: string): void => {
    if (isInvalidated(documentName)) {
      throw new Error('[internal] documents collab: room is reloading authoritative content')
    }
    if (isFinalDrainPending(documentName)) {
      throw new Error('[internal] documents collab: room is draining accepted edits')
    }
  }

  type StoreAuthorization = 'normal' | 'final-drain' | 'denied'

  const invalidateStoreRoom = (data: {
    documentName: string
    document: Y.Doc
  }): void => {
    deps.finalDrainRegistry?.discard(data.document)
    deps.invalidateRoom?.(data.documentName, data.document)
  }

  const retireFailedStore = (data: {
    documentName: string
    document: Y.Doc
  }, ownsGrant = false): boolean => {
    const invalidated = isInvalidated(data.documentName, data.document)
    if (
      !ownsGrant
      && !invalidated
      && !deps.finalDrainRegistry?.isMarked(data.document)
    ) return false
    if (invalidated) {
      deps.finalDrainRegistry?.discard(data.document)
    } else {
      invalidateStoreRoom(data)
    }
    // Keep this diagnostic bounded: persistence errors can contain driver
    // details or document data. Returning normally is intentional so
    // Hocuspocus reaches its zero-connection unload path instead of retaining
    // an invalidated, permanently authentication-blocked room.
    logger.error(invalidated
      ? 'invalidated store failed; retiring in-memory room'
      : 'final drain failed; retiring in-memory room')
    return true
  }

  const assertConnectionAuthorization = (context: CollabContext): void => {
    if (!deps.finalDrainRegistry) return
    const lifecycle = (context as TicketedCollabContext)[COLLAB_AUTHORIZATION_LIFECYCLE]
    if (lifecycle?.established) return
    if (
      !lifecycle?.ticket
      || !deps.finalDrainRegistry.isAuthorizationCurrent(lifecycle.ticket)
    ) {
      throw new Error('[internal] documents collab: access changed during connection setup')
    }
    assertRoomAcceptsAuthentication(context.documentId)
  }

  const establishConnectionAuthorization = (context: CollabContext): void => {
    if (!deps.finalDrainRegistry) return
    assertConnectionAuthorization(context)
    const lifecycle = (context as TicketedCollabContext)[COLLAB_AUTHORIZATION_LIFECYCLE]
    if (!lifecycle) return
    if (lifecycle.ticket) deps.finalDrainRegistry.endAuthorization(lifecycle.ticket)
    lifecycle.ticket = undefined
    lifecycle.established = true
  }

  const releaseConnectionAuthorization = (context: CollabContext): void => {
    if (!deps.finalDrainRegistry) return
    const ticketedContext = context as TicketedCollabContext
    const lifecycle = ticketedContext[COLLAB_AUTHORIZATION_LIFECYCLE]
    if (lifecycle?.ticket) deps.finalDrainRegistry.endAuthorization(lifecycle.ticket)
    delete ticketedContext[COLLAB_AUTHORIZATION_LIFECYCLE]
  }

  const authorizeStoreAttempt = async (data: {
    documentName: string
    context: CollabContext
    document: Y.Doc
  }): Promise<StoreAuthorization> => {
    let finalDrain: CollabFinalDrainConsumeResult = 'unmarked'
    if (deps.finalDrainRegistry?.isMarked(data.document)) {
      finalDrain = await deps.finalDrainRegistry.consume(data.document)
      if (finalDrain === 'busy') {
        // Another store owns the one-shot grant. It alone keeps the room
        // marked through persistence; this duplicate must be inert.
        return 'denied'
      }
      if (finalDrain === 'connected' || finalDrain === 'failed') {
        invalidateStoreRoom(data)
        return 'denied'
      }
    }

    let authorized: boolean
    try {
      authorized = await deps.authorizeContext(data.context)
    } catch {
      // Authorization infrastructure failures are security failures here. A
      // room containing edits accepted under an unverified capability must
      // never remain eligible for a later debounced/retried store. Complete
      // normally after invalidation so Hocuspocus can retire the mapped room.
      invalidateStoreRoom(data)
      logger.error('store authorization failed; retiring in-memory room')
      return 'denied'
    }

    // Content replacement/deletion invalidation always wins over a share
    // final drain. It is never safe to merge the old collaboration epoch.
    if (isInvalidated(data.documentName, data.document)) {
      deps.finalDrainRegistry?.discard(data.document)
      return 'denied'
    }

    // A store can start its live ACL check immediately before the trusted
    // event marks the room. Re-read and claim the drain after that async
    // boundary so the store still waits for every pre-close queue.
    if (finalDrain === 'unmarked') {
      finalDrain = await (deps.finalDrainRegistry?.consume(data.document)
        ?? Promise.resolve('unmarked' as const))
    }
    if (finalDrain === 'busy') return 'denied'
    if (finalDrain === 'connected' || finalDrain === 'failed') {
      // Seeing a live connection after every captured queue drained means the
      // room was recycled, reconnected, or has a direct connection. Missing,
      // malformed, or rejected queue readiness is equally untrusted.
      invalidateStoreRoom(data)
      return 'denied'
    }
    if (finalDrain === 'consumed') return 'final-drain'

    if (authorized) return 'normal'

    // Revoke the whole room identity, not only this store invocation. This
    // closes its sockets in production and prevents its unauthorized Y.Doc
    // from being persisted by a later debounce after access is restored.
    invalidateStoreRoom(data)
    return 'denied'
  }

  const reauthorizeActiveConnection = async (context: CollabContext): Promise<boolean> => {
    if (isInvalidated(context.documentId) || isFinalDrainPending(context.documentId)) {
      return false
    }

    let authorized = false
    try {
      authorized = await deps.authorizeContext(context)
    } catch {
      authorized = false
    }

    // A trusted document event that crossed the ACL refresh already owns the
    // room shutdown/final-drain decision. Do not replace it with invalidation.
    if (isInvalidated(context.documentId) || isFinalDrainPending(context.documentId)) {
      return false
    }
    if (authorized) {
      const resolveRoomDocument = deps.resolveRoomDocument
      // Production active connections always belong to an exact mapped room.
      // Keep the hook backwards-compatible for embedders that do not expose
      // room resolution, but close a connection whose production mapping has
      // already disappeared instead of authorizing a stale logical socket.
      if (!resolveRoomDocument) return true
      const room = resolveRoomDocument(context.documentId)
      if (!room) return false

      const loadedGeneration = loadedCollaborationGenerations.get(room)
      let durableGeneration: number | null = null
      try {
        const container = await deps.resolveContainer()
        const em = container.resolve('em')
        const scope = {
          tenantId: context.tenantId,
          organizationId: context.organizationId,
        }
        if (deps.loadCollaborationGeneration) {
          durableGeneration = await deps.loadCollaborationGeneration(
            em,
            context.documentId,
            scope,
          )
        } else {
          const content = await deps.loadContent(em, context.documentId, scope)
          durableGeneration = normalizeDocumentCollaborationGeneration(
            content?.collaborationGeneration,
          )
        }
      } catch {
        durableGeneration = null
      }

      // A trusted event may have reached this process while the durable read
      // was in flight. Its invalidation/final-drain path owns room retirement.
      if (isInvalidated(context.documentId) || isFinalDrainPending(context.documentId)) {
        return false
      }
      // Never apply a stale connection's refresh result to a replacement room
      // that loaded after an unload/reconnect race.
      if (resolveRoomDocument(context.documentId) !== room) return false

      if (
        loadedGeneration !== undefined
        && durableGeneration !== null
        && durableGeneration === loadedGeneration
      ) {
        rememberWritableContext(room, context)
        return true
      }

      // Reconcile a missed cross-process content-reset/deletion event from the
      // durable, scoped DocumentContent generation. Retiring the old Y.Doc is
      // required so no pre-reset update can later pass the store CAS and merge
      // back into the authoritative epoch.
      invalidateStoreRoom({
        documentName: context.documentId,
        document: room,
      })
      return false
    }

    // A failed active refresh can follow an RBAC/role change that did not name
    // a document. Retire only the exact mapped room; the per-connection timer
    // avoids any global room or connection scan.
    const room = deps.resolveRoomDocument?.(context.documentId)
    if (room) {
      invalidateStoreRoom({
        documentName: context.documentId,
        document: room,
      })
    }
    return false
  }

  return {
    assertConnectionAuthorization,
    establishConnectionAuthorization,
    releaseConnectionAuthorization,
    reauthorizeActiveConnection,
    recordRedisAggregate(document: Y.Doc, byteLength: number): void {
      const previous = roomResourceBudgets.get(document)
      roomResourceBudgets.set(document, {
        bytes: byteLength,
        revision: (previous?.revision ?? 0) + 1,
      })
    },
    resolveCollaborationGeneration(document: Y.Doc): number | undefined {
      return loadedCollaborationGenerations.get(document)
    },
    resolveRoomScope(document: Y.Doc): CollabScope | null {
      return roomScopes.get(document) ?? null
    },
    async onAuthenticate(data: {
      token?: string
      documentName: string
      connection: CollabConnection
      requestHeaders?: RequestHeaders
    }): Promise<CollabContext> {
      if (!isCollabRequestOriginAllowed({
        origin: readHeader(data.requestHeaders, 'origin'),
        allowedOrigins: deps.allowedOrigins,
        requireOrigin: deps.requireOrigin ?? process.env.NODE_ENV === 'production',
      })) {
        throw new Error('[internal] documents collab: origin not allowed')
      }

      const context = resolveCollabClaims(deps, data.token ?? '')
      if (!context) {
        throw new Error('[internal] documents collab: invalid token')
      }
      if (context.documentId !== data.documentName) {
        throw new Error('[internal] documents collab: room mismatch')
      }
      const authorizationTicket = deps.finalDrainRegistry
        ?.beginAuthorization(data.documentName, {
          tenantId: context.tenantId,
          organizationId: context.organizationId,
        })
      let retainAuthorizationTicket = false
      try {
        assertRoomAcceptsAuthentication(data.documentName)
        if (!(await deps.authorizeContext(context))) {
          throw new Error('[internal] documents collab: stale or revoked token')
        }

        const awarenessName = await deps.resolveAwarenessName?.(context)
        // Label resolution is another async boundary and the old room can even
        // unmap while it is in flight. Re-resolve live authorization after it,
        // then synchronously verify the bounded event ticket and exact mapped
        // room tombstone before admitting the connection.
        if (!(await deps.authorizeContext(context))) {
          throw new Error('[internal] documents collab: stale or revoked token')
        }
        if (
          authorizationTicket
          && !deps.finalDrainRegistry?.isAuthorizationCurrent(authorizationTicket)
        ) {
          throw new Error('[internal] documents collab: access changed during authentication')
        }
        assertRoomAcceptsAuthentication(data.documentName)
        context.awarenessUser = createCanonicalCollaborationAwarenessUser(
          context.userId,
          awarenessName,
        )
        data.connection.readOnly = context.readOnly
        if (authorizationTicket) {
          (context as TicketedCollabContext)[COLLAB_AUTHORIZATION_LIFECYCLE] = {
            established: false,
            ticket: authorizationTicket,
          }
          retainAuthorizationTicket = true
        }
        return context
      } finally {
        if (authorizationTicket && !retainAuthorizationTicket) {
          deps.finalDrainRegistry?.endAuthorization(authorizationTicket)
        }
      }
    },

    async beforeHandleAwareness(data: {
      context?: CollabContext
      states: Map<number, Record<string, unknown>>
      ownedClientIds?: ReadonlySet<number>
      occupiedClientIds?: ReadonlySet<number>
      connection?: object
      document?: Y.Doc
    }): Promise<void> {
      let claimedClientIds: Set<number> | undefined
      if (data.connection) {
        claimedClientIds = awarenessConnectionClientIds.get(data.connection)
        if (!claimedClientIds) {
          claimedClientIds = new Set()
          awarenessConnectionClientIds.set(data.connection, claimedClientIds)
        }
      }
      let roomClientOwners: Map<number, string> | undefined
      if (data.document) {
        roomClientOwners = awarenessRoomClientOwners.get(data.document)
        if (!roomClientOwners) {
          roomClientOwners = new Map()
          awarenessRoomClientOwners.set(data.document, roomClientOwners)
        }
      }
      bindCollabAwarenessStates(
        data.context,
        data.states,
        data.ownedClientIds && data.occupiedClientIds
          ? {
              ownedClientIds: data.ownedClientIds,
              occupiedClientIds: data.occupiedClientIds,
              claimedClientIds,
              roomClientOwners,
            }
          : undefined,
      )
    },

    async onLoadDocument(data: {
      documentName: string
      context: CollabContext
      document: Y.Doc
    }): Promise<Y.Doc> {
      assertScopedContext(data.context)
      roomScopes.set(data.document, {
        tenantId: data.context.tenantId,
        organizationId: data.context.organizationId,
      })
      rememberWritableContext(data.document, data.context)

      const container = await deps.resolveContainer()
      const em = container.resolve('em')
      const scope = {
        tenantId: data.context.tenantId,
        organizationId: data.context.organizationId,
      }
      let content = await deps.loadContent(em, data.documentName, scope)
      if (!content) {
        // Pre-M6 document creation was a two-request flow, so durable legacy
        // rows can legitimately exist without DocumentContent. Repair that
        // representation under the aggregate lock, then load its CAS version.
        await deps.initializeYjsState(em, data.documentName, scope)
        content = await deps.loadContent(em, data.documentName, scope)
      }
      const loadedVersion = normalizeContentVersion(content?.updatedAt)
      if (!loadedVersion) {
        throw new Error('[internal] documents collab: content row has no durable version')
      }
      if (content?.yjsState && content.yjsState.length > 0) {
        assertDocumentContentResourceLimits({
          yjsState: content.yjsState,
          contentHtml: content.contentHtml,
        })
        Y.applyUpdate(data.document, new Uint8Array(content.yjsState))
        roomResourceBudgets.set(data.document, {
          bytes: content.yjsState.byteLength,
          revision: 0,
        })
      } else if (content?.contentHtml) {
        assertDocumentContentResourceLimits({ contentHtml: content.contentHtml })
        const initializedState = await deps.initializeYjsState(
          em,
          data.documentName,
          scope,
        )
        if (initializedState && initializedState.length > 0) {
          Y.applyUpdate(data.document, new Uint8Array(initializedState))
          roomResourceBudgets.set(data.document, {
            bytes: initializedState.byteLength,
            revision: 0,
          })
        }
      }
      if (!roomResourceBudgets.has(data.document)) {
        roomResourceBudgets.set(data.document, { bytes: 0, revision: 0 })
      }

      const collaborationGeneration = normalizeDocumentCollaborationGeneration(
        content?.collaborationGeneration,
      )
      if (collaborationGeneration === null) {
        throw new Error('[internal] documents collab: content row has no durable collaboration generation')
      }
      loadedContentVersions.set(data.document, loadedVersion)
      loadedCollaborationGenerations.set(data.document, collaborationGeneration)
      return data.document
    },

    async beforeSync(data: {
      type: number
      payload: Uint8Array
      document: Y.Doc
      connection: { readOnly: boolean; close?: () => void }
      context?: CollabContext
    }): Promise<void> {
      // SyncStep1 contains only a state vector. Read-only SyncStep2/updates are
      // dropped by Hocuspocus and must not consume the writable room budget.
      if (data.connection.readOnly || (data.type !== 1 && data.type !== 2)) return
      // Revalidate the exact writer before Hocuspocus applies the frame. The
      // periodic connection refresh protects idle sockets, but it leaves a
      // bounded revocation window in which an update could otherwise enter the
      // shared Y.Doc and later be persisted under another writer's context.
      // MessageReceiver awaits beforeSync before readSyncStep2/readUpdate, so a
      // rejected frame never reaches local peers or Redis.
      let authorized = false
      if (data.context && !isInvalidated(data.context.documentId, data.document)) {
        try {
          authorized = await deps.authorizeContext(data.context)
        } catch {
          authorized = false
        }
      }
      if (
        !authorized
        || !data.context
        || isInvalidated(data.context.documentId, data.document)
        || isFinalDrainPending(data.context.documentId)
      ) {
        data.connection.close?.()
        if (data.context) {
          invalidateStoreRoom({
            documentName: data.context.documentId,
            document: data.document,
          })
        }
        throw new Error('[internal] documents collab: write authorization is no longer current')
      }
      rememberWritableContext(data.document, data.context)
      const budget = roomResourceBudgets.get(data.document) ?? { bytes: 0, revision: 0 }
      const nextBytes = budget.bytes + data.payload.byteLength
      assertDocumentYjsStateByteLength(nextBytes)
      budget.bytes = nextBytes
      budget.revision += 1
      roomResourceBudgets.set(data.document, budget)
    },

    async onStoreDocument(data: {
      documentName: string
      context: CollabContext
      document: Y.Doc
    }): Promise<void> {
      try {
        assertScopedContext(data.context)
      } catch (error) {
        if (retireFailedStore(data)) return
        throw error
      }
      if (isInvalidated(data.documentName, data.document)) return
      if (data.context.readOnly) {
        // Edits retained by this room were necessarily authored by a writable
        // connection: read-only sync frames are dropped before they reach the
        // Y.Doc. Fall back to the room's last writable authorization so a
        // viewer being the last-seen context cannot silently drop the
        // debounced store; authorizeStoreAttempt below re-validates that
        // context's live access before anything is persisted. A room with no
        // recorded writable context has nothing a viewer could have authored.
        const writableContext = roomWritableContexts.get(data.document)
        if (!writableContext) {
          retireFailedStore(data)
          return
        }
        data = { ...data, context: writableContext }
      } else {
        rememberWritableContext(data.document, data.context)
      }

      let expectedUpdatedAt = loadedContentVersions.get(data.document)
      let collaborationGeneration = loadedCollaborationGenerations.get(data.document)
      if (!expectedUpdatedAt || collaborationGeneration === undefined) {
        const error = new Error('[internal] documents collab: room store has no loaded content version')
        if (retireFailedStore(data)) return
        throw error
      }
      let em: unknown
      let searchIndexer: unknown
      try {
        const container = await deps.resolveContainer()
        em = container.resolve('em')
        searchIndexer = container.resolve('searchIndexer')
      } catch (error) {
        if (retireFailedStore(data)) return
        throw error
      }
      const scope = {
        tenantId: data.context.tenantId,
        organizationId: data.context.organizationId,
      }
      let finalDrainAuthorized = false

      try {
        for (let attempt = 0; attempt < MAX_COLLAB_STORE_ATTEMPTS; attempt += 1) {
          if (isInvalidated(data.documentName, data.document)) {
            if (finalDrainAuthorized) deps.finalDrainRegistry?.discard(data.document)
            return
          }
          if (!finalDrainAuthorized) {
            // Re-resolve ACL, organization scope, relationship tier/share, and
            // edit capability immediately before every normal persistence
            // attempt, including every multi-replica CAS retry. The sole
            // exception is a one-shot trusted share-event drain whose sockets
            // are already gone; that consumed grant remains local to this one
            // store invocation so its bounded CAS merge can finish.
            const authorization = await authorizeStoreAttempt(data)
            if (authorization === 'denied') return
            finalDrainAuthorized = authorization === 'final-drain'
          }

          // Authorization and a final-drain queue wait both cross async
          // boundaries. Snapshot only afterwards so every frame accepted before
          // closeConnections (and every update merged for a CAS retry) is part
          // of the exact state that becomes durable.
          if (isInvalidated(data.documentName, data.document)) {
            if (finalDrainAuthorized) deps.finalDrainRegistry?.discard(data.document)
            return
          }
          const materialized = yDocToContent(data.document)
          if (materialized) materializationWarningRooms.delete(data.documentName)
          if (!materialized && !materializationWarningRooms.has(data.documentName)) {
            materializationWarningRooms.add(data.documentName)
            logger.warn('materialization failed; preserving previous html/text', { room: data.documentName })
          }
          const yjsState = Buffer.from(Y.encodeStateAsUpdate(data.document))
          const resourceBudgetRevision = roomResourceBudgets.get(data.document)?.revision ?? 0
          assertDocumentContentResourceLimits({
            yjsState,
            contentHtml: materialized?.html,
            contentText: materialized?.text,
          })

          let persisted: { updatedAt: string | Date; collaborationGeneration: number }
          try {
            persisted = await deps.persistContent(
              em,
              data.documentName,
              scope,
              materialized
                ? {
                    yjsState,
                    contentHtml: materialized.html,
                    contentText: materialized.text,
                  }
                : { yjsState },
              {
                searchIndexer,
                expectedUpdatedAt,
                expectedCollaborationGeneration: collaborationGeneration,
                requireExpectedVersion: true,
              },
            )
          } catch (error) {
            // An explicit replace/restore event can arrive while the CAS waits.
            // Its room marker always wins and stale content is discarded.
            if (isInvalidated(data.documentName, data.document)) {
              if (finalDrainAuthorized) deps.finalDrainRegistry?.discard(data.document)
              return
            }
            const isVersionConflict = isCrudHttpError(error)
              && error.status === 409
              && error.body.code === OPTIMISTIC_LOCK_CONFLICT_CODE
            if (!isVersionConflict) throw error

            // A normal competing store from another sidecar replica shares the
            // same server-owned collaboration generation. Merge its
            // authoritative Yjs update into this room and retry against its new
            // version so neither replica's edit depends on a client reconnect to
            // become durable.
            const authoritative = await deps.loadContent(em, data.documentName, scope)
            const authoritativeVersion = normalizeContentVersion(authoritative?.updatedAt)
            if (!authoritativeVersion) {
              invalidateStoreRoom(data)
              return
            }
            const authoritativeGeneration = normalizeDocumentCollaborationGeneration(
              authoritative?.collaborationGeneration,
            )
            if (authoritativeGeneration === null) {
              invalidateStoreRoom(data)
              return
            }
            const authoritativeDocument = authoritative?.yjsState?.length
              ? new Y.Doc()
              : htmlToYDoc(authoritative?.contentHtml ?? '')
            if (authoritative?.yjsState?.length) {
              assertDocumentContentResourceLimits({
                yjsState: authoritative.yjsState,
                contentHtml: authoritative.contentHtml,
              })
              Y.applyUpdate(authoritativeDocument, new Uint8Array(authoritative.yjsState))
            }
            if (
              authoritativeGeneration !== collaborationGeneration
              || isInvalidated(data.documentName, data.document)
            ) {
              // A changed generation is an intentional content replacement/restore,
              // even if its event has not reached this replica yet. Never merge
              // pre-reset edits back into the new authoritative document.
              invalidateStoreRoom(data)
              return
            }

          Y.applyUpdate(
            data.document,
            Y.encodeStateAsUpdate(authoritativeDocument),
            {
              source: 'local',
              skipStoreHooks: true,
              context: data.context,
            },
          )
            expectedUpdatedAt = authoritativeVersion
            collaborationGeneration = authoritativeGeneration
            loadedContentVersions.set(data.document, authoritativeVersion)
            loadedCollaborationGenerations.set(data.document, authoritativeGeneration)
            if (attempt + 1 >= MAX_COLLAB_STORE_ATTEMPTS) throw error
            continue
          }

          if (isInvalidated(data.documentName, data.document)) {
            if (finalDrainAuthorized) deps.finalDrainRegistry?.discard(data.document)
            return
          }
          const persistedVersion = normalizeContentVersion(persisted.updatedAt)
          if (!persistedVersion) {
            throw new Error('[internal] documents collab: content store returned no durable version')
          }
          if (persisted.collaborationGeneration !== collaborationGeneration) {
            invalidateStoreRoom(data)
            return
          }
          loadedContentVersions.set(data.document, persistedVersion)
          loadedCollaborationGenerations.set(data.document, collaborationGeneration)
          const currentBudget = roomResourceBudgets.get(data.document)
          if (!currentBudget || currentBudget.revision === resourceBudgetRevision) {
            roomResourceBudgets.set(data.document, {
              bytes: yjsState.byteLength,
              revision: resourceBudgetRevision,
            })
          }
          deps.onPersisted?.(data.document, yjsState, collaborationGeneration)
          if (finalDrainAuthorized) deps.finalDrainRegistry?.complete(data.document)
          return
        }
      } catch (error) {
        if (isCrudHttpError(error) && error.status === 413) {
          // A Redis/CAS merge can make the complete room exceed the aggregate
          // resource limit even though each individual inbound frame passed.
          // Retire the room so the oversized state cannot be retried, fanned
          // out, or later persisted under another connection's context.
          invalidateStoreRoom(data)
          logger.warn('retiring collaboration room that exceeded content limits', {
            room: data.documentName,
          })
          return
        }
        // Ordinary store failures retain Hocuspocus' normal retry/data-loss
        // protection. A final drain cannot: with every socket already closed,
        // rethrowing makes Hocuspocus retain an invalidated mapped Y.Doc and
        // block every future authentication forever. Retire it fail-closed
        // and complete the hook normally so Hocuspocus schedules unload.
        if (retireFailedStore(data, finalDrainAuthorized)) return
        throw error
      }
    },
  }
}

function headersToRecord(headers: Headers): RequestHeaders {
  return { origin: headers.get('origin') ?? undefined }
}

function eventDocumentId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  const id = record.documentId ?? record.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

export type CollabRoomEventAction = 'ignore' | 'reauth' | 'invalidate'

/**
 * Access changes only require sockets to re-authenticate. Suppressing a store
 * for those events can drop edits made shortly after a share is created or
 * changed. Content-invalidating events must additionally prevent the closing
 * room's stale Y.Doc from overwriting the authoritative database state.
 */
export function resolveCollabRoomEventAction(event: string, payload?: unknown): CollabRoomEventAction {
  if (
    event === 'documents.document.shared'
    || event === 'documents.document.unshared'
    || event === 'documents.document.archived'
    || event === 'documents.document.unarchived'
  ) {
    return 'reauth'
  }
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  if (
    event === 'documents.document.deleted'
    || event === 'documents.version.restored'
    || (event === 'documents.document.updated' && record?.contentEpochReset === true)
  ) {
    return 'invalidate'
  }
  return 'ignore'
}

type DocumentsCrossProcessEventEnvelope = {
  event: string
  payload: unknown
  options?: {
    tenantId?: unknown
    organizationId?: unknown
    emitterModuleId?: unknown
  }
  originPid?: unknown
  originInstanceId?: unknown
}

export type TrustedDocumentsCrossProcessEvent = {
  action: Exclude<CollabRoomEventAction, 'ignore'>
  documentId: string
  scope: CollabScope
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * Resolve only private Documents events stamped by the Documents module and
 * carrying trusted envelope scope. Payload scope is intentionally ignored: it
 * is application data and can be authored by a workflow.
 */
export function resolveTrustedDocumentsCrossProcessEvent(
  envelope: DocumentsCrossProcessEventEnvelope,
): TrustedDocumentsCrossProcessEvent | null {
  if (envelope.options?.emitterModuleId !== 'documents') return null
  const tenantId = nonEmptyString(envelope.options?.tenantId)
  const organizationId = nonEmptyString(envelope.options?.organizationId)
  if (!tenantId || !organizationId) return null
  const action = resolveCollabRoomEventAction(envelope.event, envelope.payload)
  if (action === 'ignore') return null
  const documentId = eventDocumentId(envelope.payload)
  if (!documentId) return null
  return {
    action,
    documentId,
    scope: { tenantId, organizationId },
  }
}

export function isTrustedDocumentsCollabRoomScope(
  event: TrustedDocumentsCrossProcessEvent,
  roomScope: CollabScope | null,
): boolean {
  return roomScope?.tenantId === event.scope.tenantId
    && roomScope.organizationId === event.scope.organizationId
}

/**
 * The Events bridge stamps every envelope this sidecar publishes with its
 * random per-process instance id, so an envelope without one is provably
 * foreign. Falling back to originPid would discard it whenever another
 * container happens to share our pid — commonly pid 1 — silently dropping
 * reauth and invalidation across a rolling deploy.
 */
export function isOwnDocumentsCrossProcessEvent(
  envelope: DocumentsCrossProcessEventEnvelope,
  ownInstanceId: string,
): boolean {
  return envelope.originInstanceId === ownInstanceId
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  return Boolean(entry && import.meta.url === pathToFileURL(resolve(entry)).href)
}

export async function main(): Promise<void> {
  const [
    { Connection, Server },
    { bootstrapFromAppRoot },
    { createRequestContainer },
    { registerCrossProcessEventListener, CROSS_PROCESS_EVENT_INSTANCE_ID },
  ] = await Promise.all([
    import('@hocuspocus/server'),
    import('@open-mercato/shared/lib/bootstrap/dynamicLoader'),
    import('@open-mercato/shared/lib/di/container'),
    import('@open-mercato/events'),
  ])

  installHocuspocusCollabIngressGuard(Connection)

  const appRoot = process.env.DOCUMENTS_COLLAB_APP_ROOT || undefined
  await bootstrapFromAppRoot(appRoot)

  const port = Number(process.env.DOCUMENTS_COLLAB_PORT || 4101)
  const allowedOrigins = resolveCollabAllowedOrigins(process.env)
  // Invalidated room identities stay marked for their whole lifetime. The
  // WeakSet releases them only after Hocuspocus unloads/destroys the Y.Doc;
  // unlike a timer, a slow debounced/in-flight store can never become writable
  // again merely because cleanup took longer than expected.
  const invalidatedRoomDocuments = new WeakSet<Y.Doc>()
  const finalDrainRegistry = createCollabFinalDrainRegistry()
  let server: HocuspocusServer<CollabContext> | null = null
  let redisStoreExtension: DocumentsCollabRedisExtension | null = null
  const invalidateRoom = (documentName: string, document: Y.Doc): void => {
    redisStoreExtension?.discardPendingFanout(documentName, document)
    finalDrainRegistry.discard(document)
    invalidatedRoomDocuments.add(document)
    server?.hocuspocus.closeConnections(documentName)
  }
  const legacyTokenVerifier = resolveLegacyCollabTokenVerifier(process.env)
  const hooks = createCollabHooks({
    ...(legacyTokenVerifier ? { verifyToken: legacyTokenVerifier } : {}),
    verifyTokenV2: verifyCollabTokenV2,
    authorizeContext: async (context) => {
      const container = await createRequestContainer()
      return authorizeCollabContext(container, context)
    },
    resolveAwarenessName: async (context) => {
      const container = await createRequestContainer()
      const labels = await resolveUserLabels(
        container,
        {
          tenantId: context.tenantId,
          organizationId: context.organizationId,
        },
        [context.userId],
      )
      return labels.get(context.userId)?.label ?? null
    },
    resolveContainer: () => createRequestContainer(),
    loadContent: async (em, id, scope) => {
      const content = await loadDocumentContentForCollaboration(
        em as EntityManager,
        id,
        scope,
      )
      if (!content) return null
      return {
        yjsState: content.yjsState ?? null,
        contentHtml: content.contentHtml ?? null,
        updatedAt: content.updatedAt,
        collaborationGeneration: content.collaborationGeneration,
      }
    },
    loadCollaborationGeneration: (em, id, scope) => loadDocumentCollaborationGeneration(
      em as EntityManager,
      id,
      scope,
    ),
    initializeYjsState: (em, id, scope) => initializeDocumentYjsState(
      em as EntityManager,
      id,
      scope,
    ),
    persistContent: (em, id, scope, input, serviceDeps) => persistDocumentContent(
      em as EntityManager,
      id,
      scope,
      input,
      serviceDeps as PersistDocumentContentDeps,
    ),
    allowedOrigins,
    requireOrigin: process.env.NODE_ENV === 'production',
    onPersisted: (document, yjsState, collaborationGeneration) => {
      redisStoreExtension?.markPersisted(document, yjsState, collaborationGeneration)
    },
    finalDrainRegistry,
    resolveRoomDocument: (documentName) => server?.hocuspocus.documents.get(documentName),
    isRoomInvalidated: (documentName, document) => {
      const room = document ?? server?.hocuspocus.documents.get(documentName)
      return Boolean(room && invalidatedRoomDocuments.has(room))
    },
    invalidateRoom,
  })

  const runningServer: HocuspocusServer<CollabContext> = new Server<CollabContext>({
    port,
    ...COLLAB_SERVER_RUNTIME_CONFIGURATION,
    extensions: resolveDocumentsCollabRedisExtensions(
      process.env,
      (configuration) => {
        redisStoreExtension = new DocumentsCollabRedisExtension(configuration, {
          resolveCollaborationGeneration: hooks.resolveCollaborationGeneration,
          onRejectedAggregate: invalidateRoom,
          onAcceptedAggregate: (document, byteLength) => {
            hooks.recordRedisAggregate(document, byteLength)
          },
        })
        return enforceDocumentsCollabSourceStoreOwnership(redisStoreExtension)
      },
    ),
    async onAuthenticate(data: onAuthenticatePayload<CollabContext>) {
      return await hooks.onAuthenticate({
        token: data.token,
        documentName: data.documentName,
        connection: data.connectionConfig,
        requestHeaders: headersToRecord(data.requestHeaders),
      })
    },
    async connected(data: connectedPayload<CollabContext>) {
      try {
        hooks.establishConnectionAuthorization(data.context)
      } catch (error) {
        data.connection.close()
        hooks.releaseConnectionAuthorization(data.context)
        throw error
      }
      if (data.context.exp !== null) {
        scheduleCollabConnectionExpiry(data.connection, data.context.exp)
      }
      scheduleCollabConnectionReauthorization(
        data.connection,
        () => hooks.reauthorizeActiveConnection(data.context),
      )
    },
    async beforeHandleMessage(data: beforeHandleMessagePayload<CollabContext>) {
      try {
        hooks.assertConnectionAuthorization(data.context)
      } catch (error) {
        data.connection.close()
        hooks.releaseConnectionAuthorization(data.context)
        throw error
      }
      assertCollabInboundFramePolicy(data.update, {
        readOnly: data.connection.readOnly,
      })
    },
    async beforeHandleAwareness(data: beforeHandleAwarenessPayload<CollabContext>) {
      // Redis replication has no browser connection/context. Its awareness
      // payload was already authenticated, size-bounded, and canonicalized at
      // the source replica, so only client-originated frames enter the
      // per-connection identity guard below.
      if (!data.connection) return
      return hooks.beforeHandleAwareness({
        context: data.context,
        states: data.states,
        ownedClientIds: new Set(data.document.getClients(data.connection)),
        occupiedClientIds: new Set(data.awareness.getStates().keys()),
        connection: data.connection,
        document: data.document,
      })
    },
    async beforeSync(data: beforeSyncPayload<CollabContext>) {
      return hooks.beforeSync({
        type: data.type,
        payload: data.payload,
        document: data.document,
        connection: data.connection,
        context: data.context,
      })
    },
    async onLoadDocument(data: onLoadDocumentPayload<CollabContext>) {
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
        // Hocuspocus has not mapped this freshly created Document yet, so its
        // unload helper cannot destroy the Y.Doc on a load-hook failure.
        data.document.destroy()
        throw error
      }
    },
    async afterLoadDocument(data: afterLoadDocumentPayload<CollabContext>) {
      try {
        hooks.assertConnectionAuthorization(data.context)
      } catch (error) {
        hooks.releaseConnectionAuthorization(data.context)
        data.document.destroy()
        throw error
      }
    },
    async onStoreDocument(data: onStoreDocumentPayload<CollabContext>) {
      if (!isDocumentsCollabSourceStore(data)) return
      return await hooks.onStoreDocument({
        documentName: data.documentName,
        context: data.lastContext,
        document: data.document,
      })
    },
    async onRequest(data: onRequestPayload) {
      return handleCollabServerRequest(data)
    },
    async onDisconnect(data: onDisconnectPayload<CollabContext>) {
      hooks.releaseConnectionAuthorization(data.context)
    },
  })
  server = runningServer

  await runningServer.listen()

  registerCrossProcessEventListener((envelope: DocumentsCrossProcessEventEnvelope) => {
    if (isOwnDocumentsCrossProcessEvent(envelope, CROSS_PROCESS_EVENT_INSTANCE_ID)) return
    const trustedEvent = resolveTrustedDocumentsCrossProcessEvent(envelope)
    if (!trustedEvent) return
    const { action, documentId, scope } = trustedEvent

    // Bump the exact scoped handshake epoch before consulting live room
    // metadata. A room can be mapped during the narrow load transition before
    // its scope WeakMap is observable here; scoped tickets still let the event
    // reject that in-flight authentication without touching another tenant.
    finalDrainRegistry.bumpAuthorization(documentId, scope)
    const roomDocument = runningServer.hocuspocus.documents.get(documentId)
    if (
      roomDocument
      && !isTrustedDocumentsCollabRoomScope(trustedEvent, hooks.resolveRoomScope(roomDocument))
    ) {
      return
    }
    if (roomDocument && action === 'reauth') {
      // Capture every exact connection queue before closeConnections removes
      // those logical connections synchronously. The one-shot store cannot
      // snapshot or unblock reconnects until all captured queues have drained.
      markCollabFinalDrainForReauth(roomDocument, finalDrainRegistry)
    }
    if (action === 'invalidate') {
      // A durable fanout intentionally survives ordinary unload, so discard by
      // room name even when no Y.Doc is currently mapped. When one is mapped,
      // also tombstone that exact identity so a store already releasing its
      // lock cannot enqueue the pre-invalidation generation afterwards.
      redisStoreExtension?.discardPendingFanout(documentId)
      if (roomDocument) {
        redisStoreExtension?.discardPendingFanout(documentId, roomDocument)
        finalDrainRegistry.discard(roomDocument)
        invalidatedRoomDocuments.add(roomDocument)
      }
    }
    runningServer.hocuspocus.closeConnections(documentId)
  })

  // Hocuspocus debounces onStoreDocument, so an unhandled SIGTERM/SIGINT
  // (docker stop, redeploy) would drop the last seconds of edits. destroy()
  // unloads every document, which drains pending stores before the process
  // exits.
  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('shutting down; draining pending document stores', { signal })
    void runningServer
      .destroy()
      .catch((error: unknown) => {
        logger.error('graceful shutdown failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        process.exitCode = 1
      })
      .finally(() => {
        process.exit(process.exitCode ?? 0)
      })
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)

  logger.info(`listening on :${port}`)
}

if (process.env.DOCUMENTS_COLLAB_START !== 'off' && isMainModule()) {
  void main().catch((error: unknown) => {
    logger.error('failed to start', {
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    })
    process.exitCode = 1
  })
}
