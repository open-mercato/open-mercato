"use client"

/**
 * Global AI Dock — a persistent right-side panel that hosts an `<AiChat>`
 * surface across page navigations.
 *
 * Modules invoke `useAiDock().dock({ agent, label, pageContext })` (typically
 * from the dialog header of an injection trigger) to move an active
 * assistant from a transient dialog into the dock. The dock survives router
 * navigation because the provider is mounted at the layout root (AppShell).
 *
 * The panel renders only when something is docked. Its width is persisted in
 * localStorage and adjustable via the drag handle on its left edge.
 */

import * as React from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import type { AiChatContextItem, AiChatSuggestion } from './AiChat'
import { ChatPaneTabs } from './ChatPaneTabs'
import { useAiChatSessions } from './AiChatSessions'
import { IconButton } from '../primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'

// Lazy import keeps the heavy chat surface (AI SDK + streaming runtime) out
// of the AppShell import graph. The dock provider only renders the chat when
// something is actually docked, so tests that never dock skip the import.
const LazyAiChat = React.lazy(async () => {
  const mod = await import('./AiChat')
  return { default: mod.AiChat }
})

const STORAGE_KEY = 'om-ai-dock-v1'
const MIN_WIDTH = 320
const MAX_WIDTH = 960
const DEFAULT_WIDTH = 420

export interface AiDockedAssistant {
  /** AI agent id (must be enabled for the current user). */
  agent: string
  /** Human-readable label shown in the dock header. */
  label: string
  /** Optional secondary description (e.g. module name). */
  description?: string
  /** Spec §10.1 page-context payload sent with each turn. */
  pageContext?: Record<string, unknown>
  /** Composer placeholder copy. */
  placeholder?: string
  /** Welcome card title. */
  welcomeTitle?: string
  /** Welcome card description. */
  welcomeDescription?: string
  /** Optional starter suggestions. */
  suggestions?: AiChatSuggestion[]
  /** Optional pinned context chips (e.g. "3 selected"). */
  contextItems?: AiChatContextItem[]
}

interface AiDockState {
  assistant: AiDockedAssistant | null
  width: number
  collapsed: boolean
}

interface AiDockApi {
  state: AiDockState
  /** Open / replace the docked assistant. */
  dock: (assistant: AiDockedAssistant) => void
  /** Close the dock. */
  undock: () => void
  /** True when the docked agent matches `agentId`. */
  isDocked: (agentId: string) => boolean
}

const COLLAPSED_WIDTH = 48

const AiDockContext = React.createContext<AiDockApi | null>(null)

function readPersisted(): AiDockState {
  if (typeof window === 'undefined') return { assistant: null, width: DEFAULT_WIDTH, collapsed: false }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { assistant: null, width: DEFAULT_WIDTH, collapsed: false }
    const parsed = JSON.parse(raw) as Partial<AiDockState> | null
    const width = Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, Number(parsed?.width) || DEFAULT_WIDTH),
    )
    return { assistant: null, width, collapsed: false }
  } catch {
    return { assistant: null, width: DEFAULT_WIDTH, collapsed: false }
  }
}

function persistWidth(width: number) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ width }))
  } catch {
    /* ignore */
  }
}

