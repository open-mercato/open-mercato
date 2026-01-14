'use client'

import * as React from 'react'
import { Code } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { PalettePhase, ConnectionStatus } from '../../types'

interface CommandFooterProps {
  phase: PalettePhase
  connectionStatus: ConnectionStatus
  showDebug?: boolean
  onToggleDebug?: () => void
}

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const statusConfig: Record<ConnectionStatus, { color: string; text: string }> = {
    connected: { color: 'bg-emerald-500', text: 'Connected' },
    connecting: { color: 'bg-yellow-500 animate-pulse', text: 'Connecting...' },
    disconnected: { color: 'bg-gray-400', text: 'Disconnected' },
    error: { color: 'bg-red-500', text: 'Error' },
  }

  const config = statusConfig[status]

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <div className={cn('h-1.5 w-1.5 rounded-full', config.color)} />
      <span>{config.text}</span>
    </div>
  )
}

function KeyboardShortcut({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-0.5">
      {keys.map((key, i) => (
        <kbd
          key={i}
          className={cn(
            'inline-flex h-5 min-w-[20px] items-center justify-center rounded',
            'bg-muted px-1.5 text-[10px] font-medium text-muted-foreground'
          )}
        >
          {key}
        </kbd>
      ))}
    </div>
  )
}

export function CommandFooter({
  phase,
  connectionStatus,
  showDebug = false,
  onToggleDebug,
}: CommandFooterProps) {
  const idleShortcuts = [
    { label: 'Submit', keys: ['\u21B5'] },
    { label: 'Close', keys: ['Esc'] },
  ]

  const chatShortcuts = [
    { label: 'Send', keys: ['\u21B5'] },
    { label: 'Back', keys: ['Esc'] },
  ]

  const shortcuts = phase === 'idle' ? idleShortcuts : chatShortcuts

  return (
    <div className="relative flex items-center justify-between px-3 py-2 border-t bg-muted/20 text-xs">
      <div className="flex items-center gap-3">
        <ConnectionIndicator status={connectionStatus} />

        {/* Debug toggle button */}
        {onToggleDebug && (
          <button
            type="button"
            onClick={onToggleDebug}
            className={cn(
              'flex items-center gap-1 transition-colors',
              showDebug
                ? 'text-blue-500 hover:text-blue-400'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title="Toggle debug panel"
          >
            <Code className="w-3 h-3" />
            <span>{showDebug ? 'Hide Debug' : 'Debug'}</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        {shortcuts.map((shortcut, i) => (
          <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
            <span>{shortcut.label}</span>
            <KeyboardShortcut keys={shortcut.keys} />
          </div>
        ))}
      </div>
    </div>
  )
}
