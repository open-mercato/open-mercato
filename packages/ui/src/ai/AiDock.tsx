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
import { IconButton } from '../primitives/icon-button'
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

const AiDockContext = React.createContext<AiDockApi | null>(null)

function readPersisted(): AiDockState {
  if (typeof window === 'undefined') return { assistant: null, width: DEFAULT_WIDTH }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { assistant: null, width: DEFAULT_WIDTH }
    const parsed = JSON.parse(raw) as Partial<AiDockState> | null
    const width = Math.min(
      MAX_WIDTH,
      Math.max(MIN_WIDTH, Number(parsed?.width) || DEFAULT_WIDTH),
    )
    return { assistant: null, width }
  } catch {
    return { assistant: null, width: DEFAULT_WIDTH }
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
  }))

  React.useEffect(() => {
    const persisted = readPersisted()
    setState((prev) => ({ ...prev, width: persisted.width }))
  }, [])

  const dock = React.useCallback((assistant: AiDockedAssistant) => {
    setState((prev) => ({ ...prev, assistant }))
  }, [])

  const undock = React.useCallback(() => {
    setState((prev) => ({ ...prev, assistant: null }))
  }, [])

  const isDocked = React.useCallback(
    (agentId: string) => state.assistant?.agent === agentId,
    [state.assistant?.agent],
  )

  const setWidth = React.useCallback((width: number) => {
    setState((prev) => ({ ...prev, width }))
    persistWidth(width)
  }, [])

  const api = React.useMemo<AiDockApi>(
    () => ({ state, dock, undock, isDocked }),
    [state, dock, undock, isDocked],
  )

  return (
    <AiDockContext.Provider value={api}>
      <div
        // The dock is desktop-only (`lg+`); reserve right-side padding only
        // at that breakpoint so mobile layout stays full-width.
        className={state.assistant ? 'lg:pr-[var(--om-ai-dock-width)]' : undefined}
        style={
          state.assistant
            ? ({ ['--om-ai-dock-width' as string]: `${state.width}px` } as React.CSSProperties)
            : undefined
        }
      >
        {children}
      </div>
      {state.assistant ? (
        <AiDockPanel
          assistant={state.assistant}
          width={state.width}
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
    state: { assistant: null, width: DEFAULT_WIDTH },
    dock: () => {},
    undock: () => {},
    isDocked: () => false,
  }
}

interface AiDockPanelProps {
  assistant: AiDockedAssistant
  width: number
  onWidthChange: (width: number) => void
  onClose: () => void
}

function AiDockPanel({ assistant, width, onWidthChange, onClose }: AiDockPanelProps) {
  const [collapsed, setCollapsed] = React.useState(false)
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
      <header className="flex items-center gap-2 border-b px-3 py-2">
        {collapsed ? (
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Expand AI dock"
            title="Expand AI dock"
            onClick={() => setCollapsed(false)}
          >
            <Maximize2 className="size-4" />
          </IconButton>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium" data-ai-dock-label="">
                {assistant.label}
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
              aria-label="Collapse AI dock"
              title="Collapse AI dock"
              onClick={() => setCollapsed(true)}
            >
              <Minimize2 className="size-4" />
            </IconButton>
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Close AI dock"
              title="Close AI dock"
              onClick={onClose}
              data-ai-dock-close=""
            >
              <X className="size-4" />
            </IconButton>
          </>
        )}
      </header>
      {!collapsed ? (
        <div className="min-h-0 flex-1" data-ai-dock-chat-container="">
          <React.Suspense fallback={null}>
            <LazyAiChat
              agent={assistant.agent}
              pageContext={assistant.pageContext}
              className="h-full"
              placeholder={assistant.placeholder}
              suggestions={assistant.suggestions}
              contextItems={assistant.contextItems}
              welcomeTitle={assistant.welcomeTitle}
              welcomeDescription={assistant.welcomeDescription}
            />
          </React.Suspense>
        </div>
      ) : null}
    </aside>
  )
}
