'use client'

import * as React from 'react'
import { Wrench, AlertTriangle, Loader2, Check, X } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import type { PendingToolCall } from '../../types'

interface ToolCallConfirmationProps {
  toolCall: PendingToolCall
  onApprove: () => void
  onReject: () => void
}

const DESTRUCTIVE_PATTERNS = [/^delete/i, /^remove/i, /\.delete$/i, /\.remove$/i]

function isDestructive(toolName: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(toolName))
}

export function ToolCallConfirmation({
  toolCall,
  onApprove,
  onReject,
}: ToolCallConfirmationProps) {
  const destructive = isDestructive(toolCall.toolName)

  // Show different UI based on status
  if (toolCall.status === 'executing') {
    return (
      <div className="bg-muted/50 rounded-lg p-3 border animate-pulse">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm">Executing {toolCall.toolName}...</span>
        </div>
      </div>
    )
  }

  if (toolCall.status === 'completed') {
    return (
      <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3 border border-emerald-200 dark:border-emerald-800">
        <div className="flex items-center gap-2">
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm text-emerald-800 dark:text-emerald-200">
            {toolCall.toolName} completed successfully
          </span>
        </div>
      </div>
    )
  }

  if (toolCall.status === 'error') {
    return (
      <div className="bg-destructive/10 rounded-lg p-3 border border-destructive/20">
        <div className="flex items-center gap-2">
          <X className="h-4 w-4 text-destructive" />
          <span className="text-sm text-destructive">
            {toolCall.toolName} failed: {toolCall.error || 'Unknown error'}
          </span>
        </div>
      </div>
    )
  }

  if (toolCall.status === 'rejected') {
    return (
      <div className="bg-muted/30 rounded-lg p-3 border opacity-60">
        <div className="flex items-center gap-2">
          <X className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground line-through">
            {toolCall.toolName} cancelled
          </span>
        </div>
      </div>
    )
  }

  // Pending state - show confirmation UI
  return (
    <div
      className={cn(
        'rounded-lg p-3 border',
        destructive
          ? 'bg-destructive/5 border-destructive/20'
          : 'bg-muted/50 border-border'
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        {destructive ? (
          <AlertTriangle className="h-4 w-4 text-destructive" />
        ) : (
          <Wrench className="h-4 w-4 text-primary" />
        )}
        <span className="font-medium text-sm">
          {destructive ? 'Destructive action requested' : 'AI wants to execute:'}
        </span>
      </div>

      <div className="font-mono text-xs bg-background rounded p-2 mb-3 overflow-auto max-h-32">
        <div className={cn('font-medium', destructive ? 'text-destructive' : 'text-primary')}>
          {toolCall.toolName}
        </div>
        {toolCall.args && Object.keys(toolCall.args).length > 0 && (
          <pre className="text-muted-foreground mt-1 whitespace-pre-wrap break-all">
            {JSON.stringify(toolCall.args, null, 2)}
          </pre>
        )}
      </div>

      {destructive && (
        <p className="text-xs text-destructive mb-3">This action may not be reversible.</p>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onReject} className="flex-1">
          Cancel
        </Button>
        <Button
          size="sm"
          variant={destructive ? 'destructive' : 'default'}
          onClick={onApprove}
          className="flex-1"
        >
          {destructive ? 'Delete' : 'Execute'}
        </Button>
      </div>
    </div>
  )
}
