"use client"

/**
 * Tab strip rendered above an `<AiChat>` surface (dock panel, dialog sheet).
 *
 * Each tab is a session for the same agent. The strip provides:
 *   - tab switching (click)
 *   - inline rename (double-click on the active tab title or pencil icon)
 *   - close (X on hover)
 *   - new session (`+`)
 *   - history dropdown (clock icon → recent closed sessions; click reopens)
 *
 * The component is purely UI — state lives in `AiChatSessionsProvider`.
 */

import * as React from 'react'
import { Clock, Pencil, Plus, X } from 'lucide-react'
import { IconButton } from '../primitives/icon-button'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  defaultSessionLabel,
  useAiChatSessions,
  type AiChatSession,
} from './AiChatSessions'

export interface ChatPaneTabsProps {
  agentId: string
  className?: string
}

export function ChatPaneTabs({ agentId, className }: ChatPaneTabsProps) {
  const t = useT()
  const sessions = useAiChatSessions()
  const open = sessions.getOpenSessions(agentId)
  const closed = sessions.getClosedSessions(agentId)
  const active = sessions.getActiveSession(agentId)

  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [draftName, setDraftName] = React.useState('')

  const startRename = (session: AiChatSession) => {
    setRenamingId(session.id)
    // Pre-fill with the current name only — never the date fallback. If
    // we pre-filled with the formatted date, blurring without typing
    // would persist that date string as the session name, and creating
    // a new tab a minute later would "leak" the old tab's date label
    // onto every other unnamed tab.
    setDraftName(session.name ?? '')
  }

  const commitRename = () => {
    if (!renamingId) return
    sessions.renameSession(renamingId, draftName)
    setRenamingId(null)
  }

  const cancelRename = () => {
    setRenamingId(null)
    setDraftName('')
  }

  return (
    // Outer wrapper does NOT scroll; only the inner tabs row does. The
    // `+` button and the history dropdown live OUTSIDE that scroll area
    // so the dropdown's absolute positioning isn't clipped by the
    // strip's `overflow-x-auto` (which CSS resolves to `overflow-y:auto`
    // too once one axis is non-`visible`, making any absolutely-
    // positioned child get cut off at the strip's bottom edge).
    <div
      className={cn('flex items-center gap-1 px-2 pt-2 text-sm', className)}
      data-ai-chat-tabs=""
      role="tablist"
      aria-label="Chat sessions"
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        data-ai-chat-tabs-scroll=""
      >
      {open.length === 0 ? (
        <span className="px-2 py-1 text-xs text-muted-foreground" data-ai-chat-tabs-empty="">
          {t('ai_assistant.chat.tabs.noSessions', 'No sessions')}
        </span>
      ) : (
        open.map((session) => {
          const isActive = active?.id === session.id
          const isRenaming = renamingId === session.id
          const label = defaultSessionLabel(session)
          return (
            <div
              key={session.id}
              role="tab"
              aria-selected={isActive}
              data-ai-chat-tab-id={session.id}
              data-active={isActive ? 'true' : 'false'}
              className={cn(
                'group flex max-w-[12rem] shrink-0 items-center gap-1 rounded-t-md border-b-2 px-2 py-1',
                isActive
                  ? 'border-primary bg-background text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {isRenaming ? (
                <input
                  autoFocus
                  type="text"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitRename()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelRename()
                    }
                  }}
                  className="h-6 max-w-[10rem] rounded border border-input bg-background px-1 text-xs outline-none focus:ring-2 focus:ring-ring/40"
                  data-ai-chat-tab-rename-input=""
                />
              ) : (
                <button
                  type="button"
                  onClick={() => sessions.setActiveSession(session.id)}
                  onDoubleClick={() => startRename(session)}
                  title={label}
                  className="truncate text-xs font-medium"
                >
                  {label}
                </button>
              )}
              {!isRenaming && isActive ? (
                <IconButton
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={t('ai_assistant.chat.tabs.rename', 'Rename')}
                  title={t('ai_assistant.chat.tabs.rename', 'Rename')}
                  className="opacity-60 hover:opacity-100"
                  onClick={() => startRename(session)}
                  data-ai-chat-tab-rename=""
                >
                  <Pencil className="size-3" />
                </IconButton>
              ) : null}
              <IconButton
                type="button"
                variant="ghost"
                size="xs"
                aria-label={t('ai_assistant.chat.tabs.close', 'Close')}
                title={t('ai_assistant.chat.tabs.close', 'Close')}
                // Always rendered visible (a previous opacity-0 default
                // hid the X on non-hover and made the active-tab close
                // button look unreachable). Closing the very last open
                // tab is fine — `ensureSession` in the chat body's
                // effect immediately mints a fresh empty tab so the user
                // never sees an empty pane.
                className={cn(
                  'transition-opacity',
                  isActive ? 'opacity-60 hover:opacity-100' : 'opacity-50 hover:opacity-100',
                )}
                data-active={isActive ? 'true' : 'false'}
                onMouseDown={(event) => {
                  // Prevent the parent tab button's blur logic / focus
                  // shift from racing the close click on the active tab.
                  event.stopPropagation()
                }}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  sessions.closeSession(session.id)
                }}
                data-ai-chat-tab-close=""
              >
                <X className="size-3" />
              </IconButton>
            </div>
          )
        })
      )}
      </div>
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        aria-label="New session"
        title="New session"
        onClick={() => sessions.createSession(agentId)}
        data-ai-chat-new-session=""
        className="shrink-0"
      >
        <Plus className="size-4" />
      </IconButton>
      <HistoryDropdown
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        closed={closed}
        onPick={(sessionId) => {
          sessions.reopenSession(sessionId)
          setHistoryOpen(false)
        }}
      />
    </div>
  )
}

interface HistoryDropdownProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  closed: AiChatSession[]
  onPick: (sessionId: string) => void
}

/**
 * Plain absolutely-positioned dropdown for the recent-sessions list.
 * Bypasses the Radix Popover primitive on purpose — every chat surface
 * (dock panel, customers/catalog/launcher dialog) creates its own stacking
 * context, and the Radix Portal'd PopoverContent kept ending up either
 * behind the dialog or pushed off the visible area on tall sheets. A
 * direct `position: absolute` child of the trigger button anchors the
 * dropdown to the icon, inherits the surface's stacking context, and is
 * predictable across the dock + every dialog host without z-index hacks.
 */
function HistoryDropdown({ open, onOpenChange, closed, onPick }: HistoryDropdownProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent | TouchEvent) => {
      const root = containerRef.current
      if (!root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      onOpenChange(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('touchstart', onDown, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('touchstart', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  return (
    <div ref={containerRef} className="relative shrink-0">
      <IconButton
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Recent sessions"
        title="Recent sessions"
        data-ai-chat-history-trigger=""
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <Clock className="size-4" />
      </IconButton>
      {open ? (
        <div
          className="absolute right-0 top-full mt-2 w-72 max-h-[60vh] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          // Inline z-index so the dropdown sits above any host surface
          // (chat dialog at z-[70], dock panel, modal overlays). Inline
          // beats Tailwind JIT for arbitrary high values.
          style={{ zIndex: 2147483000 }}
          data-ai-chat-history-panel=""
          role="menu"
        >
          <div className="px-3 pt-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent sessions
          </div>
          {closed.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground" data-ai-chat-history-empty="">
              No previous sessions yet.
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {closed.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  role="menuitem"
                  onClick={() => onPick(session.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
                  data-ai-chat-history-item={session.id}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {defaultSessionLabel(session)}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {new Date(session.lastUsedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
