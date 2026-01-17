'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'cmdk'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { cn } from '@open-mercato/shared/lib/utils'
import { useCommandPaletteContext } from './CommandPaletteProvider'
import { CommandInput } from './CommandInput'
import { CommandHeader } from './CommandHeader'
import { CommandFooter } from './CommandFooter'
import { ToolChatPage } from './ToolChatPage'
import { DebugPanel } from './DebugPanel'

// Idle state - shown when palette is open but no query submitted
function IdleState() {
  return (
    <div className="py-8 px-4 text-center text-muted-foreground">
      <p className="mb-2">Ask me anything or describe what you want to do.</p>
      <p className="text-sm">Examples:</p>
      <ul className="text-sm mt-2 space-y-1">
        <li>&quot;Search for customers in New York&quot;</li>
        <li>&quot;Create a new product&quot;</li>
        <li>&quot;Show me recent orders&quot;</li>
      </ul>
    </div>
  )
}

// Routing indicator - shown while fast model analyzes intent
function RoutingIndicator() {
  return (
    <div className="py-8 flex items-center justify-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm text-muted-foreground">Analyzing request...</span>
    </div>
  )
}

export function CommandPalette() {
  const {
    state,
    isThinking,
    isSessionAuthorized,
    messages,
    pendingToolCalls,
    selectedTool,
    close,
    setInputValue,
    handleSubmit,
    reset,
    sendAgenticMessage,
    approveToolCall,
    rejectToolCall,
    debugEvents,
    showDebug,
    setShowDebug,
    clearDebugEvents,
    pendingQuestion,
    answerQuestion,
  } = useCommandPaletteContext()

  const {
    isOpen,
    phase,
    inputValue,
    isLoading,
    isStreaming,
    connectionStatus,
  } = state

  const [localInput, setLocalInput] = React.useState('')

  // Reset local input when phase changes to idle
  React.useEffect(() => {
    if (phase === 'idle') {
      setLocalInput('')
    }
  }, [phase])

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      close()
    }
  }

  const handleInputSubmit = async () => {
    const query = localInput.trim()
    if (!query) return
    setLocalInput('')
    await handleSubmit(query)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && phase === 'idle' && localInput.trim()) {
      e.preventDefault()
      handleInputSubmit()
    }
  }

  return (
    <>
      {/* Custom blur overlay when debug mode is on (since modal=false removes it) */}
      {isOpen && showDebug && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm pointer-events-none" />
      )}
      <Dialog open={isOpen} onOpenChange={handleOpenChange} modal={!showDebug}>
        <DialogContent
          className={cn(
            'fixed left-1/2 top-[10vh] z-50 -translate-x-1/2',
            'w-full max-w-2xl p-0',
            'overflow-hidden rounded-xl border bg-background shadow-2xl',
            'max-h-[80vh] flex flex-col'
          )}
          onKeyDown={handleKeyDown}
          onPointerDownOutside={(e) => {
            // Prevent closing on outside click when debug mode is on
            if (showDebug) {
              e.preventDefault()
            }
          }}
          onInteractOutside={(e) => {
            // Prevent closing on outside interaction when debug mode is on
            if (showDebug) {
              e.preventDefault()
            }
          }}
        >
          {/* Visually hidden title for accessibility */}
          <VisuallyHidden>
            <DialogTitle>AI Command Palette</DialogTitle>
          </VisuallyHidden>
          <Command className="flex flex-col flex-1 min-h-0" shouldFilter={false}>
            {/* Header - shows phase/tool info */}
            <CommandHeader
              phase={phase}
              selectedTool={selectedTool}
              onBack={reset}
            />

            {/* Input - shown in idle phase */}
            {phase === 'idle' && (
              <CommandInput
                value={localInput}
                onValueChange={setLocalInput}
                mode="commands"
                isLoading={isLoading}
                placeholder="Ask me anything or describe what you want to do..."
              />
            )}

            {/* Content area */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {phase === 'idle' && !localInput && <IdleState />}

              {phase === 'routing' && <RoutingIndicator />}

              {(phase === 'chatting' || phase === 'confirming' || phase === 'executing') && (
                <ToolChatPage
                  tool={selectedTool}
                  messages={messages}
                  pendingToolCalls={pendingToolCalls}
                  isStreaming={isStreaming}
                  isThinking={isThinking}
                  onSendMessage={sendAgenticMessage}
                  onApproveToolCall={approveToolCall}
                  onRejectToolCall={rejectToolCall}
                  pendingQuestion={pendingQuestion}
                  onAnswerQuestion={answerQuestion}
                />
              )}
            </div>

            {/* Footer with connection status and keyboard hints */}
            <CommandFooter
              phase={phase}
              connectionStatus={connectionStatus}
              isSessionAuthorized={isSessionAuthorized}
              showDebug={showDebug}
              onToggleDebug={() => setShowDebug(!showDebug)}
            />
          </Command>
        </DialogContent>
      </Dialog>

      {/* Debug panel - rendered via portal outside the dialog DOM tree */}
      {isOpen && showDebug && typeof document !== 'undefined' && createPortal(
        <div
          data-debug-panel
          className="fixed top-[10vh] right-4 z-[9999] w-[400px] bg-gray-900 rounded-xl border border-gray-700 shadow-2xl flex flex-col overflow-hidden"
          style={{ maxHeight: 'calc(80vh - 20px)' }}
        >
          <DebugPanel
            events={debugEvents}
            onClear={clearDebugEvents}
            isOpen={true}
            onToggle={() => setShowDebug(false)}
          />
        </div>,
        document.body
      )}
    </>
  )
}
