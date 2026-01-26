'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'cmdk'
import {
  Loader2,
  Send,
  Square,
  X,
  Minimize2,
  PanelRight,
  PanelLeft,
  PanelBottom,
  MessageCircle,
} from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { useCommandPaletteContext } from '../CommandPalette/CommandPaletteProvider'
import { CommandInput } from '../CommandPalette/CommandInput'
import { CommandHeader } from '../CommandPalette/CommandHeader'
import { CommandFooter } from '../CommandPalette/CommandFooter'
import { ToolChatPage } from '../CommandPalette/ToolChatPage'
import { DebugPanel } from '../CommandPalette/DebugPanel'
import { AiDot } from '../AiDot'
import type { DockPosition } from '../../types'
import { useDockPosition } from '../../hooks/useDockPosition'

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

interface DockControlsProps {
  position: DockPosition
  onPositionChange: (position: DockPosition) => void
  onMinimize: () => void
  onClose: () => void
}

function DockControls({
  position,
  onPositionChange,
  onMinimize,
  onClose,
}: DockControlsProps) {
  const positions: { value: DockPosition; icon: React.ReactNode; label: string }[] = [
    { value: 'floating', icon: <MessageCircle className="h-3.5 w-3.5" />, label: 'Floating' },
    { value: 'left', icon: <PanelLeft className="h-3.5 w-3.5" />, label: 'Dock Left' },
    { value: 'bottom', icon: <PanelBottom className="h-3.5 w-3.5" />, label: 'Dock Bottom' },
    { value: 'right', icon: <PanelRight className="h-3.5 w-3.5" />, label: 'Dock Right' },
  ]

  return (
    <div className="flex items-center gap-1">
      {positions.map((pos) => (
        <Button
          key={pos.value}
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6', position === pos.value && 'bg-accent')}
          onClick={() => onPositionChange(pos.value)}
          title={pos.label}
        >
          {pos.icon}
        </Button>
      ))}
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onMinimize}
        title="Minimize"
      >
        <Minimize2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onClose}
        title="Close"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

const FLOATING_POSITION_STYLE: React.CSSProperties = {
  bottom: 24,
  right: 24,
}

