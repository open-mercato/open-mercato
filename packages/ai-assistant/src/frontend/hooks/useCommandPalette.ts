'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import type { CommandPaletteMode, CommandPaletteState, PageContext, SelectedEntity, ToolInfo, ToolExecutionResult, ToolCall, ChatMessage } from '../types'
import { COMMAND_PALETTE_SHORTCUT, NATURAL_LANGUAGE_PATTERNS } from '../constants'
import { filterTools } from '../utils/toolMatcher'
import { useMcpTools } from './useMcpTools'
import { useRecentActions } from './useRecentActions'

interface UseCommandPaletteOptions {
  pageContext: PageContext | null
  selectedEntities?: SelectedEntity[]
  disableKeyboardShortcut?: boolean
}

function determineMode(input: string, currentMode: CommandPaletteMode): CommandPaletteMode {
  const trimmed = input.trim()

  // Empty input stays in commands mode
  if (!trimmed) return 'commands'

  // Explicit command prefix (slash commands)
  if (trimmed.startsWith('/')) return 'commands'

  // Check for natural language patterns
  for (const pattern of NATURAL_LANGUAGE_PATTERNS) {
    if (pattern.test(trimmed)) return 'chat'
  }

  // If already in chat mode and continuing to type, stay in chat
  if (currentMode === 'chat' && trimmed.length > 15) return 'chat'

  return 'commands'
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export function useCommandPalette(options: UseCommandPaletteOptions) {
  const { pageContext, selectedEntities = [], disableKeyboardShortcut = false } = options

  // Core state
  const [state, setState] = useState<CommandPaletteState>({
    isOpen: false,
    mode: 'commands',
    inputValue: '',
    selectedIndex: 0,
    isLoading: false,
    isStreaming: false,
  })

  // Tool-related hooks
  const { tools, isLoading: toolsLoading, executeTool: executeToolApi } = useMcpTools()
  const { recentActions, addRecentAction } = useRecentActions()

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pendingToolCalls, setPendingToolCalls] = useState<ToolCall[]>([])

  // Filtered tools based on input
  const filteredTools = useMemo(() => {
    const query = state.inputValue.startsWith('/') ? state.inputValue.slice(1) : state.inputValue
    return filterTools(tools, query)
  }, [tools, state.inputValue])

  // Update mode when input changes
  useEffect(() => {
    const newMode = determineMode(state.inputValue, state.mode)
    if (newMode !== state.mode) {
      setState((prev) => ({ ...prev, mode: newMode }))
    }
  }, [state.inputValue, state.mode])

  // Keyboard shortcut handler
  useEffect(() => {
    if (disableKeyboardShortcut) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Open/close with Cmd+K or Ctrl+K
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === COMMAND_PALETTE_SHORTCUT.key
      ) {
        event.preventDefault()
        setState((prev) => ({
          ...prev,
          isOpen: !prev.isOpen,
          inputValue: prev.isOpen ? '' : prev.inputValue,
          mode: prev.isOpen ? 'commands' : prev.mode,
          selectedIndex: 0,
        }))
      }

      // Close with Escape
      if (event.key === 'Escape' && state.isOpen) {
        event.preventDefault()
        setState((prev) => ({
          ...prev,
          isOpen: false,
          inputValue: '',
          mode: 'commands',
          selectedIndex: 0,
        }))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.isOpen, disableKeyboardShortcut])

  // Actions
  const open = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: true }))
  }, [])

  const close = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
      inputValue: '',
      mode: 'commands',
      selectedIndex: 0,
    }))
  }, [])

  const setIsOpen = useCallback((isOpen: boolean) => {
    if (isOpen) {
      open()
    } else {
      close()
    }
  }, [open, close])

  const setMode = useCallback((mode: CommandPaletteMode) => {
    setState((prev) => ({ ...prev, mode }))
  }, [])

  const setInputValue = useCallback((value: string) => {
    setState((prev) => ({ ...prev, inputValue: value, selectedIndex: 0 }))
  }, [])

  const setSelectedIndex = useCallback((index: number) => {
    setState((prev) => ({ ...prev, selectedIndex: index }))
  }, [])

  const executeTool = useCallback(
    async (toolName: string, args: Record<string, unknown> = {}): Promise<ToolExecutionResult> => {
      setState((prev) => ({ ...prev, isLoading: true }))

      try {
        const result = await executeToolApi(toolName, args)

        if (result.success) {
          // Add to recent actions
          const tool = tools.find((t) => t.name === toolName)
          addRecentAction({
            toolName,
            displayName: tool?.description || toolName,
            args,
          })
        }

        return result
      } finally {
        setState((prev) => ({ ...prev, isLoading: false }))
      }
    },
    [executeToolApi, tools, addRecentAction]
  )

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return

      // Add user message
      const userMessage: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: content.trim(),
        createdAt: new Date(),
      }
      setMessages((prev) => [...prev, userMessage])
      setState((prev) => ({ ...prev, isStreaming: true }))

      try {
        // Send to chat API
        const response = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [...messages, userMessage].map((m) => ({
              role: m.role,
              content: m.content,
            })),
            context: pageContext,
          }),
        })

        if (!response.ok) {
          throw new Error(`Chat request failed: ${response.status}`)
        }

        // Read the streaming response
        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('No response body')
        }

        const decoder = new TextDecoder()
        let assistantContent = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          assistantContent += chunk

          // Update assistant message in real-time
          setMessages((prev) => {
            const existingAssistant = prev.find(
              (m) => m.role === 'assistant' && m.id === 'streaming'
            )
            if (existingAssistant) {
              return prev.map((m) =>
                m.id === 'streaming' ? { ...m, content: assistantContent } : m
              )
            } else {
              return [
                ...prev,
                {
                  id: 'streaming',
                  role: 'assistant' as const,
                  content: assistantContent,
                  createdAt: new Date(),
                },
              ]
            }
          })
        }

        // Finalize the assistant message
        setMessages((prev) =>
          prev.map((m) =>
            m.id === 'streaming' ? { ...m, id: generateId() } : m
          )
        )
      } catch (error) {
        console.error('Chat error:', error)
        // Add error message
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content: 'Sorry, I encountered an error. Please try again.',
            createdAt: new Date(),
          },
        ])
      } finally {
        setState((prev) => ({ ...prev, isStreaming: false }))
      }
    },
    [messages, pageContext]
  )

  const clearMessages = useCallback(() => {
    setMessages([])
    setPendingToolCalls([])
  }, [])

  return {
    // State
    state: {
      ...state,
      isLoading: state.isLoading || toolsLoading,
    },
    pageContext,
    selectedEntities,
    tools,
    filteredTools,
    recentActions,
    messages,
    pendingToolCalls,

    // Actions
    open,
    close,
    setIsOpen,
    setMode,
    setInputValue,
    setSelectedIndex,
    executeTool,
    sendMessage,
    clearMessages,
  }
}
