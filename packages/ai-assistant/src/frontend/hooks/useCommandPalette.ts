'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  AgentStatus,
  CommandPaletteMode,
  CommandPalettePage,
  CommandPaletteState,
  ConnectionStatus,
  PalettePhase,
  PageContext,
  SelectedEntity,
  ToolInfo,
  ToolExecutionResult,
  PendingToolCall,
  ChatMessage,
  RouteResult,
  DebugEvent,
  DebugEventType,
  OpenCodeQuestion,
} from '../types'
import { COMMAND_PALETTE_SHORTCUT, AI_CHAT_SHORTCUT } from '../constants'
import { filterTools } from '../utils/toolMatcher'
import { useMcpTools } from './useMcpTools'
import { useRecentActions } from './useRecentActions'
import { useRecentTools } from './useRecentTools'

interface UseCommandPaletteOptions {
  pageContext: PageContext | null
  selectedEntities?: SelectedEntity[]
  disableKeyboardShortcut?: boolean
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

// Tools that are safe to auto-execute without user confirmation
const SAFE_TOOL_PATTERNS = [
  /^search_/,      // search_query, search_schema, search_get, search_aggregate, search_status
  /^get_/,         // get_ operations are read-only
  /^list_/,        // list_ operations are read-only
  /^view_/,        // view_ operations are read-only
  /^context_/,     // context_whoami etc.
  /_get$/,         // tools ending with _get
  /_list$/,        // tools ending with _list
  /_status$/,      // tools ending with _status
  /_schema$/,      // tools ending with _schema
]

// Tools that should always require confirmation
const DANGEROUS_TOOL_PATTERNS = [
  /^delete_/,
  /^remove_/,
  /_delete$/,
  /_remove$/,
  /^reindex_/,
  /_reindex$/,
]

function isToolSafeToAutoExecute(toolName: string): boolean {
  // First check if it's a dangerous tool
  if (DANGEROUS_TOOL_PATTERNS.some(p => p.test(toolName))) {
    return false
  }
  // Then check if it matches safe patterns
  return SAFE_TOOL_PATTERNS.some(p => p.test(toolName))
}

function getToolPrompt(tool: ToolInfo): string {
  const schema = tool.inputSchema
  if (!schema || typeof schema !== 'object') {
    return 'What would you like to do?'
  }

  const properties = (schema as { properties?: Record<string, unknown> }).properties
  if (!properties || Object.keys(properties).length === 0) {
    return 'This tool has no parameters. Ready to execute?'
  }

  const paramNames = Object.keys(properties).slice(0, 3)
  return `Please provide the following: ${paramNames.join(', ')}.`
}

export function useCommandPalette(options: UseCommandPaletteOptions) {
  const { pageContext, selectedEntities = [], disableKeyboardShortcut = false } = options

  // Core state with phase-based navigation for intelligent routing
  const [state, setState] = useState<CommandPaletteState>({
    isOpen: false,
    phase: 'idle',
    inputValue: '',
    selectedIndex: 0,
    isLoading: false,
    isStreaming: false,
    connectionStatus: 'disconnected',
    // Legacy fields for backwards compatibility
    page: 'home',
    mode: 'commands',
  })

  // Tool-related hooks
  const { tools, isLoading: toolsLoading, executeTool: executeToolApi } = useMcpTools()
  const { recentActions, addRecentAction } = useRecentActions()
  const { recentTools, saveRecentTool } = useRecentTools(tools)

  // Selected tool for tool-chat page
  const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null)

  // Chat state for tool-chat page
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [pendingToolCalls, setPendingToolCalls] = useState<PendingToolCall[]>([])

  // Initial context from context_whoami - fetched when palette opens
  const [initialContext, setInitialContext] = useState<{
    tenantId: string | null
    organizationId: string | null
    userId: string
    isSuperAdmin: boolean
    features: string[]
  } | null>(null)

  // Available entity types from search_schema - fetched when palette opens
  const [availableEntities, setAvailableEntities] = useState<Array<{
    entityId: string
    enabled: boolean
  }> | null>(null)

