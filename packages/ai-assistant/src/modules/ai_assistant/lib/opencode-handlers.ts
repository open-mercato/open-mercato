/**
 * OpenCode API Route Handlers
 *
 * These handlers can be used by Next.js API routes to interact with OpenCode.
 */

import {
  createOpenCodeClient,
  type OpenCodeClient,
  type OpenCodeQuestion,
} from './opencode-client'

let clientInstance: OpenCodeClient | null = null

function getClient(): OpenCodeClient {
  if (!clientInstance) {
    clientInstance = createOpenCodeClient()
  }
  return clientInstance
}

export type OpenCodeTestRequest = {
  message: string
  sessionId?: string
  model?: {
    providerID: string
    modelID: string
  }
}

export type OpenCodeTestResponse = {
  sessionId: string
  result: unknown
}

export type OpenCodeHealthResponse = {
  status: 'ok' | 'error'
  opencode?: {
    healthy: boolean
    version: string
  }
  mcp?: Record<string, { status: string; error?: string }>
  url: string
  message?: string
}

/**
 * Handle POST request to send a message to OpenCode.
 */
export async function handleOpenCodeMessage(
  request: OpenCodeTestRequest
): Promise<OpenCodeTestResponse> {
  const client = getClient()

  const { message, sessionId, model } = request

  if (!message) {
    throw new Error('Message is required')
  }

  // Create or get session
  let session
  if (sessionId) {
    session = await client.getSession(sessionId)
  } else {
    session = await client.createSession()
  }

  // Send message
  const result = await client.sendMessage(session.id, message, { model })

  return {
    sessionId: session.id,
    result,
  }
}

/**
 * Handle GET request to check OpenCode health.
 */
export async function handleOpenCodeHealth(): Promise<OpenCodeHealthResponse> {
  const client = getClient()
  const url = process.env.OPENCODE_URL ?? 'http://localhost:4096'

  try {
    const [health, mcp] = await Promise.all([client.health(), client.mcpStatus()])

    return {
      status: 'ok',
      opencode: health,
      mcp,
      url,
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'OpenCode not reachable',
      url,
    }
  }
}

/**
 * Extract text content from OpenCode message response.
 */
export function extractTextFromResponse(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null

  const message = result as { parts?: Array<{ type: string; text?: string }> }
  if (!message.parts) return null

  const textParts = message.parts.filter((p) => p.type === 'text' && p.text)
  return textParts.map((p) => p.text).join('\n') || null
}

/**
 * Response part from OpenCode - can be text, tool-call, tool-result, etc.
 */
export interface OpenCodeResponsePart {
  id: string
  type: string
  text?: string
  // Tool call fields (OpenCode uses 'tool_use' type)
  name?: string
  input?: unknown
  // Tool result fields (OpenCode uses 'tool_result' type)
  tool_use_id?: string
  content?: unknown
  // Step fields (step-start, step-finish)
  sessionID?: string
  messageID?: string
  reason?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  }
  // Generic catch-all
  [key: string]: unknown
}

/**
 * Metadata about the OpenCode response.
 */
export interface OpenCodeResponseMetadata {
  modelID?: string
  providerID?: string
  tokens?: { input: number; output: number }
  timing?: { created: number; completed?: number }
}

/**
 * Extract all parts from OpenCode response for verbose debugging.
 */
export function extractAllPartsFromResponse(result: unknown): OpenCodeResponsePart[] {
  if (!result || typeof result !== 'object') return []

  const message = result as { parts?: OpenCodeResponsePart[] }
  return message.parts || []
}

/**
 * Extract metadata (model, tokens, timing) from OpenCode response.
 */
export function extractMetadataFromResponse(result: unknown): OpenCodeResponseMetadata | null {
  if (!result || typeof result !== 'object') return null

  const message = result as {
    info?: {
      modelID?: string
      providerID?: string
      tokens?: { input: number; output: number }
      time?: { created: number; completed?: number }
    }
  }

  if (!message.info) return null

  return {
    modelID: message.info.modelID,
    providerID: message.info.providerID,
    tokens: message.info.tokens,
    timing: message.info.time,
  }
}

/**
 * Event types emitted during streaming message handling.
 */
export type OpenCodeStreamEvent =
  | { type: 'thinking' }
  | { type: 'text'; content: string }
  | { type: 'tool-call'; id: string; toolName: string; args: unknown }
  | { type: 'tool-result'; id: string; result: unknown }
  | { type: 'question'; question: OpenCodeQuestion }
  | { type: 'metadata'; model?: string; provider?: string; tokens?: { input: number; output: number }; durationMs?: number }
  | { type: 'debug'; partType: string; data: unknown }
  | { type: 'done'; sessionId: string }
  | { type: 'error'; error: string }

/**
 * Handle OpenCode message with real-time SSE streaming.
 * Uses OpenCode's /event SSE endpoint for live updates.
 *
 * OpenCode does agentic loops - it may generate multiple assistant messages
 * with tool calls in between. We complete only when the session becomes "idle"
 * after being "busy", indicating the full agentic loop is done.
 */
