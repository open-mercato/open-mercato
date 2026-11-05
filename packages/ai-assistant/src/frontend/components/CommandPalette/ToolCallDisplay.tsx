'use client'

import * as React from 'react'
import { Wrench, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { ToolCall } from '../../types'
import { humanizeToolName } from '../../utils/toolMatcher'

interface ToolCallDisplayProps {
  toolCall: ToolCall
}

export function ToolCallDisplay({ toolCall }: ToolCallDisplayProps) {
  const displayName = humanizeToolName(toolCall.toolName)

  return (
    <div className="flex items-start gap-3 py-2 px-3 bg-muted/50 rounded-lg my-2">
      <div
        className={cn(
          'flex items-center justify-center w-6 h-6 rounded shrink-0',
          toolCall.status === 'completed' && 'bg-green-100 text-green-600',
          toolCall.status === 'error' && 'bg-red-100 text-red-600',
          toolCall.status === 'running' && 'bg-blue-100 text-blue-600',
          toolCall.status === 'pending' && 'bg-gray-100 text-gray-600'
        )}
      >
        {toolCall.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
        {toolCall.status === 'completed' && <Check className="h-3 w-3" />}
        {toolCall.status === 'error' && <X className="h-3 w-3" />}
        {toolCall.status === 'pending' && <Wrench className="h-3 w-3" />}
      </div>

      <div className="flex-1 min-w-0 text-xs">
        <div className="font-medium text-foreground">{displayName}</div>

        {Object.keys(toolCall.args).length > 0 && (
          <div className="text-muted-foreground mt-1">
            <code className="bg-muted px-1 rounded">
              {JSON.stringify(toolCall.args, null, 0).slice(0, 100)}
              {JSON.stringify(toolCall.args).length > 100 && '...'}
            </code>
          </div>
        )}

        {toolCall.status === 'completed' && toolCall.result !== undefined && (
          <div className="text-green-600 mt-1">
            Result: {typeof toolCall.result === 'object' ? 'Success' : String(toolCall.result)}
          </div>
        )}

        {toolCall.status === 'error' && toolCall.error && (
          <div className="text-red-600 mt-1">Error: {toolCall.error}</div>
        )}
      </div>
    </div>
  )
}
