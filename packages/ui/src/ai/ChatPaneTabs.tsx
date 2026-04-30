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
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { cn } from '@open-mercato/shared/lib/utils'
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
  const sessions = useAiChatSessions()
  const open = sessions.getOpenSessions(agentId)
  const closed = sessions.getClosedSessions(agentId)
  const active = sessions.getActiveSession(agentId)

  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [draftName, setDraftName] = React.useState('')

  const startRename = (session: AiChatSession) => {
    setRenamingId(session.id)
    setDraftName(session.name ?? defaultSessionLabel(session))
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
    <div
      className={cn(
        'flex items-center gap-1 overflow-x-auto px-2 pt-2 text-sm',
        className,
      )}
      data-ai-chat-tabs=""
      role="tablist"
      aria-label="Chat sessions"
    >
      {open.length === 0 ? (
        <span className="px-2 py-1 text-xs text-muted-foreground" data-ai-chat-tabs-empty="">
          No sessions
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
                  aria-label="Rename session"
                  title="Rename session"
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
                aria-label="Close session"
                title="Close session"
                className="opacity-0 transition-opacity group-hover:opacity-100 data-[active=true]:opacity-60 data-[active=true]:hover:opacity-100"
                data-active={isActive ? 'true' : 'false'}
                onClick={(event) => {
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
      <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
        <PopoverTrigger asChild>
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Recent sessions"
            title="Recent sessions"
            data-ai-chat-history-trigger=""
            className="shrink-0"
          >
            <Clock className="size-4" />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1">
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
                  onClick={() => {
                    sessions.reopenSession(session.id)
                    setHistoryOpen(false)
                  }}
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
        </PopoverContent>
      </Popover>
    </div>
  )
}
