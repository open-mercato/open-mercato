"use client"

import * as React from 'react'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  sanitizeDocumentsDisplayLabel,
} from '../../../lib/displayLabels'
import {
  firstSafeCollaborationAwarenessName,
  normalizeCollaborationColor,
  resolveCollaborationUserColor,
} from '../../../lib/collaborationAwareness'
import {
  readNumber,
  readRecord,
  readString,
  type CollabResources,
  type CollabState,
  type CollabTokenUser,
  type ConnectionStatus,
  type PresenceUser,
} from './editorTypes'

export const COLLABORATION_INITIAL_TIMEOUT_MS = 6000
export const COLLABORATION_RECONNECT_GRACE_MS = 750
export const COLLABORATION_OFFLINE_AFTER_MS = 6000
export const COLLABORATION_PROVIDER_RETRY = {
  delay: 250,
  initialDelay: 0,
  factor: 1.5,
  minDelay: 200,
  maxDelay: 2000,
  maxAttempts: 0,
  jitter: true,
} as const

type CollabTokenResponse = {
  token: string
  url: string | null
  documentId: string
  tier: string
  expiresInSec: number
  user: CollabTokenUser
  canEdit: boolean
  readOnly: boolean
}

type CollabTokenAttempt =
  | { kind: 'ok'; token: CollabTokenResponse }
  | { kind: 'fatal' }
  | { kind: 'transient' }

type TimeoutHandle = ReturnType<typeof setTimeout>
type CollabApiCall = (
  path: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; result: unknown }>

export function classifyCollabTokenResponse(
  call: { ok: boolean; status: number; result: unknown },
  fallbackUserLabel: string | null,
): CollabTokenAttempt {
  if (call.ok) {
    const token = normalizeCollabTokenPayload(call.result, fallbackUserLabel)
    return token ? { kind: 'ok', token } : { kind: 'fatal' }
  }

  const retryableClientStatus = call.status === 408 || call.status === 425 || call.status === 429
  if (call.status >= 400 && call.status < 500 && !retryableClientStatus) {
    return { kind: 'fatal' }
  }
  return { kind: 'transient' }
}

export async function fetchCollabTokenAttempt(
  documentId: string,
  fallbackUserLabel: string | null,
  call: CollabApiCall = (path, init) => apiCall<unknown>(path, init),
): Promise<CollabTokenAttempt> {
  try {
    const response = await call(
      `/api/documents/${encodeURIComponent(documentId)}/collab-token`,
      {
        headers: {
          'x-om-forbidden-redirect': '0',
          'x-om-unauthorized-redirect': '0',
        },
      },
    )
    return classifyCollabTokenResponse(response, fallbackUserLabel)
  } catch {
    return { kind: 'transient' }
  }
}

export function createCollaborationStatusController(options: {
  onStatus: (status: ConnectionStatus) => void
}) {
  let disposed = false
  let hasSynced = false
  let outageActive = false
  let reconnectingTimer: TimeoutHandle | null = null
  let offlineTimer: TimeoutHandle | null = null

  const clearOutageTimers = () => {
    if (reconnectingTimer !== null) clearTimeout(reconnectingTimer)
    if (offlineTimer !== null) clearTimeout(offlineTimer)
    reconnectingTimer = null
    offlineTimer = null
  }

  return {
    connected() {
      if (disposed) return
      hasSynced = true
      outageActive = false
      clearOutageTimers()
      options.onStatus('connected')
    },
    disconnected() {
      if (disposed || !hasSynced || outageActive) return
      outageActive = true
      reconnectingTimer = setTimeout(() => {
        reconnectingTimer = null
        if (!disposed) options.onStatus('reconnecting')
      }, COLLABORATION_RECONNECT_GRACE_MS)
      offlineTimer = setTimeout(() => {
        offlineTimer = null
        if (!disposed) options.onStatus('offline')
      }, COLLABORATION_OFFLINE_AFTER_MS)
    },
    dispose() {
      disposed = true
      clearOutageTimers()
    },
  }
}

export function applyCollaborationProviderStatus(
  controller: Pick<ReturnType<typeof createCollaborationStatusController>, 'disconnected'>,
  payload: unknown,
): void {
  const record = readRecord(payload)
  // A physical WebSocket can report `connected` before Hocuspocus has
  // authenticated and synchronized the document. Only the provider's `synced`
  // event may restore the user-facing Live state; otherwise an auth failure can
  // leave the UI claiming Live while the server is rejecting the room.
  if (readString(record ?? {}, 'status') !== 'connected') controller.disconnected()
}

export function restartConnectedCollaborationSocket(websocket: {
  status: string
  webSocket?: { close: () => void } | null
}): boolean {
  if (websocket.status !== 'connected' || !websocket.webSocket) return false
  websocket.webSocket.close()
  return true
}

type CollaborationWebsocketLifecycle = {
  status: string
  webSocket?: { close: () => void } | null
  connect?: () => unknown
}

