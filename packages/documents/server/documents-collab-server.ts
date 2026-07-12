import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import {
  Connection as HocuspocusConnection,
  IncomingMessage as HocuspocusIncomingMessage,
  MessageType,
} from '@hocuspocus/server'
import { Redis as HocuspocusRedis } from '@hocuspocus/extension-redis'
import type {
  afterLoadDocumentPayload,
  beforeHandleAwarenessPayload,
  beforeHandleMessagePayload,
  beforeSyncPayload,
  connectedPayload,
  onAuthenticatePayload,
  onDisconnectPayload,
  onLoadDocumentPayload,
  onRequestPayload,
  onStoreDocumentPayload,
  Server as HocuspocusServer,
} from '@hocuspocus/server'
import * as Y from 'yjs'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { OPTIMISTIC_LOCK_CONFLICT_CODE } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  COLLAB_TOKEN_CLOCK_SKEW_SECONDS,
  COLLAB_TOKEN_TTL_SECONDS,
  isCollabTokenV2Ready,
  verifyCollabToken,
  verifyCollabTokenV2,
  type CollabTokenClaims,
  type VerifiedCollabTokenV2Claims,
} from '@open-mercato/documents/modules/documents/lib/collabToken'
import {
  advanceDocumentCollaborationGeneration,
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
    prefix: 'open-mercato:documents:collab',
    options: {
      ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
      ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
      ...(db !== undefined ? { db } : {}),
      ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
      maxRetriesPerRequest: null,
    },
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
    console.warn(
      '[documents-collab] DOCUMENTS_COLLAB_REDIS_URL and REDIS_URL are unset; '
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
  /** Begin a bounded auth ticket for one currently authenticating document. */
  beginAuthorization: (documentName: string) => CollabAuthorizationTicket
  /** Advance tickets only when this document currently has in-flight auth. */
  bumpAuthorization: (documentName: string) => void
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
    const state = authorizationStates.get(ticket.documentName)
    if (state !== ticket.state) return
    state.active = Math.max(0, state.active - 1)
    if (state.active === 0) authorizationStates.delete(ticket.documentName)
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
    beginAuthorization(documentName) {
      let state = authorizationStates.get(documentName)
      if (!state) {
        state = { active: 0, epoch: 0 }
        authorizationStates.set(documentName, state)
      }
      state.active += 1
      const ticket: InternalCollabAuthorizationTicket = {
        documentName,
        epoch: state.epoch,
        released: false,
        state,
      }
      ticket.expiry = setTimeout(() => {
        releaseAuthorization(ticket)
      }, DOCUMENTS_COLLAB_AUTHORIZATION_TICKET_TIMEOUT_MS)
      ticket.expiry.unref?.()
      return ticket
    },
    bumpAuthorization(documentName) {
      const state = authorizationStates.get(documentName)
      if (state) state.epoch += 1
    },
    isAuthorizationCurrent(ticket) {
      const internalTicket = ticket as InternalCollabAuthorizationTicket
      const state = authorizationStates.get(ticket.documentName)
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
  verifyToken: (token: string) => CollabTokenClaims | null
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
  env: Pick<NodeJS.ProcessEnv, 'DOCUMENTS_COLLAB_ALLOWED_ORIGINS' | 'APP_URL' | 'NEXT_PUBLIC_APP_URL'>,
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

  const legacyClaims = deps.verifyToken(token)
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
    return isCollabAuthorizationCurrent(context, {
      relationshipTier,
      isSuperAdmin: acl.isSuperAdmin,
      features: acl.features,
      organizations: acl.organizations,
      organizationScope,
    })
  } catch {
    return false
  }
}

export function createCollabHooks(deps: CollabHooksDeps) {
  const materializationWarningRooms = new Set<string>()
  const loadedContentVersions = new WeakMap<Y.Doc, string>()
  const loadedCollaborationGenerations = new WeakMap<Y.Doc, number>()
  const roomResourceBudgets = new WeakMap<Y.Doc, { bytes: number; revision: number }>()
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
    console.error(invalidated
      ? '[documents-collab] invalidated store failed; retiring in-memory room'
      : '[documents-collab] final drain failed; retiring in-memory room')
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
      console.error('[documents-collab] store authorization failed; retiring in-memory room')
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
      rememberWritableContext(deps.resolveRoomDocument?.(context.documentId), context)
      return true
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
        ?.beginAuthorization(data.documentName)
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
      connection: { readOnly: boolean }
      context?: CollabContext
    }): Promise<void> {
      rememberWritableContext(data.document, data.context)
      // SyncStep1 contains only a state vector. Read-only SyncStep2/updates are
      // dropped by Hocuspocus and must not consume the writable room budget.
      if (data.connection.readOnly || (data.type !== 1 && data.type !== 2)) return
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
            console.warn(`[documents-collab] materialization failed for room ${data.documentName}; preserving previous html/text`)
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
          if (finalDrainAuthorized) deps.finalDrainRegistry?.complete(data.document)
          return
        }
      } catch (error) {
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
  if (event === 'documents.document.shared' || event === 'documents.document.unshared') {
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
  originPid?: unknown
}

/**
 * The Events bridge includes the publisher PID in every envelope. Keep the
 * self-echo check local so the Documents sidecar works with the existing
 * public bridge API and does not require a new Events-package helper.
 */
export function isOwnDocumentsCrossProcessEvent(
  envelope: DocumentsCrossProcessEventEnvelope,
): boolean {
  return envelope.originPid === process.pid
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
    { registerCrossProcessEventListener },
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
  const hooks = createCollabHooks({
    verifyToken: verifyCollabToken,
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
    finalDrainRegistry,
    resolveRoomDocument: (documentName) => server?.hocuspocus.documents.get(documentName),
    isRoomInvalidated: (documentName, document) => {
      const room = document ?? server?.hocuspocus.documents.get(documentName)
      return Boolean(room && invalidatedRoomDocuments.has(room))
    },
    invalidateRoom: (documentName, document) => {
      finalDrainRegistry.discard(document)
      invalidatedRoomDocuments.add(document)
      server?.hocuspocus.closeConnections(documentName)
    },
  })

  const runningServer: HocuspocusServer<CollabContext> = new Server<CollabContext>({
    port,
    ...COLLAB_SERVER_RUNTIME_CONFIGURATION,
    extensions: resolveDocumentsCollabRedisExtensions(
      process.env,
      (configuration) => new HocuspocusRedis(configuration),
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
    if (isOwnDocumentsCrossProcessEvent(envelope)) return
    const action = resolveCollabRoomEventAction(envelope.event, envelope.payload)
    if (action === 'ignore') return
    const documentId = eventDocumentId(envelope.payload)
    if (!documentId) return
    // Invalidate only tickets that are currently authenticating. This stays
    // bounded by active handshakes and also covers events for an unmapped room.
    finalDrainRegistry.bumpAuthorization(documentId)

    const roomDocument = runningServer.hocuspocus.documents.get(documentId)
    if (roomDocument && action === 'reauth') {
      // Capture every exact connection queue before closeConnections removes
      // those logical connections synchronously. The one-shot store cannot
      // snapshot or unblock reconnects until all captured queues have drained.
      markCollabFinalDrainForReauth(roomDocument, finalDrainRegistry)
    }
    if (roomDocument && action === 'invalidate') {
      finalDrainRegistry.discard(roomDocument)
      invalidatedRoomDocuments.add(roomDocument)
    }
    runningServer.hocuspocus.closeConnections(documentId)
  })

  console.log(`[documents-collab] listening on :${port}`)
}

if (process.env.DOCUMENTS_COLLAB_START !== 'off' && isMainModule()) {
  void main().catch((error: unknown) => {
    console.error('[documents-collab] failed to start', error)
    process.exitCode = 1
  })
}
