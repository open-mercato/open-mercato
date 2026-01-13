'use client'

import * as React from 'react'
import { Command } from 'cmdk'
import { Dialog, DialogContent } from '@open-mercato/ui/primitives/dialog'
import { cn } from '@open-mercato/shared/lib/utils'
import { useCommandPaletteContext } from './CommandPaletteProvider'
import { CommandInput } from './CommandInput'
import { CommandList } from './CommandList'
import { ChatView } from './ChatView'
import { KeyboardHints } from './KeyboardHints'

export function CommandPalette() {
  const {
    state,
    filteredTools,
    recentActions,
    messages,
    pendingToolCalls,
    close,
    setInputValue,
    setSelectedIndex,
    executeTool,
    sendMessage,
  } = useCommandPaletteContext()

  const { isOpen, mode, inputValue, selectedIndex, isLoading, isStreaming } = state

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      close()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mode === 'commands') {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(Math.min(selectedIndex + 1, filteredTools.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(Math.max(selectedIndex - 1, 0))
      } else if (e.key === 'Enter' && filteredTools[selectedIndex]) {
        e.preventDefault()
        const tool = filteredTools[selectedIndex]
        executeTool(tool.name)
        close()
      }
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'fixed left-1/2 top-[10vh] z-50 -translate-x-1/2',
          'w-full max-w-2xl p-0',
          'overflow-hidden rounded-xl border bg-background shadow-2xl',
          mode === 'chat' && 'max-h-[80vh]'
        )}
        onKeyDown={handleKeyDown}
      >
        <Command className="flex flex-col" shouldFilter={false}>
          <CommandInput
            value={inputValue}
            onValueChange={setInputValue}
            mode={mode}
            isLoading={isLoading || isStreaming}
          />

          {mode === 'commands' ? (
            <CommandList
              tools={filteredTools}
              recentActions={recentActions}
              selectedIndex={selectedIndex}
              onSelect={(tool) => {
                executeTool(tool.name)
                close()
              }}
              showRecent={inputValue.length === 0}
            />
          ) : (
            <ChatView
              messages={messages}
              pendingToolCalls={pendingToolCalls}
              isStreaming={isStreaming}
              onSendMessage={sendMessage}
            />
          )}

          <KeyboardHints mode={mode} />
        </Command>
      </DialogContent>
    </Dialog>
  )
}