export function createCollaborationSocketLifecycle(
  websocket: CollaborationWebsocketLifecycle,
) {
  let disposed = false
  let reconnectInFlight = false

  const ensureConnected = (): boolean => {
    if (
      disposed
      || reconnectInFlight
      || websocket.status !== 'disconnected'
      || typeof websocket.connect !== 'function'
    ) return false

    reconnectInFlight = true
    void Promise.resolve(websocket.connect()).catch(() => undefined).finally(() => {
      reconnectInFlight = false
    })
    return true
  }

  return {
    connected() {
      reconnectInFlight = false
    },
    disconnected() {
      reconnectInFlight = false
      return ensureConnected()
    },
    logicalClose() {
      return restartConnectedCollaborationSocket(websocket) || ensureConnected()
    },
    ensureConnected,
    dispose() {
      disposed = true
      reconnectInFlight = false
    },
  }
}

export function normalizeCollabTokenPayload(
  payload: unknown,
  fallbackUserLabel: string | null,
): CollabTokenResponse | null {
  const root = readRecord(payload)
  const user = readRecord(root?.user)
  if (!root || !user) return null
  const token = readString(root, 'token')
  const collaborationDisabled = root.url === null
  const documentId = readString(root, 'documentId', 'document_id')
  const tier = readString(root, 'tier')
  const expiresInSec = readNumber(root, 'expiresInSec', 'expires_in_sec')
  const id = readString(user, 'id')
  const name = firstSafeCollaborationAwarenessName(
    readString(user, 'name'),
    readString(root, 'userName', 'user_name'),
    fallbackUserLabel,
  )
  const color = readString(user, 'color') ?? readString(root, 'userColor', 'user_color')
  if ((!token && !collaborationDisabled) || !documentId || !tier || !expiresInSec || !id || !name || !color) return null
  return {
    token: token ?? '',
    documentId,
    tier,
    expiresInSec,
    user: { id, name, color: resolveCollaborationUserColor(id) },
    url: collaborationDisabled ? null : readString(root, 'url'),
    canEdit: root.canEdit === true,
    readOnly: root.readOnly !== false,
  }
}

export function readCollaborationPresence(
  provider: HocuspocusProvider,
  fallbackUserLabel: string | null,
): PresenceUser[] {
  const states = provider.awareness?.getStates() as Map<number, unknown> | undefined
  if (!states) return []
  const seen = new Set<string>()
  const users: PresenceUser[] = []
  states.forEach((value, clientId) => {
    if (clientId === provider.document.clientID) return
    const state = readRecord(value)
    const user = readRecord(state?.user)
    const name = firstSafeCollaborationAwarenessName(
      user ? readString(user, 'name') : null,
      fallbackUserLabel,
    )
    const id = user ? readString(user, 'id') : null
    const suppliedColor = user ? readString(user, 'color') : null
    if (!name || !suppliedColor) return
    const color = id
      ? resolveCollaborationUserColor(id)
      : normalizeCollaborationColor(suppliedColor)
    const key = id ? `user:${id}` : `${name}:${color}`
    if (!seen.has(key)) { seen.add(key); users.push({ key, name, color }) }
  })
  return users
}

function destroy(resources: CollabResources) {
  try { resources.provider.destroy() } finally { resources.ydoc.destroy() }
}

