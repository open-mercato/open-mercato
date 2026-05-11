"use client"

import * as React from 'react'
import { createAiAgentTransport } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/agent-transport'
import { apiFetch } from '../backend/utils/api'

/**
 * Chat message shape used by {@link AiChat}. Kept intentionally minimal so the
 * component stays independent of the AI SDK's evolving `UIMessage` type. The
 * dispatcher route (`POST /api/ai_assistant/ai/chat`) accepts exactly this
 * shape for `messages`.
 */
export interface AiChatMessageFile {
  name: string
  type: string
  previewUrl?: string
}

export interface AiChatToolCallSnapshot {
  id: string
  toolName: string
  state: 'pending' | 'complete' | 'error'
  input?: unknown
  output?: unknown
  errorMessage?: string
}

export interface AiChatMessageUiPart {
  componentId: string
  payload?: unknown
  pendingActionId?: string
  /** Stable id used as React key when rendering. */
  key: string
}

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  files?: AiChatMessageFile[]
  reasoning?: string
  reasoningStreaming?: boolean
  toolCalls?: AiChatToolCallSnapshot[]
  /**
   * UI parts emitted by the agent during this message's lifecycle. Today
   * the only producer is `prepareMutation` (mutation approval flow):
   * the dispatcher's mutation tool returns an `awaiting-confirmation`
   * envelope, useAiChat parses it and attaches a `mutation-preview-card`
   * part here so AiChat can render the approval card inline. Phase 3
   * WS-C wiring — without this, the `MutationPreviewCard` registered in
   * the UI-part registry never surfaces.
   */
  uiParts?: AiChatMessageUiPart[]
}

export interface UseAiChatInput {
  agent: string
  apiPath?: string
  pageContext?: Record<string, unknown>
  attachmentIds?: string[]
  debug?: boolean
  initialMessages?: Array<Pick<AiChatMessage, 'role' | 'content'>>
  onError?: (err: { code?: string; message: string }) => void
  /**
   * Optional stable conversation id. When provided, the same id is forwarded
   * to the dispatcher on every turn so `prepareMutation`'s idempotency hash
   * (Step 5.6) stays stable across mutation preview / confirm / retry cycles.
   * When omitted, the hook mints a fresh random id once on mount and reuses
   * it for the lifetime of the component — callers can still override via
   * props at any time to reset the conversation.
   */
  conversationId?: string
}

export interface AiChatErrorEnvelope {
  code?: string
  message: string
}

export interface UseAiChatResult {
  messages: AiChatMessage[]
  status: 'idle' | 'submitting' | 'streaming'
  error: AiChatErrorEnvelope | null
  lastRequestDebug: { url: string; body: unknown } | null
  lastResponseDebug: { status: number; text: string } | null
  /**
   * The conversation id currently in use for this chat instance. Equal to
   * the caller-provided `conversationId` input when one is supplied;
   * otherwise the random id minted on mount. Stable across re-renders for a
   * given mount (Phase 3 WS-D contract with `prepareMutation`).
   */
  conversationId: string
  sendMessage: (input: string, files?: AiChatMessageFile[]) => Promise<void>
  cancel: () => void
  reset: () => void
}

function makeMessageId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  const time = Date.now().toString(36)
  return `msg_${time}_${random}`
}

function makeConversationId(): string {
  // Use crypto.randomUUID() when the browser exposes it (all evergreen
  // runtimes do), otherwise fall back to a low-entropy token that is still
  // unique enough for the idempotency-hash use case.
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } }
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    try {
      return g.crypto.randomUUID()
    } catch {
      // fall through to the random fallback
    }
  }
  const rand = () => Math.random().toString(16).slice(2, 10)
  return `conv_${Date.now().toString(16)}_${rand()}${rand()}`
}

const SESSION_STORAGE_PREFIX = 'om-ai-chat:'
const SESSION_STORAGE_VERSION = 1
const SESSION_UPDATED_EVENT = 'om-ai-chat-session-updated'
const SESSION_STREAM_STATE_EVENT = 'om-ai-chat-session-stream-state'
const activeSessionStreams = new Set<string>()

interface PersistedAiChatSession {
  v: number
  conversationId: string
  messages: AiChatMessage[]
}

