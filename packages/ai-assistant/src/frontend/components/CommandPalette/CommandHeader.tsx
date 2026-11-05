'use client'

import * as React from 'react'
import { ArrowLeft, Wrench, MessageSquare } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { PalettePhase, ToolInfo } from '../../types'

interface CommandHeaderProps {
  phase: PalettePhase
  selectedTool: ToolInfo | null
  onBack: () => void
}

export function CommandHeader({ phase, selectedTool, onBack }: CommandHeaderProps) {
  // Only show header when not in idle phase
  if (phase === 'idle') {
    return null
  }

  // Show routing header
  if (phase === 'routing') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <button
          type="button"
          onClick={onBack}
          className={cn(
            'flex items-center justify-center h-6 w-6 rounded-md',
            'hover:bg-muted transition-colors',
            'text-muted-foreground hover:text-foreground'
          )}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="text-sm text-muted-foreground">Processing...</span>
      </div>
    )
  }

  // Show chatting/confirming/executing header
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
      <button
        type="button"
        onClick={onBack}
        className={cn(
          'flex items-center justify-center h-6 w-6 rounded-md',
          'hover:bg-muted transition-colors',
          'text-muted-foreground hover:text-foreground'
        )}
      >
        <ArrowLeft className="h-4 w-4" />
      </button>

      {selectedTool ? (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex items-center justify-center h-6 w-6 rounded bg-primary/10 text-primary">
            <Wrench className="h-3 w-3" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{selectedTool.name}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex items-center justify-center h-6 w-6 rounded bg-primary/10 text-primary">
            <MessageSquare className="h-3 w-3" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">Chat</p>
          </div>
        </div>
      )}
    </div>
  )
}
