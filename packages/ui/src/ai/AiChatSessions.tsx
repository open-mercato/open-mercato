"use client"

/**
 * Multi-tab AI chat sessions.
 *
 * Each agent can have several concurrent conversation threads (sessions).
 * The provider stores their *metadata* — id, conversationId, optional
 * user-given name, timestamps, status — in localStorage, so closing and
 * re-opening the chat pane (or refreshing the page) restores the tabs and
 * their history. The actual messages live in `useAiChat`'s per-conversation
 * persistence slot keyed by `(agent, conversationId)`, which is why every
 * session gets its own UUID even when it shares an agent with the next tab.
 *
 * Sessions are partitioned into:
 *   - `open`   → currently shown in the tab strip
 *   - `closed` → hidden but kept for the history dropdown
 *
 * Closing a tab moves it to `closed`. Re-opening from history flips it back
 * to `open` and surfaces it as the active tab. Renaming is a single
 * `name` field; falling back to the formatted creation date when the user
 * never named the session keeps the picker scannable.
 */

import * as React from 'react'

const STORAGE_KEY = 'om-ai-chat-sessions-v1'
const HISTORY_LIMIT = 50

export type AiChatSessionStatus = 'open' | 'closed'

export interface AiChatSession {
  id: string
  agentId: string
  conversationId: string
  name?: string
  createdAt: number
  lastUsedAt: number
  status: AiChatSessionStatus
}

interface AiChatSessionsState {
  sessions: AiChatSession[]
  activeByAgent: Record<string, string>
}

interface AiChatSessionsApi {
  state: AiChatSessionsState
  /** Returns open sessions for `agentId`, ordered by creation. */
  getOpenSessions: (agentId: string) => AiChatSession[]
  /** Returns closed sessions (history) for `agentId`, newest first. */
  getClosedSessions: (agentId: string, limit?: number) => AiChatSession[]
  /** Returns the active session for `agentId`, or null if none. */
  getActiveSession: (agentId: string) => AiChatSession | null
  /** Creates and activates a fresh open session for `agentId`. */
  createSession: (agentId: string) => AiChatSession
  /** Closes a session (moves to history). If it was active, picks another. */
  closeSession: (sessionId: string) => void
  /** Re-opens a closed session and activates it. */
  reopenSession: (sessionId: string) => void
  /** Activates an open session. */
  setActiveSession: (sessionId: string) => void
  /** Renames a session — empty / whitespace clears the custom name. */
  renameSession: (sessionId: string, name: string) => void
  /** Bumps `lastUsedAt` on a session (call when activity happens). */
  touchSession: (sessionId: string) => void
  /** Ensures `agentId` has at least one open session and returns its id. */
  ensureSession: (agentId: string) => AiChatSession
}

const AiChatSessionsContext = React.createContext<AiChatSessionsApi | null>(null)

function makeId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } }
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    try {
      return g.crypto.randomUUID()
    } catch {
      /* fall through */
    }
  }
  const rand = () => Math.random().toString(16).slice(2, 10)
  return `${Date.now().toString(16)}-${rand()}-${rand()}`
}

function readPersisted(): AiChatSessionsState {
  if (typeof window === 'undefined') return { sessions: [], activeByAgent: {} }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { sessions: [], activeByAgent: {} }
    const parsed = JSON.parse(raw) as Partial<AiChatSessionsState> | null
    const sessions = Array.isArray(parsed?.sessions)
      ? (parsed!.sessions as unknown[])
          .filter((entry): entry is AiChatSession => {
            if (!entry || typeof entry !== 'object') return false
            const value = entry as Record<string, unknown>
            return (
              typeof value.id === 'string' &&
              typeof value.agentId === 'string' &&
              typeof value.conversationId === 'string' &&
              typeof value.createdAt === 'number' &&
              typeof value.lastUsedAt === 'number' &&
              (value.status === 'open' || value.status === 'closed')
            )
          })
          .map((entry) => {
            const value = entry as unknown as Record<string, unknown>
            const candidate = value.name
            return {
              ...entry,
              name: typeof candidate === 'string' ? candidate : undefined,
            }
          })
      : []
    const activeByAgent =
      parsed?.activeByAgent && typeof parsed.activeByAgent === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.activeByAgent as Record<string, unknown>).filter(
              (entry): entry is [string, string] =>
                typeof entry[0] === 'string' && typeof entry[1] === 'string',
            ),
          )
        : {}
    return { sessions, activeByAgent }
  } catch {
    return { sessions: [], activeByAgent: {} }
  }
}