export function DockableChat() {
  const {
    state,
    isThinking,
    agentStatus,
    isSessionAuthorized,
    messages,
    pendingToolCalls,
    selectedTool,
    close,
    reset,
    handleSubmit,
    sendAgenticMessage,
    stopExecution,
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
    dockState,
    setPosition,
    toggleMinimized,
    setMinimized,
    isFloating,
    isHydrated,
  } = useDockPosition()

  const {
    isOpen,
    phase,
    inputValue,
    isLoading,
    isStreaming,
    connectionStatus,
  } = state

  const [localInput, setLocalInput] = React.useState('')
  const [chatInput, setChatInput] = React.useState('')
  const chatInputRef = React.useRef<HTMLInputElement>(null)

  // Reset local input when phase changes to idle
  React.useEffect(() => {
    if (phase === 'idle') {
      setLocalInput('')
      setChatInput('')
    }
  }, [phase])

  // Focus chat input when entering chatting phase
  React.useEffect(() => {
    if (phase === 'chatting' || phase === 'confirming' || phase === 'executing') {
      setTimeout(() => chatInputRef.current?.focus(), 50)
    }
  }, [phase])

  const handleInputSubmit = async () => {
    const query = localInput.trim()
    if (!query) return
    setLocalInput('')
    await handleSubmit(query)
  }

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && phase === 'idle' && localInput.trim()) {
      e.preventDefault()
      handleInputSubmit()
    }
  }

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim() || isStreaming) return

    const content = chatInput
    setChatInput('')
    await sendAgenticMessage(content)
  }

  const handleChatKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (chatInput.trim() && !isStreaming) {
        const content = chatInput
        setChatInput('')
        sendAgenticMessage(content)
      }
    }
  }

  // Don't render until hydrated to avoid SSR mismatch
  if (!isHydrated) return null

  // When minimized in any mode, show the AiDot in bottom-right corner
  if (isOpen && dockState.isMinimized) {
    return typeof document !== 'undefined' ? createPortal(
      <AiDot
        onClick={() => setMinimized(false)}
        isActive={isStreaming || isThinking}
        hasMessages={messages.length > 0}
        position="bottom-right"
      />,
      document.body
    ) : null
  }

  // Render as floating panel when in floating mode
  if (isFloating) {
    if (!isOpen) return null

    return typeof document !== 'undefined' ? createPortal(
      <>
        <div
          className={cn(
            'fixed z-50',
            'rounded-xl border bg-background shadow-2xl',
            'flex flex-col',
            'transition-all duration-200 ease-out'
          )}
          style={{
            ...FLOATING_POSITION_STYLE,
            width: dockState.width,
            height: dockState.height,
            maxHeight: 'calc(100vh - 48px)',
          }}
          onKeyDown={handleInputKeyDown}
        >
          <Command className="flex flex-col flex-1 min-h-0 rounded-xl overflow-hidden" shouldFilter={false}>
            {/* Dock controls header */}
            <div className="flex items-center justify-end px-2 py-1.5 border-b shrink-0">
              <DockControls
                position={dockState.position}
                onPositionChange={setPosition}
                onMinimize={toggleMinimized}
                onClose={close}
              />
            </div>

            <CommandHeader
              phase={phase}
              selectedTool={selectedTool}
              onBack={reset}
            />

            {phase === 'idle' && (
              <CommandInput
                value={localInput}
                onValueChange={setLocalInput}
                mode="commands"
                isLoading={isLoading}
                placeholder="Ask me anything..."
              />
            )}

            <div className="flex-1 min-h-0 overflow-y-auto">
              {phase === 'idle' && !localInput && <IdleState />}
              {phase === 'routing' && <RoutingIndicator />}
              {(phase === 'chatting' || phase === 'confirming' || phase === 'executing') && (
                <ToolChatPage
                  tool={selectedTool}
                  messages={messages}
                  pendingToolCalls={pendingToolCalls}
                  isStreaming={isStreaming}
                  isThinking={isThinking}
                  agentStatus={agentStatus}
                  onApproveToolCall={approveToolCall}
                  onRejectToolCall={rejectToolCall}
                  pendingQuestion={pendingQuestion}
                  onAnswerQuestion={answerQuestion}
                />
              )}
            </div>

            {(phase === 'chatting' || phase === 'confirming' || phase === 'executing') && (
              <form onSubmit={handleChatSubmit} className="shrink-0 border-t p-3">
                <div className="flex items-center gap-2">
                  <input
                    ref={chatInputRef}
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleChatKeyDown}
                    placeholder="Describe what you want to do..."
                    className={cn(
                      'flex-1 bg-muted rounded-lg px-4 py-2 text-sm outline-none',
                      'focus:ring-2 focus:ring-ring',
                      'disabled:opacity-50'
                    )}
                    disabled={isStreaming}
                  />
                  <Button
                    type={isStreaming ? 'button' : 'submit'}
                    size="icon"
                    variant={isStreaming ? 'destructive' : 'default'}
                    onClick={isStreaming ? stopExecution : undefined}
                    disabled={!isStreaming && !chatInput.trim()}
                  >
                    {isStreaming ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </form>
            )}

            <CommandFooter
              phase={phase}
              connectionStatus={connectionStatus}
              isSessionAuthorized={isSessionAuthorized}
              showDebug={showDebug}
              onToggleDebug={() => setShowDebug(!showDebug)}
            />
          </Command>
        </div>

        {showDebug && (
          <div
            data-debug-panel
            className="fixed z-[9999] bg-gray-900 rounded-xl border border-gray-700 shadow-2xl flex flex-col overflow-hidden"
            style={{
              top: '24px',
              left: '24px',
              width: '400px',
              maxHeight: 'calc(100vh - 48px)',
            }}
          >
            <DebugPanel
              events={debugEvents}
              onClear={clearDebugEvents}
              isOpen={true}
              onToggle={() => setShowDebug(false)}
            />
          </div>
        )}
      </>,
      document.body
    ) : null
  }

  // Render as docked panel (right, left, bottom)
  if (!isOpen) return null

  const positionStyles: Record<Exclude<DockPosition, 'floating'>, React.CSSProperties> = {
    right: {
      position: 'fixed',
      top: 0,
      right: 0,
      bottom: 0,
      width: dockState.width,
      zIndex: 40,
    },
    left: {
      position: 'fixed',
      top: 0,
      left: 0,
      bottom: 0,
      width: dockState.width,
      zIndex: 40,
    },
    bottom: {
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: dockState.height,
      zIndex: 40,
    },
  }

  const panelPosition = dockState.position as Exclude<DockPosition, 'floating'>

  return typeof document !== 'undefined' ? createPortal(
    <div
      className={cn(
        'bg-background border shadow-xl flex flex-col',
        panelPosition === 'right' && 'border-l',
        panelPosition === 'left' && 'border-r',
        panelPosition === 'bottom' && 'border-t'
      )}
      style={positionStyles[panelPosition]}
      onKeyDown={handleInputKeyDown}
    >
      {/* Docked panel header */}
      <div className="flex items-center justify-end px-2 py-1.5 border-b shrink-0">
        <DockControls
          position={dockState.position}
          onPositionChange={setPosition}
          onMinimize={toggleMinimized}
          onClose={close}
        />
      </div>

      {!dockState.isMinimized && (
        <>
          <Command className="flex flex-col flex-1 min-h-0" shouldFilter={false}>
            <CommandHeader
              phase={phase}
              selectedTool={selectedTool}
              onBack={reset}
            />

            {phase === 'idle' && (
              <CommandInput
                value={localInput}
                onValueChange={setLocalInput}
                mode="commands"
                isLoading={isLoading}
                placeholder="Ask me anything..."
              />
            )}

            <div className="flex-1 min-h-0 overflow-y-auto">
              {phase === 'idle' && !localInput && <IdleState />}
              {phase === 'routing' && <RoutingIndicator />}
              {(phase === 'chatting' || phase === 'confirming' || phase === 'executing') && (
                <ToolChatPage
                  tool={selectedTool}
                  messages={messages}
                  pendingToolCalls={pendingToolCalls}
                  isStreaming={isStreaming}
                  isThinking={isThinking}
                  agentStatus={agentStatus}
                  onApproveToolCall={approveToolCall}
                  onRejectToolCall={rejectToolCall}
                  pendingQuestion={pendingQuestion}
                  onAnswerQuestion={answerQuestion}
                />
              )}
            </div>

            {(phase === 'chatting' || phase === 'confirming' || phase === 'executing') && (
              <form onSubmit={handleChatSubmit} className="shrink-0 border-t p-3">
                <div className="flex items-center gap-2">
                  <input
                    ref={chatInputRef}
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={handleChatKeyDown}
                    placeholder="Describe what you want to do..."
                    className={cn(
                      'flex-1 bg-muted rounded-lg px-4 py-2 text-sm outline-none',
                      'focus:ring-2 focus:ring-ring',
                      'disabled:opacity-50'
                    )}
                    disabled={isStreaming}
                  />
                  <Button
                    type={isStreaming ? 'button' : 'submit'}
                    size="icon"
                    variant={isStreaming ? 'destructive' : 'default'}
                    onClick={isStreaming ? stopExecution : undefined}
                    disabled={!isStreaming && !chatInput.trim()}
                  >
                    {isStreaming ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </form>
            )}

            <CommandFooter
              phase={phase}
              connectionStatus={connectionStatus}
              isSessionAuthorized={isSessionAuthorized}
              showDebug={showDebug}
              onToggleDebug={() => setShowDebug(!showDebug)}
            />
          </Command>
        </>
      )}

      {showDebug && (
        <div
          className={cn(
            'bg-gray-900 border-gray-700 flex flex-col overflow-hidden',
            panelPosition === 'right' && 'absolute left-0 top-0 bottom-0 w-[400px] -translate-x-full border-r',
            panelPosition === 'left' && 'absolute right-0 top-0 bottom-0 w-[400px] translate-x-full border-l',
            panelPosition === 'bottom' && 'absolute bottom-full left-0 right-0 h-[300px] border-t'
          )}
        >
          <DebugPanel
            events={debugEvents}
            onClear={clearDebugEvents}
            isOpen={true}
            onToggle={() => setShowDebug(false)}
          />
        </div>
      )}
    </div>,
    document.body
  ) : null
}