function getSessionStorageKey(agent: string, conversationId?: string | null): string {
  // When the caller pins a `conversationId` (e.g. via the AiChatSessions
  // provider's tabs), namespace the persisted slot per session so multiple
  // open conversations for the same agent don't overwrite each other. The
  // legacy single-session-per-agent layout (no externally-supplied id) is
  // kept for backward compatibility with code that still relies on it.
  if (typeof conversationId === 'string' && conversationId.length > 0) {
    return `${SESSION_STORAGE_PREFIX}${agent}:${conversationId}`
  }
  return `${SESSION_STORAGE_PREFIX}${agent}`
}

function writeSessionStreamState(storageKey: string, active: boolean): void {
  if (active) {
    activeSessionStreams.add(storageKey)
  } else {
    activeSessionStreams.delete(storageKey)
  }
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(
      new CustomEvent(SESSION_STREAM_STATE_EVENT, {
        detail: { key: storageKey, active },
      }),
    )
  } catch {
    // ignore event dispatch failures in non-browser test environments
  }
}

function isSessionStreamActive(storageKey: string): boolean {
  return activeSessionStreams.has(storageKey)
}

function readPersistedSession(
  agent: string,
  conversationId?: string | null,
): PersistedAiChatSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(getSessionStorageKey(agent, conversationId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedAiChatSession | null
    if (!parsed || parsed.v !== SESSION_STORAGE_VERSION) return null
    if (typeof parsed.conversationId !== 'string') return null
    if (!Array.isArray(parsed.messages)) return null
    const messages = parsed.messages.filter((entry): entry is AiChatMessage => {
      return (
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as AiChatMessage).id === 'string' &&
        typeof (entry as AiChatMessage).content === 'string' &&
        ((entry as AiChatMessage).role === 'user' || (entry as AiChatMessage).role === 'assistant')
      )
    })
    return { v: SESSION_STORAGE_VERSION, conversationId: parsed.conversationId, messages }
  } catch {
    return null
  }
}

function writePersistedSession(
  agent: string,
  session: PersistedAiChatSession,
  conversationId?: string | null,
  options?: { notify?: boolean },
): void {
  if (typeof window === 'undefined') return
  try {
    // Strip transient blob/object preview URLs before persisting (they would
    // not survive a reload). Self-contained `data:` URLs are kept so image
    // previews come back unchanged after the chat is reopened — public
    // attachment URLs are intentionally not used because the LLM provider
    // cannot reach a localhost origin and we want a single durable shape
    // that works for both transport and reload.
    const messages = session.messages.map((message) => {
      if (!message.files || message.files.length === 0) return message
      const safeFiles = message.files.map(({ name, type, previewUrl }) => {
        const durable =
          typeof previewUrl === 'string' && previewUrl.startsWith('data:')
            ? previewUrl
            : undefined
        return durable ? { name, type, previewUrl: durable } : { name, type }
      })
      return { ...message, files: safeFiles }
    })
    const storageKey = getSessionStorageKey(agent, conversationId)
    window.localStorage.setItem(storageKey, JSON.stringify({ ...session, messages }))
    if (options?.notify) {
      window.dispatchEvent(
        new CustomEvent(SESSION_UPDATED_EVENT, {
          detail: { key: storageKey, agent, conversationId: session.conversationId },
        }),
      )
    }
  } catch {
    // Quota exceeded / privacy mode — silently drop persistence.
  }
}

function clearPersistedSession(agent: string, conversationId?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(getSessionStorageKey(agent, conversationId))
  } catch {
    // ignore
  }
}

