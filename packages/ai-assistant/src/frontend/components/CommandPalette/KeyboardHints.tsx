'use client'

import * as React from 'react'
import type { CommandPaletteMode } from '../../types'

interface KeyboardHintsProps {
  mode: CommandPaletteMode
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 text-[10px] font-medium bg-muted border rounded">
      {children}
    </kbd>
  )
}

export function KeyboardHints({ mode }: KeyboardHintsProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground">
      <div className="flex items-center gap-4">
        {mode === 'commands' ? (
          <>
            <span className="flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd>
              Select
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd>
            Send
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd>
          Close
        </span>
      </div>
    </div>
  )
}
