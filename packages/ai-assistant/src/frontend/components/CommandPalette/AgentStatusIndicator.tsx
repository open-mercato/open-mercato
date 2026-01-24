'use client'

import { Loader2 } from 'lucide-react'
import type { AgentStatus } from '../../types'

interface AgentStatusIndicatorProps {
  status: AgentStatus
}

export function AgentStatusIndicator({ status }: AgentStatusIndicatorProps) {
  if (status.type === 'idle') return null

  // Get display text based on status type
  let message: string
  switch (status.type) {
    case 'thinking':
      message = 'Thinking...'
      break
    case 'responding':
      message = 'Responding...'
      break
    case 'tool':
      message = status.toolName
      break
    case 'executing':
      message = 'Executing tools...'
      break
    default:
      message = 'Working...'
  }

  return (
    <div className="flex items-center gap-2 py-3 px-3 bg-muted/50 rounded-lg text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{message}</span>
    </div>
  )
}