function writePersisted(state: AiChatSessionsState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* quota / privacy mode — drop silently */
  }
}

export function AiChatSessionsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AiChatSessionsState>({
    sessions: [],
    activeByAgent: {},
  })
  const hydratedRef = React.useRef(false)

  React.useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    setState(readPersisted())
  }, [])

  React.useEffect(() => {
    if (!hydratedRef.current) return
    writePersisted(state)
  }, [state])

  const update = React.useCallback(
    (mutator: (prev: AiChatSessionsState) => AiChatSessionsState) => {
      setState((prev) => mutator(prev))
    },
    [],
  )

  const getOpenSessions = React.useCallback(
    (agentId: string) =>
      state.sessions
        .filter((s) => s.agentId === agentId && s.status === 'open')
        .sort((a, b) => a.createdAt - b.createdAt),
    [state.sessions],
  )

  const getClosedSessions = React.useCallback(
    (agentId: string, limit = HISTORY_LIMIT) =>
      state.sessions
        .filter((s) => s.agentId === agentId && s.status === 'closed')
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
        .slice(0, limit),
    [state.sessions],
  )

  const getActiveSession = React.useCallback(
    (agentId: string) => {
      const id = state.activeByAgent[agentId]
      if (!id) return null
      const session = state.sessions.find((s) => s.id === id)
      if (!session || session.status !== 'open') return null
      return session
    },
    [state.activeByAgent, state.sessions],
  )

  const createSession = React.useCallback((agentId: string): AiChatSession => {
    const session: AiChatSession = {
      id: makeId(),
      agentId,
      conversationId: makeId(),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      status: 'open',
    }
    update((prev) => ({
      sessions: [...prev.sessions, session],
      activeByAgent: { ...prev.activeByAgent, [agentId]: session.id },
    }))
    return session
  }, [update])

  const closeSession = React.useCallback(
    (sessionId: string) => {
      update((prev) => {
        const target = prev.sessions.find((s) => s.id === sessionId)
        if (!target) return prev
        const sessions = prev.sessions.map((s) =>
          s.id === sessionId ? { ...s, status: 'closed' as const, lastUsedAt: Date.now() } : s,
        )
        const activeByAgent = { ...prev.activeByAgent }
        if (activeByAgent[target.agentId] === sessionId) {
          // Pick the next open session for this agent (most-recent first).
          const fallback = sessions
            .filter((s) => s.agentId === target.agentId && s.status === 'open')
            .sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0]
          if (fallback) {
            activeByAgent[target.agentId] = fallback.id
          } else {
            delete activeByAgent[target.agentId]
          }
        }
        return { sessions, activeByAgent }
      })
    },
    [update],
  )

  const reopenSession = React.useCallback(
    (sessionId: string) => {
      update((prev) => {
        const target = prev.sessions.find((s) => s.id === sessionId)
        if (!target) return prev
        const sessions = prev.sessions.map((s) =>
          s.id === sessionId ? { ...s, status: 'open' as const, lastUsedAt: Date.now() } : s,
        )
        return {
          sessions,
          activeByAgent: { ...prev.activeByAgent, [target.agentId]: sessionId },
        }
      })
    },
    [update],
  )

  const setActiveSession = React.useCallback(
    (sessionId: string) => {
      update((prev) => {
        const target = prev.sessions.find((s) => s.id === sessionId)
        if (!target || target.status !== 'open') return prev
        const sessions = prev.sessions.map((s) =>
          s.id === sessionId ? { ...s, lastUsedAt: Date.now() } : s,
        )
        return {
          sessions,
          activeByAgent: { ...prev.activeByAgent, [target.agentId]: sessionId },
        }
      })
    },
    [update],
  )

  const renameSession = React.useCallback(
    (sessionId: string, name: string) => {
      const trimmed = name.trim()
      update((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) =>
          s.id === sessionId
            ? { ...s, name: trimmed.length > 0 ? trimmed : undefined }
            : s,
        ),
      }))
    },
    [update],
  )

  const touchSession = React.useCallback(
    (sessionId: string) => {
      update((prev) => ({
        ...prev,
        sessions: prev.sessions.map((s) =>
          s.id === sessionId ? { ...s, lastUsedAt: Date.now() } : s,
        ),
      }))
    },
    [update],
  )

  const ensureSession = React.useCallback(
    (agentId: string): AiChatSession => {
      // Everything happens inside a single functional setState so we always
      // see the latest pending state (not a stale closure). React Strict
      // Mode double-invokes both effects AND setState updaters in dev,
      // which previously caused the auto-bootstrap path to mint two
      // sessions on first chat-pane open. The `mintedSession` closure
      // cache makes the updater itself idempotent across double-invokes
      // (one fresh id per `ensureSession` call, regardless of how many
      // times React replays the updater for purity testing); the
      // functional `prev` lookup handles the case where two queued
      // ensureSession calls resolve back-to-back — the second one sees
      // the first's pending append and short-circuits.
      let resolved: AiChatSession | null = null
      let mintedSession: AiChatSession | null = null
      setState((prev) => {
        const activeId = prev.activeByAgent[agentId]
        if (activeId) {
          const active = prev.sessions.find((s) => s.id === activeId)
          if (active && active.status === 'open') {
            resolved = active
            return prev
          }
        }
        const anyOpen = prev.sessions
          .filter((s) => s.agentId === agentId && s.status === 'open')
          .sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0]
        if (anyOpen) {
          resolved = anyOpen
          return {
            ...prev,
            activeByAgent: { ...prev.activeByAgent, [agentId]: anyOpen.id },
          }
        }
        if (!mintedSession) {
          mintedSession = {
            id: makeId(),
            agentId,
            conversationId: makeId(),
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            status: 'open',
          }
        }
        resolved = mintedSession
        return {
          sessions: [...prev.sessions, mintedSession],
          activeByAgent: { ...prev.activeByAgent, [agentId]: mintedSession.id },
        }
      })
      // `setState` returns synchronously after invoking the updater (twice
      // in Strict Mode dev), so `resolved` is guaranteed to be set here.
      return resolved as AiChatSession
    },
    [],
  )

  const api = React.useMemo<AiChatSessionsApi>(
    () => ({
      state,
      getOpenSessions,
      getClosedSessions,
      getActiveSession,
      createSession,
      closeSession,
      reopenSession,
      setActiveSession,
      renameSession,
      touchSession,
      ensureSession,
    }),
    [
      state,
      getOpenSessions,
      getClosedSessions,
      getActiveSession,
      createSession,
      closeSession,
      reopenSession,
      setActiveSession,
      renameSession,
      touchSession,
      ensureSession,
    ],
  )

  return <AiChatSessionsContext.Provider value={api}>{children}</AiChatSessionsContext.Provider>
}

export function useAiChatSessions(): AiChatSessionsApi {
  const ctx = React.useContext(AiChatSessionsContext)
  if (ctx) return ctx
  // Fallback no-op API — keeps consumers safe when the provider is absent
  // (legacy code paths, isolated unit tests). Every method is a no-op so a
  // chat surface without the provider behaves like a single anonymous
  // session (the behavior shipped before the multi-tab work).
  return {
    state: { sessions: [], activeByAgent: {} },
    getOpenSessions: () => [],
    getClosedSessions: () => [],
    getActiveSession: () => null,
    createSession: (agentId) => ({
      id: 'noop',
      agentId,
      conversationId: 'noop',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      status: 'open',
    }),
    closeSession: () => {},
    reopenSession: () => {},
    setActiveSession: () => {},
    renameSession: () => {},
    touchSession: () => {},
    ensureSession: (agentId) => ({
      id: 'noop',
      agentId,
      conversationId: 'noop',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      status: 'open',
    }),
  }
}

export function defaultSessionLabel(session: AiChatSession): string {
  if (session.name && session.name.trim().length > 0) return session.name.trim()
  const date = new Date(session.createdAt)
  if (Number.isNaN(date.getTime())) return 'Session'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