  // Debug mode state
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([])
  const [showDebug, setShowDebug] = useState(false)

  // OpenCode session state for conversation persistence
  // Use both state (for React reactivity) and ref (to avoid stale closures in callbacks)
  const [opencodeSessionId, setOpencodeSessionId] = useState<string | null>(null)
  const opencodeSessionIdRef = useRef<string | null>(null)
  const [isThinking, setIsThinking] = useState(false)
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ type: 'idle' })
  const [isSessionAuthorized, setIsSessionAuthorized] = useState(false)

  // Pending question from OpenCode requiring user confirmation
  const [pendingQuestion, setPendingQuestion] = useState<OpenCodeQuestion | null>(null)

  // Track answered question IDs to prevent re-showing them
  const answeredQuestionIds = useRef<Set<string>>(new Set())

  // Flag to indicate the next text event should start a new message (after answering question)
  const shouldStartNewMessage = useRef<boolean>(false)

  // AbortController for current streaming request - allows canceling when answering questions
  const currentStreamController = useRef<AbortController | null>(null)

  // Wrapper to update both state and ref for opencodeSessionId
  // This ensures the ref is always in sync and callbacks get the latest value
  const updateOpencodeSessionId = useCallback((id: string | null) => {
    opencodeSessionIdRef.current = id
    setOpencodeSessionId(id)
  }, [])

  // Helper to add debug events
  const addDebugEvent = useCallback((type: DebugEventType, data: unknown) => {
    // Deep clone the data to capture state at this moment (prevents mutation issues)
    const clonedData = JSON.parse(JSON.stringify(data))
    setDebugEvents((prev) => [
      ...prev.slice(-999), // Keep last 1000 events
      {
        id: generateId(),
        timestamp: new Date(),
        type,
        data: clonedData,
      },
    ])
  }, [])

  const clearDebugEvents = useCallback(() => {
    setDebugEvents([])
  }, [])

  // Update connection status when tools load
  useEffect(() => {
    if (toolsLoading) {
      setState((prev) => ({ ...prev, connectionStatus: 'connecting' }))
    } else if (tools.length > 0) {
      setState((prev) => ({ ...prev, connectionStatus: 'connected' }))
    } else {
      setState((prev) => ({ ...prev, connectionStatus: 'disconnected' }))
    }
  }, [tools, toolsLoading])

  // Fetch initial context and entity schema when palette opens and tools are available
  useEffect(() => {
    if (state.isOpen && tools.length > 0) {
      // Fetch auth context if not already loaded
      if (!initialContext) {
        console.log('[CommandPalette] Fetching initial context via context_whoami...')
        executeToolApi('context_whoami', {})
          .then((result) => {
            if (result.success && result.result) {
              console.log('[CommandPalette] Got initial context:', result.result)
              const ctx = result.result as {
                tenantId: string | null
                organizationId: string | null
                userId: string
                isSuperAdmin: boolean
                features: string[]
              }
              setInitialContext(ctx)
            }
          })
          .catch((err) => {
            console.error('[CommandPalette] Failed to fetch initial context:', err)
          })
      }

      // Fetch available entity types if not already loaded
      if (!availableEntities) {
        console.log('[CommandPalette] Fetching available entities via search_schema...')
        executeToolApi('search_schema', {})
          .then((result) => {
            if (result.success && result.result) {
              const schemaResult = result.result as { entities?: Array<{ entityId: string; enabled: boolean }> }
              console.log('[CommandPalette] Got entity schema:', schemaResult.entities?.length, 'entities')
              if (schemaResult.entities) {
                setAvailableEntities(schemaResult.entities.filter(e => e.enabled))
              }
            }
          })
          .catch((err) => {
            console.error('[CommandPalette] Failed to fetch entity schema:', err)
          })
      }
    }
  }, [state.isOpen, tools.length, initialContext, availableEntities, executeToolApi])

  // Filtered tools based on input
  const filteredTools = useMemo(() => {
    const query = state.inputValue.startsWith('/') ? state.inputValue.slice(1) : state.inputValue
    return filterTools(tools, query)
  }, [tools, state.inputValue])

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
        setState((prev) => {
          if (prev.isOpen) {
            // Closing - reset to idle
            return {
              ...prev,
              isOpen: false,
              phase: 'idle',
              inputValue: '',
              page: 'home',
              selectedIndex: 0,
              mode: 'commands',
            }
          } else {
            // Opening
            return {
              ...prev,
              isOpen: true,
            }
          }
        })
        // Reset selected tool when closing
        if (state.isOpen) {
          setSelectedTool(null)
          setMessages([])
          setPendingToolCalls([])
        }
      }

      // Open directly to AI chat mode with Cmd+J or Ctrl+J
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === AI_CHAT_SHORTCUT.key
      ) {
        event.preventDefault()
        if (state.isOpen) {
          // Already open - close it
          setState((prev) => ({
            ...prev,
            isOpen: false,
            phase: 'idle',
            inputValue: '',
            page: 'home',
            selectedIndex: 0,
            mode: 'commands',
          }))
          setSelectedTool(null)
          setMessages([])
          setPendingToolCalls([])
        } else {
          // Open directly in chatting phase
          setState((prev) => ({
            ...prev,
            isOpen: true,
            phase: 'chatting',
            page: 'tool-chat',
            inputValue: '',
            mode: 'chat',
          }))
        }
      }

      // Escape - reset or close
      if (event.key === 'Escape' && state.isOpen) {
        event.preventDefault()
        if (state.phase !== 'idle') {
          // Reset to idle
          setState((prev) => ({
            ...prev,
            phase: 'idle',
            inputValue: '',
            page: 'home',
            selectedIndex: 0,
            mode: 'commands',
          }))
          setSelectedTool(null)
          setMessages([])
          setPendingToolCalls([])
        } else {
          // Close palette
          setState((prev) => ({
            ...prev,
            isOpen: false,
            phase: 'idle',
            inputValue: '',
            page: 'home',
            selectedIndex: 0,
            mode: 'commands',
          }))
          setSelectedTool(null)
          setMessages([])
          setPendingToolCalls([])
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.isOpen, state.phase, state.inputValue, disableKeyboardShortcut])

  // Actions
  const open = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: true }))
  }, [])

  // Open directly in chat mode (for Cmd+J / header button)
  const openChat = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: true,
      phase: 'chatting',
      page: 'tool-chat',
      inputValue: '',
      mode: 'chat',
    }))
  }, [])

  const close = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
      phase: 'idle',
      inputValue: '',
      page: 'home',
      selectedIndex: 0,
      mode: 'commands',
    }))
    setSelectedTool(null)
    setMessages([])
    setPendingToolCalls([])
    updateOpencodeSessionId(null)
    setIsSessionAuthorized(false)
    setAgentStatus({ type: 'idle' })
    // Don't reset initialContext - it stays valid for the session
  }, [updateOpencodeSessionId])

  // Reset to idle state (without closing)
  const reset = useCallback(() => {
    setState((prev) => ({
      ...prev,
      phase: 'idle',
      inputValue: '',
      page: 'home',
      selectedIndex: 0,
      mode: 'commands',
    }))
    setSelectedTool(null)
    setMessages([])
    setPendingToolCalls([])
    updateOpencodeSessionId(null)
    setIsSessionAuthorized(false)
    setAgentStatus({ type: 'idle' })
  }, [updateOpencodeSessionId])

  const setIsOpen = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        open()
      } else {
        close()
      }
    },
    [open, close]
  )

  const setMode = useCallback((mode: CommandPaletteMode) => {
    setState((prev) => ({ ...prev, mode }))
  }, [])

  const setInputValue = useCallback((value: string) => {
    setState((prev) => ({ ...prev, inputValue: value, selectedIndex: 0 }))
  }, [])

  const setSelectedIndex = useCallback((index: number) => {
    setState((prev) => ({ ...prev, selectedIndex: index }))
  }, [])

  // Page navigation - go to tool chat
  const goToToolChat = useCallback(
    (tool: ToolInfo) => {
      setSelectedTool(tool)
      saveRecentTool(tool.name)

      // Create initial assistant message
      const initialMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `I'll help you with "${tool.name}". ${getToolPrompt(tool)}`,
        createdAt: new Date(),
      }
      setMessages([initialMessage])
      setPendingToolCalls([])

      setState((prev) => ({
        ...prev,
        page: 'tool-chat',
        inputValue: '',
        selectedIndex: 0,
        mode: 'chat',
      }))
    },
    [saveRecentTool]
  )

  // Page navigation - go back (legacy, kept for compatibility)
  const goBack = useCallback(() => {
    if (state.phase !== 'idle') {
      setState((prev) => ({
        ...prev,
        phase: 'idle',
        page: 'home',
        inputValue: '',
        selectedIndex: 0,
        mode: 'commands',
      }))
      setSelectedTool(null)
      setMessages([])
      setPendingToolCalls([])
    }
  }, [state.phase])

  // Route query using fast model
  const routeQuery = useCallback(
    async (query: string): Promise<RouteResult> => {
      const response = await fetch('/api/ai_assistant/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          availableTools: tools.map((t) => ({
            name: t.name,
            description: t.description,
          })),
        }),
      })

      if (!response.ok) {
        throw new Error(`Routing failed: ${response.status}`)
      }

      return response.json()
    },
    [tools]
  )

  // Start agentic chat - AI has access to all tools
  const startAgenticChat = useCallback(
    async (initialQuery: string) => {
      setState((prev) => ({
        ...prev,
        phase: 'chatting',
        page: 'tool-chat',
        inputValue: '',
        mode: 'chat',
      }))

      // Send the initial query to the chat API
      setState((prev) => ({ ...prev, isStreaming: true }))
      setAgentStatus({ type: 'thinking' })

      try {
        const userMessage: ChatMessage = {
          id: generateId(),
          role: 'user',
          content: initialQuery,
          createdAt: new Date(),
        }
        setMessages([userMessage])

        // Create abort controller for this stream
        currentStreamController.current?.abort()
        const controller = new AbortController()
        currentStreamController.current = controller

        const response = await fetch('/api/ai_assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: initialQuery }],
            context: pageContext,
            authContext: initialContext,
            availableEntities: availableEntities?.map(e => e.entityId),
            mode: 'agentic',
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error('[startAgenticChat] Error response body:', errorText)
          throw new Error(`Chat request failed: ${response.status} - ${errorText}`)
        }

        // Process the SSE stream
        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('No response body')
        }

        const decoder = new TextDecoder()
        let assistantContent = ''
        let buffer = ''
        let chunkCount = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          chunkCount++
          const rawChunk = decoder.decode(value, { stream: true })
          buffer += rawChunk

          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue

              try {
                const event = JSON.parse(data)


                // Track all events for debug panel (except question - handled separately with enriched data)
                if (event.type !== 'question') {
                  addDebugEvent(event.type as DebugEventType, event)
                }

                if (event.type === 'text') {
                  // Text received - now responding
                  setIsThinking(false)
                  setAgentStatus({ type: 'responding' })

                  // Check if we need to start a new message (e.g., after answering a question)
                  if (shouldStartNewMessage.current) {
                    shouldStartNewMessage.current = false
                    // Finalize the current streaming message and reset content
                    setMessages((prev) => prev.map((m) => (m.id === 'streaming' ? { ...m, id: generateId() } : m)))
                    assistantContent = '' // Reset for new message
                  }

                  assistantContent += event.content || ''
                  setMessages((prev) => {
                    const existingAssistant = prev.find((m) => m.id === 'streaming')
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
                } else if (event.type === 'tool-call') {
                  // Tool calls are executed SERVER-SIDE via the AI SDK's maxSteps feature
                  const toolName = event.toolName as string
                  const toolArgs = event.args ?? {}

                  // Update status to show the tool being used
                  setAgentStatus({ type: 'tool', toolName })

                  // For dangerous tools, show a confirmation indicator
                  if (!isToolSafeToAutoExecute(toolName)) {
                    // Note: Server already executed this - just show visual feedback
                    setPendingToolCalls((prev) => [
                      ...prev,
                      {
                        id: event.id,
                        toolName: toolName,
                        args: toolArgs,
                        status: 'completed' as const, // Already executed server-side
                      },
                    ])
                  }
                  // Safe tools: no action needed, server handled execution and AI interprets results
                } else if (event.type === 'debug') {
                  // Handle debug events for agent status updates
                  const debugEvent = event as { partType?: string; data?: Record<string, unknown> }

                  // Handle step-start: indicates tool execution beginning
                  if (debugEvent.partType === 'step-start') {
                    setAgentStatus({ type: 'executing' })
                  }
                  // Handle step-finish: tools completed
                  if (debugEvent.partType === 'step-finish' && debugEvent.data?.reason === 'tool-calls') {
                    // Tools finished, back to thinking for next step
                    setAgentStatus({ type: 'thinking' })
                  }
                } else if (event.type === 'error') {
                  console.error('[startAgenticChat] Error event:', event.error)
                  setAgentStatus({ type: 'idle' })
                } else if (event.type === 'done') {
                  setIsThinking(false)
                  setAgentStatus({ type: 'idle' })
                  setState((prev) => ({ ...prev, isStreaming: false }))
                  // Save session ID for conversation continuity
                  if (event.sessionId) {
                    updateOpencodeSessionId(event.sessionId)
                  }
                } else if (event.type === 'question') {
                  // OpenCode is asking for confirmation
                  const question = event.question as OpenCodeQuestion
                  // Skip if already answered
                  if (answeredQuestionIds.current.has(question.id)) {
                    // Already answered
                  } else {
                    setIsThinking(false)
                    setAgentStatus({ type: 'idle' })
                    setState((prev) => ({ ...prev, isStreaming: false }))
                    setPendingQuestion(question)
                    // Save session ID for conversation continuity
                    if (question.sessionID) {
                      updateOpencodeSessionId(question.sessionID)
                    }
                    // Add enriched debug event with question details visible at top level
                    addDebugEvent('question', {
                      type: 'question',
                      questionId: question.id,
                      sessionID: question.sessionID,
                      questionText: question.questions?.[0]?.question || 'No question text',
                      header: question.questions?.[0]?.header || 'Confirmation',
                      options: question.questions?.[0]?.options?.map(o => o.label) || [],
                      fullQuestion: question,
                    })
                  }
                } else if (event.type === 'session-authorized') {
                  // Session has been authorized with ephemeral API key
                  setIsSessionAuthorized(true)
                }
              } catch (parseError) {
                console.warn('[startAgenticChat] Failed to parse event:', data, parseError)
              }
            }
          }
        }

        // Finalize the assistant message
        setMessages((prev) => prev.map((m) => (m.id === 'streaming' ? { ...m, id: generateId() } : m)))
      } catch (error) {
        // Ignore AbortError - this happens when we intentionally cancel the stream
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        console.error('[startAgenticChat] Error:', error)
        setAgentStatus({ type: 'idle' })
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant',
            content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            createdAt: new Date(),
          },
        ])
      } finally {
        setState((prev) => ({ ...prev, isStreaming: false }))
        setAgentStatus({ type: 'idle' })
      }
    },
    [pageContext, initialContext, availableEntities, executeToolApi, addDebugEvent, updateOpencodeSessionId]
  )

  // Start general chat (no specific tool)
  const startGeneralChat = useCallback(
    async (initialQuery: string) => {
      setState((prev) => ({
        ...prev,
        phase: 'chatting',
        page: 'tool-chat',
        inputValue: '',
        mode: 'chat',
      }))

      setState((prev) => ({ ...prev, isStreaming: true }))

      try {
        const userMessage: ChatMessage = {
          id: generateId(),
          role: 'user',
          content: initialQuery,
          createdAt: new Date(),
        }
        setMessages([userMessage])

        const response = await fetch('/api/ai_assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: initialQuery }],
            context: pageContext,
            authContext: initialContext,
            availableEntities: availableEntities?.map(e => e.entityId),
            mode: 'default',
          }),
        })

        if (!response.ok) {
          throw new Error(`Chat request failed: ${response.status}`)
        }

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

          setMessages((prev) => {
            const existingAssistant = prev.find((m) => m.id === 'streaming')
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

        setMessages((prev) => prev.map((m) => (m.id === 'streaming' ? { ...m, id: generateId() } : m)))
      } catch (error) {
        console.error('General chat error:', error)
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
    [pageContext, initialContext, availableEntities]
  )

  // Execute tool directly
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

  // Approve a pending tool call
  const approveToolCall = useCallback(
    async (toolCallId: string) => {
      const toolCall = pendingToolCalls.find((tc) => tc.id === toolCallId)
      if (!toolCall) return

      // Update status to executing
      setPendingToolCalls((prev) =>
        prev.map((tc) => (tc.id === toolCallId ? { ...tc, status: 'executing' as const } : tc))
      )

      try {
        // Execute the tool
        const result = await executeToolApi(toolCall.toolName, toolCall.args)

        // Update tool call with result
        setPendingToolCalls((prev) =>
          prev.map((tc) =>
            tc.id === toolCallId
              ? {
                  ...tc,
                  status: result.success ? ('completed' as const) : ('error' as const),
                  result: result.result,
                  error: result.error,
                }
              : tc
          )
        )

        // Add to recent actions on success, show error on failure
        // Don't add raw JSON - the AI will provide human-friendly interpretation
        if (result.success) {
          const tool = tools.find((t) => t.name === toolCall.toolName)
          addRecentAction({
            toolName: toolCall.toolName,
            displayName: tool?.description || toolCall.toolName,
            args: toolCall.args,
          })
          // Add a brief success indicator (optional - AI can interpret the result)
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant' as const,
              content: `Done! The ${toolCall.toolName.replace(/_/g, ' ')} operation completed successfully.`,
              createdAt: new Date(),
            },
          ])
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant' as const,
              content: `I encountered an issue: ${result.error || 'Unknown error'}`,
              createdAt: new Date(),
            },
          ])
        }
      } catch (error) {
        setPendingToolCalls((prev) =>
          prev.map((tc) =>
            tc.id === toolCallId
              ? {
                  ...tc,
                  status: 'error' as const,
                  error: error instanceof Error ? error.message : 'Unknown error',
                }
              : tc
          )
        )
      }
    },
    [pendingToolCalls, executeToolApi, tools, addRecentAction]
  )

  // Reject a pending tool call
  const rejectToolCall = useCallback((toolCallId: string) => {
    setPendingToolCalls((prev) =>
      prev.map((tc) => (tc.id === toolCallId ? { ...tc, status: 'rejected' as const } : tc))
    )

    setMessages((prev) => [
      ...prev,
      {
        id: generateId(),
        role: 'assistant' as const,
        content: 'Tool call cancelled. How else can I help?',
        createdAt: new Date(),
      },
    ])
  }, [])

  // Send message in agentic chat (via OpenCode agent)
  const sendAgenticMessage = useCallback(
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
      setIsThinking(true)
      setAgentStatus({ type: 'thinking' })

      try {
        // Send to chat API with OpenCode session for context persistence
        const response = await fetch('/api/ai_assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [...messages, userMessage].map((m) => ({
              role: m.role,
              content: m.content,
            })),
            sessionId: opencodeSessionIdRef.current,
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
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // Process SSE events
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue

              try {
                const event = JSON.parse(data)


                // Track all events for debug panel (except question - handled separately with enriched data)
                if (event.type !== 'question') {
                  addDebugEvent(event.type as DebugEventType, event)
                }

                if (event.type === 'thinking') {
                  // OpenCode is processing - keep thinking state active
                  setIsThinking(true)
                  setAgentStatus({ type: 'thinking' })
                } else if (event.type === 'session-authorized') {
                  // Session has been authorized with ephemeral API key
                  setIsSessionAuthorized(true)
                } else if (event.type === 'text') {
                  // Check if we need to start a new message (e.g., after answering a question)
                  if (shouldStartNewMessage.current) {
                    shouldStartNewMessage.current = false
                    // Finalize the current streaming message and reset content
                    setMessages((prev) => prev.map((m) => (m.id === 'streaming' ? { ...m, id: generateId() } : m)))
                    assistantContent = '' // Reset for new message
                  }

                  // Text received - now responding
                  setIsThinking(false)
                  setAgentStatus({ type: 'responding' })
                  assistantContent += event.content || ''
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
                } else if (event.type === 'done') {
                  // Stream complete - save session ID for conversation persistence
                  setIsThinking(false)
                  setAgentStatus({ type: 'idle' })
                  setState((prev) => ({ ...prev, isStreaming: false }))
                  if (event.sessionId) {
                    updateOpencodeSessionId(event.sessionId)
                  }
                } else if (event.type === 'error') {
                  // Handle error event
                  setIsThinking(false)
                  setAgentStatus({ type: 'idle' })
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: generateId(),
                      role: 'assistant' as const,
                      content: `Error: ${event.error || 'Unknown error occurred'}`,
                      createdAt: new Date(),
                    },
                  ])
                } else if (event.type === 'tool-call') {
                  // Tool calls are executed SERVER-SIDE via the AI SDK's maxSteps feature
                  const toolName = event.toolName as string
                  const toolArgs = event.args ?? {}

                  // Update status to show the tool being used
                  setAgentStatus({ type: 'tool', toolName })

                  // For dangerous tools, show visual feedback (server already executed)
                  if (!isToolSafeToAutoExecute(toolName)) {
                    setPendingToolCalls((prev) => [
                      ...prev,
                      { id: event.id, toolName, args: toolArgs, status: 'completed' as const },
                    ])
                  }
                  // Safe tools: no action needed, server handled execution
                } else if (event.type === 'question') {
                  // OpenCode is asking for confirmation
                  const question = event.question as OpenCodeQuestion
                  // Skip if already answered
                  if (answeredQuestionIds.current.has(question.id)) {
                    // Already answered
                  } else {
                    setIsThinking(false)
                    setAgentStatus({ type: 'idle' })
                    setState((prev) => ({ ...prev, isStreaming: false }))
                    setPendingQuestion(question)
                    // Add enriched debug event with question details visible at top level
                    addDebugEvent('question', {
                      type: 'question',
                      questionId: question.id,
                      sessionID: question.sessionID,
                      questionText: question.questions?.[0]?.question || 'No question text',
                      header: question.questions?.[0]?.header || 'Confirmation',
                      options: question.questions?.[0]?.options?.map(o => o.label) || [],
                      fullQuestion: question,
                    })
                  }
                } else if (event.type === 'debug') {
                  // Handle debug events for agent status updates
                  const debugEvent = event as { partType?: string; data?: Record<string, unknown> }

                  // Handle step-start: indicates tool execution beginning
                  if (debugEvent.partType === 'step-start') {
                    setAgentStatus({ type: 'executing' })
                  }
                  // Handle step-finish: tools completed
                  if (debugEvent.partType === 'step-finish' && debugEvent.data?.reason === 'tool-calls') {
                    // Tools finished, back to thinking for next step
                    setAgentStatus({ type: 'thinking' })
                  }
                }
              } catch {
                // Plain text chunk (fallback for non-SSE responses)
                assistantContent += data
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
            } else if (line.trim() && !line.startsWith(':')) {
              // Plain text (not SSE format)
              assistantContent += line
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
          }
        }

        // Finalize the assistant message
        setMessages((prev) => prev.map((m) => (m.id === 'streaming' ? { ...m, id: generateId() } : m)))
      } catch (error) {
        console.error('Tool chat error:', error)
        setAgentStatus({ type: 'idle' })
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
        setIsThinking(false)
        setAgentStatus({ type: 'idle' })
      }
    },
    [messages, addDebugEvent, updateOpencodeSessionId]
  )

  // Main submit handler - starts agentic chat or continues existing session
  const handleSubmit = useCallback(
    async (query: string) => {
      if (!query.trim()) return

      // If we have an existing session, continue the conversation
      // Use ref to get latest value (avoids stale closure issues)
      if (opencodeSessionIdRef.current) {
        await sendAgenticMessage(query)
      } else {
        // Start new agentic session where AI has access to all tools
        await startAgenticChat(query)
      }
    },
    [startAgenticChat, sendAgenticMessage]
  )

  // Answer a pending OpenCode question
  // The original SSE stream continues running and will receive the follow-up response
  const answerQuestion = useCallback(
    async (answer: number) => {
      if (!pendingQuestion) return

      // Mark question as answered BEFORE sending - prevents duplicate display
      const questionId = pendingQuestion.id
      answeredQuestionIds.current.add(questionId)

      // Signal that the next text event should start a NEW message (not update the old one)
      shouldStartNewMessage.current = true

      // Clear the pending question UI and show thinking state
      setPendingQuestion(null)
      setIsThinking(true)
      setAgentStatus({ type: 'thinking' })

      // Add visual feedback of the answer
      const selectedOption = pendingQuestion.questions[0]?.options[answer]
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: 'user' as const,
          content: `[Confirmed: ${selectedOption?.label || 'Yes'}]`,
          createdAt: new Date(),
        },
      ])

      try {
        // Send answer as simple POST - the original SSE stream will receive the follow-up
        const sessionId = pendingQuestion.sessionID
        const response = await fetch('/api/ai_assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answerQuestion: {
              questionId,
              answer,
              sessionId,
            },
          }),
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Answer request failed: ${response.status}`)
        }

        // Answer sent successfully - the original stream will handle the response
        // Note: isThinking stays true until the original stream sends 'done' or more 'text'
      } catch (error) {
        console.error('[answerQuestion] Error:', error)
        setIsThinking(false)
        setAgentStatus({ type: 'idle' })
        setMessages((prev) => [
          ...prev,
          {
            id: generateId(),
            role: 'assistant' as const,
            content: `Error: ${error instanceof Error ? error.message : 'Failed to send answer'}`,
            createdAt: new Date(),
          },
        ])
      }
    },
    [pendingQuestion]
  )

  // Legacy sendMessage function (for backwards compatibility)
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
        const response = await fetch('/api/ai_assistant/chat', {
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
        setMessages((prev) => prev.map((m) => (m.id === 'streaming' ? { ...m, id: generateId() } : m)))
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
    isThinking,
    agentStatus,
    isSessionAuthorized,
    pageContext,
    selectedEntities,
    tools,
    filteredTools,
    recentActions,
    recentTools,
    messages,
    pendingToolCalls,
    selectedTool,
    initialContext,
    availableEntities,

    // Navigation actions
    open,
    openChat,
    close,
    setIsOpen,
    setInputValue,
    setSelectedIndex,

    // Intelligent routing - submit natural language query
    handleSubmit,
    reset,

    // Page navigation (legacy, kept for compatibility)
    goToToolChat,
    goBack,

    // Tool execution
    executeTool,
    approveToolCall,
    rejectToolCall,

    // Chat actions
    sendMessage,
    sendAgenticMessage,
    clearMessages,

    // Legacy compatibility
    setMode,

    // Debug mode
    debugEvents,
    showDebug,
    setShowDebug,
    clearDebugEvents,

    // OpenCode question handling
    pendingQuestion,
    answerQuestion,
  }
}