export function AiDockProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AiDockState>(() => ({
    assistant: null,
    width: DEFAULT_WIDTH,
    collapsed: false,
  }))

  React.useEffect(() => {
    const persisted = readPersisted()
    setState((prev) => ({ ...prev, width: persisted.width }))
  }, [])

  const dock = React.useCallback((assistant: AiDockedAssistant) => {
    // Always reset `collapsed` when (re)docking — the operator just clicked
    // "dock to side" and expects the panel to be visible at full width.
    setState((prev) => ({ ...prev, assistant, collapsed: false }))
  }, [])

  const undock = React.useCallback(() => {
    // Hard reset: drop the assistant AND the collapsed flag so the next
    // dock call starts from a clean slate. The wrapper observes `assistant`
    // turning null and clears its layout shift in the same render tick.
    setState((prev) => ({ ...prev, assistant: null, collapsed: false }))
  }, [])

  const isDocked = React.useCallback(
    (agentId: string) => state.assistant?.agent === agentId,
    [state.assistant?.agent],
  )

  const setWidth = React.useCallback((width: number) => {
    setState((prev) => ({ ...prev, width }))
    persistWidth(width)
  }, [])

  const setCollapsed = React.useCallback((collapsed: boolean) => {
    setState((prev) => ({ ...prev, collapsed }))
  }, [])

  const api = React.useMemo<AiDockApi>(
    () => ({ state, dock, undock, isDocked }),
    [state, dock, undock, isDocked],
  )

  // The right-side padding the page must reserve for the dock panel. Stays
  // null while nothing is docked so the wrapper renders no className/style
  // and the underlying layout (DataTable, sidebar grid) reclaims its full
  // width on undock.
  const reservedWidth = state.assistant
    ? state.collapsed
      ? COLLAPSED_WIDTH
      : state.width
    : null

  return (
    <AiDockContext.Provider value={api}>
      <div
        // The dock is desktop-only (`lg+`); reserve right-side padding only
        // at that breakpoint so mobile layout stays full-width.
        className={reservedWidth != null ? 'lg:pr-[var(--om-ai-dock-width)]' : undefined}
        style={
          reservedWidth != null
            ? ({ ['--om-ai-dock-width' as string]: `${reservedWidth}px` } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </div>
      {state.assistant ? (
        <AiDockPanel
          assistant={state.assistant}
          width={state.width}
          collapsed={state.collapsed}
          onCollapsedChange={setCollapsed}
          onWidthChange={setWidth}
          onClose={undock}
        />
      ) : null}
    </AiDockContext.Provider>
  )
}

export function useAiDock(): AiDockApi {
  const ctx = React.useContext(AiDockContext)
  if (ctx) return ctx
  // Fallback no-op API — keeps consumers safe when the provider is absent
  // (e.g. unit tests rendering a widget in isolation).
  return {
    state: { assistant: null, width: DEFAULT_WIDTH, collapsed: false },
    dock: () => {},
    undock: () => {},
    isDocked: () => false,
  }
}

interface AiDockPanelProps {
  assistant: AiDockedAssistant
  width: number
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onWidthChange: (width: number) => void
  onClose: () => void
}

function AiDockPanel({
  assistant,
  width,
  collapsed,
  onCollapsedChange,
  onWidthChange,
  onClose,
}: AiDockPanelProps) {
  const t = useT()
  const dragStateRef = React.useRef<{ startX: number; startWidth: number } | null>(null)

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const target = event.currentTarget
      target.setPointerCapture(event.pointerId)
      dragStateRef.current = { startX: event.clientX, startWidth: width }
    },
    [width],
  )

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStateRef.current) return
      const delta = dragStateRef.current.startX - event.clientX
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, dragStateRef.current.startWidth + delta),
      )
      onWidthChange(next)
    },
    [onWidthChange],
  )

  const handlePointerUp = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.currentTarget
      try {
        target.releasePointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
      dragStateRef.current = null
    },
    [],
  )

  return (
    <aside
      data-ai-dock-panel=""
      data-ai-dock-agent={assistant.agent}
      className={cn(
        // Dock is desktop-only — on small screens the AiChat dialog is the
        // primary surface (full-screen sheet) and a fixed side panel would
        // crowd the viewport.
        'hidden lg:flex',
        'fixed top-0 right-0 z-overlay h-svh flex-col border-l bg-background shadow-lg',
        collapsed ? 'w-12' : '',
      )}
      style={collapsed ? undefined : { width }}
      aria-label={assistant.label}
    >
      {!collapsed ? (
        <div
          role="separator"
          aria-orientation="vertical"
          tabIndex={-1}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="absolute left-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/20"
          data-ai-dock-resize-handle=""
        />
      ) : null}
      <header className="flex items-center gap-2 px-3 py-2">
        {collapsed ? (
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('ai_assistant.chat.dock.expand', 'Expand AI dock')}
            title={t('ai_assistant.chat.dock.expand', 'Expand AI dock')}
            onClick={() => onCollapsedChange(false)}
          >
            <Maximize2 className="size-4" />
          </IconButton>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium" data-ai-dock-label="">
                <span className="truncate">{assistant.label}</span>
                <span
                  className="inline-flex shrink-0 items-center rounded-full border border-border bg-secondary px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground"
                  data-ai-beta-chip=""
                >
                  {t('ai_assistant.chat.betaChip', 'beta')}
                </span>
              </div>
              {assistant.description ? (
                <div className="truncate text-xs text-muted-foreground">
                  {assistant.description}
                </div>
              ) : null}
            </div>
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('ai_assistant.chat.dock.collapse', 'Collapse AI dock')}
              title={t('ai_assistant.chat.dock.collapse', 'Collapse AI dock')}
              onClick={() => onCollapsedChange(true)}
            >
              <Minimize2 className="size-4" />
            </IconButton>
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('ai_assistant.chat.dock.close', 'Close AI dock')}
              title={t('ai_assistant.chat.dock.close', 'Close AI dock')}
              onClick={onClose}
              data-ai-dock-close=""
            >
              <X className="size-4" />
            </IconButton>
          </>
        )}
      </header>
      {!collapsed ? (
        <DockedChatBody assistant={assistant} />
      ) : null}
    </aside>
  )
}

function DockedChatBody({ assistant }: { assistant: AiDockedAssistant }) {
  const sessions = useAiChatSessions()
  const session = sessions.getActiveSession(assistant.agent)

  // Lazily ensure an open session exists. Running `ensureSession` inside an
  // effect (not inline during render) keeps the provider's setState calls
  // outside of the render phase. The first frame may render without a
  // session — that's fine, we render the tab strip alone until the next
  // tick when the new session is committed and `getActiveSession` returns
  // it.
  React.useEffect(() => {
    if (!session) sessions.ensureSession(assistant.agent)
  }, [assistant.agent, session, sessions])

  return (
    <>
      <ChatPaneTabs agentId={assistant.agent} className="border-b" />
      <div className="min-h-0 flex-1" data-ai-dock-chat-container="">
        {session ? (
          <React.Suspense fallback={null}>
            <LazyAiChat
              // `key` forces a fresh `<AiChat>` mount whenever the active
              // session changes — without it the AI SDK's internal status
              // would carry across tabs and surface the previous tab's
              // streaming indicator on a brand-new conversation.
              key={session.id}
              agent={assistant.agent}
              conversationId={session.conversationId}
              pageContext={assistant.pageContext}
              className="h-full"
              placeholder={assistant.placeholder}
              suggestions={assistant.suggestions}
              contextItems={assistant.contextItems}
              welcomeTitle={assistant.welcomeTitle}
              welcomeDescription={assistant.welcomeDescription}
            />
          </React.Suspense>
        ) : null}
      </div>
    </>
  )
}