export function useDocumentCollaboration(documentId: string): CollabState {
  const t = useT()
  const fallbackUserLabel = sanitizeDocumentsDisplayLabel(t('documents.users.unknown'))
  const resourcesRef = React.useRef<CollabResources | null>(null)
  const [state, setState] = React.useState<CollabState>({ mode: 'connecting' })
  React.useEffect(() => {
    let active = true
    let terminal = false
    let local: CollabResources | null = null
    let initialTimer: TimeoutHandle | null = null
    let initialRetryTimer: TimeoutHandle | null = null
    let tokenRetryTimer: TimeoutHandle | null = null
    let statusController: ReturnType<typeof createCollaborationStatusController> | null = null
    let socketLifecycle: ReturnType<typeof createCollaborationSocketLifecycle> | null = null
    let removeResumeListeners: (() => void) | null = null
    let lastTokenFailure: 'fatal' | 'transient' | null = null
    const clearInitialTimers = () => {
      if (initialTimer !== null) clearTimeout(initialTimer)
      if (initialRetryTimer !== null) clearTimeout(initialRetryTimer)
      initialTimer = null
      initialRetryTimer = null
    }
    const clearTokenRetryTimer = () => {
      if (tokenRetryTimer !== null) clearTimeout(tokenRetryTimer)
      tokenRetryTimer = null
    }
    const fallback = (readOnly = false) => {
      if (!active || terminal) return
      terminal = true
      clearInitialTimers()
      clearTokenRetryTimer()
      statusController?.dispose()
      socketLifecycle?.dispose()
      removeResumeListeners?.()
      removeResumeListeners = null
      if (local && resourcesRef.current === local) { resourcesRef.current = null; destroy(local) }
      local = null
      setState({ mode: 'fallback', readOnly })
    }
    const fetchToken = async (): Promise<CollabTokenAttempt> => {
      return fetchCollabTokenAttempt(documentId, fallbackUserLabel)
    }
    const freshToken = async () => {
      const next = await fetchToken()
      if (next.kind === 'ok') {
        lastTokenFailure = null
        if (active && !terminal && local && resourcesRef.current === local) {
          const serverReadOnly = next.token.readOnly || !next.token.canEdit
          setState((current) => current.mode === 'collab' && current.resources === local
            ? { ...current, serverReadOnly }
            : current)
        }
        return next.token.token
      }
      lastTokenFailure = next.kind
      throw new Error(`[internal] Collaboration token refresh ${next.kind}`)
    }
    const start = async (): Promise<void> => {
      const initial = await fetchToken()
      if (!active || terminal) return
      if (initial.kind === 'transient') {
        initialRetryTimer = setTimeout(() => {
          initialRetryTimer = null
          void start()
        }, COLLABORATION_PROVIDER_RETRY.delay)
        return
      }
      if (initial.kind === 'fatal') { fallback(true); return }
      if (!initial.token.url) {
        fallback(initial.token.readOnly || !initial.token.canEdit)
        return
      }
      const ydoc = new Y.Doc()
      const provider = new HocuspocusProvider({
        url: initial.token.url,
        name: documentId,
        document: ydoc,
        token: freshToken,
        ...COLLABORATION_PROVIDER_RETRY,
      })
      const resources = { ydoc, provider, user: initial.token.user }
      local = resources
      resourcesRef.current = resources
      const update = (connectionStatus: ConnectionStatus) => {
        if (!active || resourcesRef.current !== resources) return
        setState((current) => current.mode === 'collab' && current.resources === resources ? { ...current, connectionStatus } : current)
      }
      statusController = createCollaborationStatusController({
        onStatus: update,
      })
      const websocket = provider.configuration.websocketProvider
      socketLifecycle = createCollaborationSocketLifecycle(websocket)
      const resume = () => socketLifecycle?.ensureConnected()
      const resumeWhenVisible = () => {
        if (document.visibilityState === 'visible') resume()
      }
      window.addEventListener('online', resume)
      window.addEventListener('pageshow', resume)
      document.addEventListener('visibilitychange', resumeWhenVisible)
      removeResumeListeners = () => {
        window.removeEventListener('online', resume)
        window.removeEventListener('pageshow', resume)
        document.removeEventListener('visibilitychange', resumeWhenVisible)
      }
      const updatePresence = () => setState((current) => current.mode === 'collab' && current.resources === resources ? { ...current, presenceUsers: readCollaborationPresence(provider, fallbackUserLabel) } : current)
      provider.on('status', (payload: unknown) => {
        const record = readRecord(payload)
        if (readString(record ?? {}, 'status') === 'connected') socketLifecycle?.connected()
        if (statusController) applyCollaborationProviderStatus(statusController, payload)
      })
      provider.on('synced', () => {
        lastTokenFailure = null
        clearInitialTimers()
        clearTokenRetryTimer()
        statusController?.connected()
      })
      provider.on('authenticationFailed', () => {
        const tokenFailure = lastTokenFailure
        lastTokenFailure = null
        // A freshly minted token can still hit the sidecar's short-lived room
        // drain fence after a share/unshare rollover. Only a definitive token
        // endpoint rejection is fatal; sidecar auth rejection with a valid
        // token must keep retrying until the old room has drained.
        if (tokenFailure === 'fatal') { fallback(true); return }
        statusController?.disconnected()
        clearTokenRetryTimer()
        tokenRetryTimer = setTimeout(() => {
          tokenRetryTimer = null
          if (!active || terminal || resourcesRef.current !== resources) return
          const websocket = provider.configuration.websocketProvider
          websocket.webSocket?.close()
        }, COLLABORATION_PROVIDER_RETRY.delay)
      })
      provider.on('disconnect', () => {
        statusController?.disconnected()
        socketLifecycle?.disconnected()
      })
      provider.on('close', () => {
        statusController?.disconnected()
        socketLifecycle?.logicalClose()
      })
      provider.awareness?.on('change', updatePresence)
      setState({
        mode: 'collab',
        resources,
        connectionStatus: 'connecting',
        presenceUsers: readCollaborationPresence(provider, fallbackUserLabel),
        serverReadOnly: initial.token.readOnly || !initial.token.canEdit,
      })
    }
    setState({ mode: 'connecting' })
    initialTimer = setTimeout(fallback, COLLABORATION_INITIAL_TIMEOUT_MS)
    void start().catch(() => fallback(false))
    return () => {
      active = false
      terminal = true
      clearInitialTimers()
      clearTokenRetryTimer()
      statusController?.dispose()
      socketLifecycle?.dispose()
      removeResumeListeners?.()
      if (local) destroy(local)
      if (resourcesRef.current === local) resourcesRef.current = null
    }
  }, [documentId, fallbackUserLabel])
  return state
}