function getTransportEndpoint(agent: string, apiPath?: string): string {
  // Reuse the transport factory so UI consumers share the dispatcher URL
  // convention with server-side callers (e.g. runAiAgentText / Playwright
  // fixtures). The factory returns a ChatTransport<UI_MESSAGE> whose internal
  // endpoint we do not directly read — instead we reconstruct the same URL
  // shape here so downstream error handling stays deterministic.
  //
  // When the AI SDK exposes a public endpoint getter (or the stream format
  // switches from plain text to UIMessageChunk) we can call
  // transport.sendMessages(...) directly.
  const transport = createAiAgentTransport({ agentId: agent, endpoint: apiPath })
  void transport
  const base = apiPath && apiPath.length > 0 ? apiPath : '/api/ai_assistant/ai/chat'
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}agent=${encodeURIComponent(agent)}`
}

interface AssistantBuilderState {
  text: string
  reasoning: string
  reasoningStreaming: boolean
  toolCalls: AiChatToolCallSnapshot[]
  uiParts: AiChatMessageUiPart[]
}

function createBuilder(): AssistantBuilderState {
  return { text: '', reasoning: '', reasoningStreaming: false, toolCalls: [], uiParts: [] }
}

/**
 * Generic extractor for UI parts emitted by tool outputs. A tool can
 * surface inline UI to the chat by returning JSON in any of these
 * shapes — each tool call produces zero or more UI parts:
 *
 *   1. The dispatcher's mutation envelope:
 *        `{ status: 'awaiting-confirmation', pendingActionId, expiresAt,
 *           agent, toolName, message }`
 *      → synthesizes a `mutation-preview-card` part (the registered
 *        card fetches the live diff via `useAiPendingActionPolling`).
 *
 *   2. A single explicit UI part:
 *        `{ uiPart: { componentId, payload?, pendingActionId? } }`
 *
 *   3. Multiple explicit UI parts:
 *        `{ uiParts: [{ componentId, payload? }, ...] }`
 *
 * Tool authors only need to JSON-encode an object whose `uiPart` /
 * `uiParts` reference component ids that the host has registered on
 * `defaultAiUiPartRegistry` (or a scoped registry passed through
 * `<AiChat registry={...}/>`). Unknown component ids fall back to the
 * `UnknownUiPartPlaceholder` so an unregistered id never blows up the
 * transcript.
 */
function extractUiPartsFromOutput(
  output: unknown,
  toolCallId: string,
): AiChatMessageUiPart[] {
  let parsed: unknown = output
  if (typeof output === 'string') {
    const trimmed = output.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return []
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return []
    }
  }
  if (!parsed || typeof parsed !== 'object') return []
  const value = parsed as Record<string, unknown>
  const parts: AiChatMessageUiPart[] = []

  // (1) Mutation approval envelope. The dispatcher's `prepareMutation`
  // interceptor in `agent-tools.ts` formats the result via
  // `formatPendingActionToolResult` as
  //   { status: 'pending-confirmation', agentId, toolName, pendingActionId,
  //     expiresAt, message }
  // (NOTE: status is `pending-confirmation` and the field is `agentId`,
  // not `agent`). We also accept `awaiting-confirmation` / `agent` for
  // forward compat with older / alternative dispatchers.
  if (value.status === 'pending-confirmation' || value.status === 'awaiting-confirmation') {
    const pendingActionId =
      typeof value.pendingActionId === 'string' && value.pendingActionId.length > 0
        ? value.pendingActionId
        : null
    if (pendingActionId) {
      const agentId =
        typeof value.agentId === 'string'
          ? value.agentId
          : typeof value.agent === 'string'
            ? value.agent
            : undefined
      parts.push({
        componentId: 'mutation-preview-card',
        pendingActionId,
        payload: {
          pendingActionId,
          expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : undefined,
          agentId,
          toolName: typeof value.toolName === 'string' ? value.toolName : undefined,
        },
        key: `${toolCallId}:mutation-preview-card`,
      })
    }
  }

  // (2) Explicit single UI part.
  if (value.uiPart && typeof value.uiPart === 'object') {
    const part = value.uiPart as Record<string, unknown>
    if (typeof part.componentId === 'string' && part.componentId.length > 0) {
      parts.push({
        componentId: part.componentId,
        payload: part.payload,
        pendingActionId:
          typeof part.pendingActionId === 'string' ? part.pendingActionId : undefined,
        key: `${toolCallId}:${part.componentId}`,
      })
    }
  }

  // (3) Explicit list of UI parts.
  if (Array.isArray(value.uiParts)) {
    value.uiParts.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return
      const part = entry as Record<string, unknown>
      if (typeof part.componentId !== 'string' || part.componentId.length === 0) return
      parts.push({
        componentId: part.componentId,
        payload: part.payload,
        pendingActionId:
          typeof part.pendingActionId === 'string' ? part.pendingActionId : undefined,
        key: `${toolCallId}:${index}:${part.componentId}`,
      })
    })
  }

  return parts
}

function updateToolCall(
  state: AssistantBuilderState,
  id: string,
  patch: Partial<AiChatToolCallSnapshot> & { toolName?: string },
): AssistantBuilderState {
  if (!id) return state
  const idx = state.toolCalls.findIndex((entry) => entry.id === id)
  if (idx === -1) {
    const next: AiChatToolCallSnapshot = {
      id,
      toolName: patch.toolName ?? 'tool',
      state: patch.state ?? 'pending',
      input: patch.input,
      output: patch.output,
      errorMessage: patch.errorMessage,
    }
    return { ...state, toolCalls: [...state.toolCalls, next] }
  }
  const current = state.toolCalls[idx]
  const merged: AiChatToolCallSnapshot = {
    ...current,
    toolName: patch.toolName ?? current.toolName,
    state: patch.state ?? current.state,
    input: patch.input !== undefined ? patch.input : current.input,
    output: patch.output !== undefined ? patch.output : current.output,
    errorMessage: patch.errorMessage ?? current.errorMessage,
  }
  const nextCalls = state.toolCalls.slice()
  nextCalls[idx] = merged
  return { ...state, toolCalls: nextCalls }
}

function applyChunk(
  state: AssistantBuilderState,
  chunk: { type: string; [key: string]: unknown },
): AssistantBuilderState {
  switch (chunk.type) {
    case 'text-delta':
      return {
        ...state,
        text: state.text + (typeof chunk.delta === 'string' ? chunk.delta : ''),
      }
    case 'reasoning-start':
      return { ...state, reasoningStreaming: true }
    case 'reasoning-delta':
      return {
        ...state,
        reasoning:
          state.reasoning + (typeof chunk.delta === 'string' ? chunk.delta : ''),
        reasoningStreaming: true,
      }
    case 'reasoning-end':
      return { ...state, reasoningStreaming: false }
    case 'tool-input-start':
      return updateToolCall(state, String(chunk.toolCallId ?? ''), {
        toolName: typeof chunk.toolName === 'string' ? chunk.toolName : undefined,
        state: 'pending',
      })
    case 'tool-input-available':
      return updateToolCall(state, String(chunk.toolCallId ?? ''), {
        toolName: typeof chunk.toolName === 'string' ? chunk.toolName : undefined,
        input: chunk.input,
        state: 'pending',
      })
    case 'tool-output-available': {
      const toolCallId = String(chunk.toolCallId ?? '')
      const next = updateToolCall(state, toolCallId, {
        output: chunk.output,
        state: 'complete',
      })
      // Phase 3 WS-C — surface ANY UI parts the tool output advertises:
      // the legacy `awaiting-confirmation` mutation envelope plus the
      // generic `{ uiPart }` / `{ uiParts: [...] }` shapes. This lets
      // module authors define their own dynamic cards (stats panels,
      // record summaries, charts…) without touching the dispatcher or
      // the chat client.
      const newParts = extractUiPartsFromOutput(chunk.output, toolCallId)
      if (newParts.length === 0) return next
      const seen = new Set(next.uiParts.map((entry) => entry.key))
      const merged = [...next.uiParts]
      for (const part of newParts) {
        if (seen.has(part.key)) continue
        seen.add(part.key)
        merged.push(part)
      }
      if (merged.length === next.uiParts.length) return next
      return { ...next, uiParts: merged }
    }
    case 'tool-output-error':
      return updateToolCall(state, String(chunk.toolCallId ?? ''), {
        state: 'error',
        errorMessage:
          typeof chunk.errorText === 'string' ? chunk.errorText : 'Tool error',
      })
    case 'tool-input-error':
      return updateToolCall(state, String(chunk.toolCallId ?? ''), {
        toolName: typeof chunk.toolName === 'string' ? chunk.toolName : undefined,
        input: chunk.input,
        state: 'error',
        errorMessage:
          typeof chunk.errorText === 'string' ? chunk.errorText : 'Tool error',
      })
    default:
      return state
  }
}

function mergeAssistantMessage(
  current: AiChatMessage,
  state: AssistantBuilderState,
): AiChatMessage {
  return {
    ...current,
    content: state.text,
    reasoning: state.reasoning ? state.reasoning : undefined,
    reasoningStreaming: state.reasoning ? state.reasoningStreaming : undefined,
    toolCalls: state.toolCalls.length > 0 ? state.toolCalls : undefined,
    uiParts: state.uiParts.length > 0 ? state.uiParts : undefined,
  }
}

function parseSseLines(buffer: string): { events: string[]; rest: string } {
  const events: string[] = []
  let rest = buffer
  for (;;) {
    const idx = rest.indexOf('\n\n')
    if (idx === -1) break
    events.push(rest.slice(0, idx))
    rest = rest.slice(idx + 2)
  }
  return { events, rest }
}

function extractDataPayload(eventBlock: string): string | null {
  const lines = eventBlock.split('\n')
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6))
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5))
    }
  }
  if (dataLines.length === 0) return null
  return dataLines.join('\n')
}

async function readErrorEnvelope(response: Response): Promise<AiChatErrorEnvelope> {
  try {
    const data = (await response.clone().json()) as
      | { error?: unknown; code?: unknown; message?: unknown }
      | null
    if (data && typeof data === 'object') {
      const rawMessage =
        (typeof data.error === 'string' && data.error) ||
        (typeof data.message === 'string' && data.message) ||
        ''
      const rawCode = typeof data.code === 'string' ? data.code : undefined
      if (rawMessage || rawCode) {
        return {
          code: rawCode,
          message: rawMessage || 'Agent dispatch failed.',
        }
      }
    }
  } catch {
    // Fall through to text fallback
  }
  const text = await response.text().catch(() => '')
  return { message: text || `Agent dispatch failed (${response.status}).` }
}

export function useAiChat(input: UseAiChatInput): UseAiChatResult {
  const { agent, apiPath, pageContext, attachmentIds, debug, initialMessages, onError, conversationId: conversationIdInput } = input

  // Minted once on mount when the caller does not supply a conversationId.
  // The ref keeps the id stable across re-renders and is reused for every
  // turn so the Phase 3 WS-C `prepareMutation` idempotency hash stays
  // stable within the same chat. When the agent has a persisted session in
  // localStorage we re-hydrate the conversationId from it so re-opening the
  // chat continues the previous turn instead of starting fresh.
  const persistedRef = React.useRef<PersistedAiChatSession | null | 'unread'>('unread')
  if (persistedRef.current === 'unread') {
    // When the caller pins a `conversationId` (multi-tab session mode) we
    // read ONLY from that per-conversation slot. Falling back to the
    // legacy agent-only slot here would make every brand-new tab inherit
    // the previous tab's messages — the "+ shows the same chat" bug — so
    // unknown conversationIds always start clean. Without a pinned id we
    // keep the legacy single-session-per-agent layout for backward
    // compatibility.
    persistedRef.current =
      typeof conversationIdInput === 'string' && conversationIdInput.length > 0
        ? readPersistedSession(agent, conversationIdInput)
        : readPersistedSession(agent)
  }
  const persisted = persistedRef.current

  const mintedConversationIdRef = React.useRef<string | null>(null)
  if (mintedConversationIdRef.current === null) {
    mintedConversationIdRef.current = persisted?.conversationId ?? makeConversationId()
  }
  const effectiveConversationId =
    typeof conversationIdInput === 'string' && conversationIdInput.length > 0
      ? conversationIdInput
      : mintedConversationIdRef.current
  const persistKey =
    typeof conversationIdInput === 'string' && conversationIdInput.length > 0
      ? conversationIdInput
      : null
  const sessionStorageKey = getSessionStorageKey(agent, persistKey)

  const [messages, setMessages] = React.useState<AiChatMessage[]>(() => {
    if (persisted && persisted.messages.length > 0) {
      return persisted.messages
    }
    return (initialMessages ?? []).map((entry) => ({
      id: makeMessageId(),
      role: entry.role,
      content: entry.content,
    }))
  })

  // Persist messages + conversationId on every change. Skip during in-flight
  // streaming so we do not write the same growing string on every chunk —
  // the next idle tick captures the final assistant content.
  const [status, setStatusInternal] = React.useState<'idle' | 'submitting' | 'streaming'>(() =>
    isSessionStreamActive(sessionStorageKey) ? 'streaming' : 'idle',
  )
  // Refs mirror the latest persist state so the unmount cleanup can flush
  // an in-flight assistant message to localStorage even though the streaming
  // skip above (and React's stale-closure semantics) would otherwise lose it.
  // Without this, closing the dock or switching agents while the assistant
  // is "Thinking" abandons the partial reply (issue #1816).
  const latestMessagesRef = React.useRef<AiChatMessage[]>(messages)
  const persistKeyRef = React.useRef<string | null>(null)
  const agentRef = React.useRef<string>(agent)
  const effectiveConversationIdRef = React.useRef<string>(effectiveConversationId)
  const sessionStorageKeyRef = React.useRef<string>(sessionStorageKey)
  const mountedRef = React.useRef(true)
  React.useEffect(() => {
    latestMessagesRef.current = messages
  }, [messages])
  React.useEffect(() => {
    persistKeyRef.current =
      typeof conversationIdInput === 'string' && conversationIdInput.length > 0
        ? conversationIdInput
        : null
  }, [conversationIdInput])
  React.useEffect(() => {
    agentRef.current = agent
  }, [agent])
  React.useEffect(() => {
    effectiveConversationIdRef.current = effectiveConversationId
  }, [effectiveConversationId])
  React.useEffect(() => {
    sessionStorageKeyRef.current = sessionStorageKey
  }, [sessionStorageKey])
  React.useEffect(() => {
    if (status !== 'idle') return
    if (messages.length === 0) {
      clearPersistedSession(agent, persistKey)
      return
    }
    writePersistedSession(
      agent,
      {
        v: SESSION_STORAGE_VERSION,
        conversationId: effectiveConversationId,
        messages,
      },
      persistKey,
    )
  }, [agent, effectiveConversationId, messages, persistKey, status])
  const persistSnapshot = React.useCallback((snapshot: AiChatMessage[], notify = false) => {
    if (snapshot.length === 0) return
    writePersistedSession(
      agentRef.current,
      {
        v: SESSION_STORAGE_VERSION,
        conversationId: effectiveConversationIdRef.current,
        messages: snapshot,
      },
      persistKeyRef.current,
      { notify },
    )
  }, [])

  const updateMessages = React.useCallback(
    (
      updater:
        | AiChatMessage[]
        | ((current: AiChatMessage[]) => AiChatMessage[]),
      options?: { persistWhenUnmounted?: boolean },
    ) => {
      const current = latestMessagesRef.current
      const next = typeof updater === 'function' ? updater(current) : updater
      latestMessagesRef.current = next
      if (mountedRef.current) {
        setMessages(next)
      } else if (options?.persistWhenUnmounted) {
        persistSnapshot(next, true)
      }
    },
    [persistSnapshot],
  )

  const setStatus = React.useCallback((next: 'idle' | 'submitting' | 'streaming') => {
    if (mountedRef.current) {
      setStatusInternal(next)
    }
  }, [])
  const [error, setError] = React.useState<AiChatErrorEnvelope | null>(null)
  const [lastRequestDebug, setLastRequestDebug] = React.useState<
    { url: string; body: unknown } | null
  >(null)
  const [lastResponseDebug, setLastResponseDebug] = React.useState<
    { status: number; text: string } | null
  >(null)

  const abortRef = React.useRef<AbortController | null>(null)
  const onErrorRef = React.useRef(onError)
  React.useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const emitError = React.useCallback((envelope: AiChatErrorEnvelope) => {
    if (mountedRef.current) {
      setError(envelope)
      try {
        onErrorRef.current?.(envelope)
      } catch {
        // UI layer must never throw because a caller-supplied error handler
        // misbehaved.
      }
    }
  }, [])

  const cancel = React.useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    writeSessionStreamState(sessionStorageKeyRef.current, false)
    setStatus('idle')
  }, [setStatus])

  const reset = React.useCallback(() => {
    cancel()
    updateMessages([])
    setError(null)
    setLastRequestDebug(null)
    setLastResponseDebug(null)
    clearPersistedSession(agent, persistKey)
    mintedConversationIdRef.current = makeConversationId()
  }, [agent, cancel, persistKey, updateMessages])

  const sendMessage = React.useCallback(
    async (textInput: string, files?: AiChatMessageFile[]) => {
      const trimmed = textInput.trim()
      if (!trimmed) return
      if (abortRef.current) {
        abortRef.current.abort()
      }

      setError(null)
      const userMessage: AiChatMessage = {
        id: makeMessageId(),
        role: 'user',
        content: trimmed,
        files: files && files.length > 0 ? files : undefined,
      }
      const assistantMessage: AiChatMessage = {
        id: makeMessageId(),
        role: 'assistant',
        content: '',
      }
      const assistantId = assistantMessage.id
      // Snapshot prior messages for request payload so the dispatcher sees the
      // full turn history including the just-added user message.
      const outgoingHistory = [...latestMessagesRef.current, userMessage]
      updateMessages([...outgoingHistory, assistantMessage], { persistWhenUnmounted: true })
      setStatus('submitting')
      writeSessionStreamState(sessionStorageKey, true)

      const controller = new AbortController()
      abortRef.current = controller

      const url = getTransportEndpoint(agent, apiPath)
      const body = {
        messages: outgoingHistory.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        pageContext,
        attachmentIds,
        debug,
        conversationId: effectiveConversationId,
      }
      if (mountedRef.current) {
        setLastRequestDebug({ url, body })
      }

      let response: Response
      try {
        response = await apiFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream, text/plain, application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } catch (requestError) {
        if ((requestError as { name?: string })?.name === 'AbortError') {
          writeSessionStreamState(sessionStorageKey, false)
          setStatus('idle')
          abortRef.current = null
          return
        }
        const message =
          requestError instanceof Error
            ? requestError.message
            : 'Network request failed.'
        emitError({ message })
        writeSessionStreamState(sessionStorageKey, false)
        setStatus('idle')
        abortRef.current = null
        return
      }

      if (!response.ok) {
        const envelope = await readErrorEnvelope(response)
        if (mountedRef.current) {
          setLastResponseDebug({ status: response.status, text: envelope.message })
        }
        emitError(envelope)
        writeSessionStreamState(sessionStorageKey, false)
        setStatus('idle')
        updateMessages((current) => current.filter((entry) => entry.id !== assistantId), {
          persistWhenUnmounted: true,
        })
        abortRef.current = null
        return
      }

      const bodyStream = response.body
      if (!bodyStream) {
        if (mountedRef.current) {
          setLastResponseDebug({ status: response.status, text: '' })
        }
        writeSessionStreamState(sessionStorageKey, false)
        setStatus('idle')
        abortRef.current = null
        return
      }

      const headerGet = (name: string): string | null => {
        const headers = (response as { headers?: { get?: (k: string) => string | null } })
          .headers
        if (!headers || typeof headers.get !== 'function') return null
        try {
          return headers.get(name)
        } catch {
          return null
        }
      }
      const isUiMessageStream =
        headerGet('x-vercel-ai-ui-message-stream') !== null ||
        (headerGet('content-type') ?? '').includes('event-stream')

      setStatus('streaming')
      const reader = bodyStream.getReader()
      const decoder = new TextDecoder()
      let streamedRaw = ''
      let builder = createBuilder()
      let sseBuffer = ''
      const flushUiMessageBuffer = (extra?: string) => {
        if (extra) sseBuffer += extra
        const { events, rest } = parseSseLines(sseBuffer)
        sseBuffer = rest
        for (const block of events) {
          const data = extractDataPayload(block)
          if (!data) continue
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data) as { type?: string }
            if (parsed && typeof parsed.type === 'string') {
              builder = applyChunk(builder, parsed as { type: string })
            }
          } catch {
            // Tolerate malformed events / SSE comments.
          }
        }
      }
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value) continue
          const piece = decoder.decode(value, { stream: true })
          if (!piece) continue
          streamedRaw += piece

          if (isUiMessageStream) {
            flushUiMessageBuffer(piece)
          } else {
            // Plain text fallback (legacy `toTextStreamResponse`).
            builder = { ...builder, text: streamedRaw }
          }
          const snapshotBuilder = builder
          updateMessages(
            (current) =>
              current.map((entry) =>
                entry.id === assistantId
                  ? mergeAssistantMessage(entry, snapshotBuilder)
                  : entry,
              ),
            { persistWhenUnmounted: true },
          )
        }
        const tail = decoder.decode()
        if (tail) {
          streamedRaw += tail
          if (isUiMessageStream) {
            flushUiMessageBuffer(tail)
          } else {
            builder = { ...builder, text: streamedRaw }
          }
        }
        if (isUiMessageStream && sseBuffer.length > 0) {
          flushUiMessageBuffer('\n\n')
        }
        builder = { ...builder, reasoningStreaming: false }
        const finalSnapshot = builder
        updateMessages(
          (current) =>
            current.map((entry) =>
              entry.id === assistantId
                ? mergeAssistantMessage(entry, finalSnapshot)
                : entry,
            ),
          { persistWhenUnmounted: true },
        )
        if (mountedRef.current) {
          setLastResponseDebug({ status: response.status, text: streamedRaw })
        }
        const isEmpty =
          !builder.text.trim() && builder.toolCalls.length === 0 && !builder.reasoning
        if (isEmpty) {
          emitError({
            code: 'empty_response',
            message:
              'The AI agent returned an empty response. This usually means the LLM provider rejected the request (invalid API key, rate limit, or model error). Check your server logs for details.',
          })
          updateMessages((current) => current.filter((entry) => entry.id !== assistantId), {
            persistWhenUnmounted: true,
          })
        }
      } catch (streamError) {
        if ((streamError as { name?: string })?.name === 'AbortError') {
          // Cancelled by the user — keep whatever we have so far and exit
          // quietly.
        } else {
          const rawMessage =
            streamError instanceof Error
              ? streamError.message
              : 'Stream interrupted.'
          // LLM provider errors (auth failures, rate limits, invalid tool
          // schemas) surface as stream read errors. Include a hint so the
          // operator can check server logs for the full stack trace.
          const message = rawMessage.includes('API')
            ? rawMessage
            : `${rawMessage} — check server logs for LLM provider details.`
          emitError({ code: 'stream_error', message })
          // Remove the empty assistant placeholder so the error alert is
          // the only visible feedback.
          updateMessages((current) => current.filter((entry) => entry.id !== assistantId), {
            persistWhenUnmounted: true,
          })
        }
      } finally {
        reader.releaseLock()
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        writeSessionStreamState(sessionStorageKey, false)
        setStatus('idle')
      }
    },
    [
      agent,
      apiPath,
      attachmentIds,
      debug,
      effectiveConversationId,
      emitError,
      pageContext,
      sessionStorageKey,
      setStatus,
      updateMessages,
    ],
  )

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const handleSessionUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail
      if (!detail || detail.key !== sessionStorageKey) return
      const next = readPersistedSession(agent, persistKey)
      if (!next) return
      if (next.conversationId !== effectiveConversationId) return
      updateMessages(next.messages)
    }
    window.addEventListener(SESSION_UPDATED_EVENT, handleSessionUpdate)
    return () => {
      window.removeEventListener(SESSION_UPDATED_EVENT, handleSessionUpdate)
    }
  }, [agent, effectiveConversationId, persistKey, sessionStorageKey, updateMessages])

  React.useEffect(() => {
    if (isSessionStreamActive(sessionStorageKey)) {
      setStatusInternal('streaming')
    }
    if (typeof window === 'undefined') return
    const handleStreamState = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; active?: boolean }>).detail
      if (!detail || detail.key !== sessionStorageKey) return
      setStatusInternal(detail.active ? 'streaming' : 'idle')
    }
    window.addEventListener(SESSION_STREAM_STATE_EVENT, handleStreamState)
    return () => {
      window.removeEventListener(SESSION_STREAM_STATE_EVENT, handleStreamState)
    }
  }, [sessionStorageKey])

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      // Flush the latest snapshot — including any in-flight assistant
      // content — and let the request keep running in the background.
      // Background stream updates continue writing to this same storage slot
      // and notify any reopened chat for the conversation (issue #1816).
      const finalMessages = latestMessagesRef.current
      if (finalMessages.length > 0) {
        persistSnapshot(finalMessages, true)
      }
      mountedRef.current = false
    }
  }, [persistSnapshot])

  return {
    messages,
    status,
    error,
    lastRequestDebug,
    lastResponseDebug,
    conversationId: effectiveConversationId,
    sendMessage,
    cancel,
    reset,
  }
}