export async function handleOpenCodeMessageStreaming(
  request: OpenCodeTestRequest,
  onEvent: (event: OpenCodeStreamEvent) => Promise<void>
): Promise<void> {
  const client = getClient()
  const { message, sessionId, model } = request
  const startTime = Date.now()

  if (!message) {
    await onEvent({ type: 'error', error: 'Message is required' })
    return
  }

  try {
    // Create or get session
    let session
    if (sessionId) {
      session = await client.getSession(sessionId)
    } else {
      session = await client.createSession()
    }

    const targetSessionId = session.id
    let unsubscribe: (() => void) | null = null
    let emittedThinking = false
    let wasBusy = false // Track if session was ever busy
    let lastMetadata: {
      model?: string
      provider?: string
      tokens?: { input: number; output: number }
    } | null = null

    // Set up SSE subscription for real-time events
    const eventPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe?.()
        reject(new Error('OpenCode request timed out'))
      }, 300000) // 5 minute timeout for complex agentic tasks

      unsubscribe = client.subscribeToEvents(
        async (sseEvent) => {
          try {
            const { type, properties } = sseEvent

            // Filter events for our session
            const eventSessionId =
              (properties.sessionID as string) ||
              (properties.info as { sessionID?: string })?.sessionID ||
              (properties.part as { sessionID?: string })?.sessionID

            if (eventSessionId && eventSessionId !== targetSessionId) {
              return // Ignore events from other sessions
            }

            switch (type) {
              case 'session.status': {
                const status = properties.status as { type: string }

                if (status?.type === 'busy') {
                  wasBusy = true
                  if (!emittedThinking) {
                    emittedThinking = true
                    await onEvent({ type: 'thinking' })
                  }
                } else if (status?.type === 'idle' && wasBusy) {
                  // Session went from busy to idle - agentic loop is complete
                  const endTime = Date.now()

                  // Emit final metadata if we have it
                  if (lastMetadata) {
                    await onEvent({
                      type: 'metadata',
                      model: lastMetadata.model,
                      provider: lastMetadata.provider,
                      tokens: lastMetadata.tokens,
                      durationMs: endTime - startTime,
                    })
                  }

                  // Check for pending questions before declaring done
                  const questions = await client.getPendingQuestions()
                  const sessionQuestion = questions.find((q) => q.sessionID === targetSessionId)

                  if (sessionQuestion) {
                    await onEvent({ type: 'question', question: sessionQuestion })
                  } else {
                    await onEvent({ type: 'done', sessionId: targetSessionId })
                  }

                  clearTimeout(timeout)
                  unsubscribe?.()
                  resolve()
                }
                break
              }

              case 'message.updated': {
                const info = properties.info as {
                  id: string
                  role: string
                  time?: { completed?: number }
                  modelID?: string
                  providerID?: string
                  tokens?: { input: number; output: number }
                  error?: { name: string; message?: string }
                }

                if (info.role === 'assistant') {
                  // Check for error
                  if (info.error) {
                    clearTimeout(timeout)
                    unsubscribe?.()
                    await onEvent({
                      type: 'error',
                      error: `${info.error.name}: ${info.error.message || 'Unknown error'}`,
                    })
                    resolve()
                    return
                  }

                  // Track metadata from completed messages (but don't resolve yet)
                  if (info.time?.completed) {
                    lastMetadata = {
                      model: info.modelID,
                      provider: info.providerID,
                      tokens: info.tokens,
                    }
                    // Emit intermediate metadata for visibility
                    await onEvent({
                      type: 'debug',
                      partType: 'message-completed',
                      data: { messageId: info.id, tokens: info.tokens },
                    })
                  }
                }
                break
              }

              case 'message.part.updated': {
                const part = properties.part as {
                  type: string
                  text?: string
                  name?: string
                  input?: unknown
                  tool_use_id?: string
                  content?: unknown
                  id: string
                }
                const delta = properties.delta as string | undefined

                switch (part.type) {
                  case 'text':
                    // Use delta for streaming text if available
                    if (delta) {
                      await onEvent({ type: 'text', content: delta })
                    }
                    break
                  case 'tool_use':
                    if (part.name) {
                      await onEvent({
                        type: 'tool-call',
                        id: part.id,
                        toolName: part.name,
                        args: part.input,
                      })
                    }
                    break
                  case 'tool_result':
                    await onEvent({
                      type: 'tool-result',
                      id: part.tool_use_id || part.id,
                      result: part.content,
                    })
                    break
                  case 'step-start':
                  case 'step-finish':
                    await onEvent({ type: 'debug', partType: part.type, data: part })
                    break
                }
                break
              }
            }
          } catch (err) {
            console.error('[OpenCode SSE] Error processing event:', err)
          }
        },
        (error) => {
          clearTimeout(timeout)
          reject(error)
        }
      )
    })

    // Send message (don't await - let SSE handle the response)
    const sendPromise = client.sendMessage(session.id, message, { model })

    // Wait for either SSE completion or send error
    await Promise.race([eventPromise, sendPromise.catch((err) => Promise.reject(err))])
  } catch (error) {
    await onEvent({
      type: 'error',
      error: error instanceof Error ? error.message : 'OpenCode request failed',
    })
  }
}

/**
 * Answer a pending question and continue processing.
 */
export async function handleOpenCodeAnswer(
  questionId: string,
  answer: number,
  onEvent: (event: OpenCodeStreamEvent) => Promise<void>
): Promise<void> {
  const client = getClient()

  try {
    // Answer the question
    await client.answerQuestion(questionId, answer)

    // Wait a bit for processing to continue
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Poll for the result or next question
    const questions = await client.getPendingQuestions()
    const nextQuestion = questions.find((q) => q.id !== questionId)

    if (nextQuestion) {
      // Another question came up
      await onEvent({ type: 'question', question: nextQuestion })
      return
    }

    // No more questions - processing should be complete
    // The result will be in the session messages
    await onEvent({ type: 'done', sessionId: '' })
  } catch (error) {
    await onEvent({
      type: 'error',
      error: error instanceof Error ? error.message : 'Failed to answer question',
    })
  }
}

/**
 * Get pending questions for a session.
 */
export async function getPendingQuestions(): Promise<OpenCodeQuestion[]> {
  const client = getClient()
  return client.getPendingQuestions()
}

// Re-export the question type
export type { OpenCodeQuestion }
