'use client'

import * as React from 'react'
import { Command } from 'cmdk'
import { Search, MessageSquare, Loader2 } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import type { CommandPaletteMode } from '../../types'

interface CommandInputProps {
  value: string
  onValueChange: (value: string) => void
  mode: CommandPaletteMode
  isLoading?: boolean
  placeholder?: string
}

export function CommandInput({ value, onValueChange, mode, isLoading, placeholder }: CommandInputProps) {
  const defaultPlaceholder = mode === 'chat' ? 'Ask AI...' : 'Search commands or ask AI...'

  return (
    <div className="flex items-center gap-2 border-b px-4 py-3">
      <div className="flex items-center justify-center w-5 h-5 text-muted-foreground">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : mode === 'chat' ? (
          <MessageSquare className="h-4 w-4" />
        ) : (
          <Search className="h-4 w-4" />
        )}
      </div>

      <Command.Input
        value={value}
        onValueChange={onValueChange}
        placeholder={placeholder || defaultPlaceholder}
        className={cn(
          'flex-1 bg-transparent text-sm outline-none',
          'placeholder:text-muted-foreground'
        )}
        autoFocus
      />

      {mode === 'chat' && (
        <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
          AI
        </span>
      )}
    </div>
  )
}
