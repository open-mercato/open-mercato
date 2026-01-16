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
    let resolved = false // Track if we've already completed
    let lastActivityTime = Date.now() // Track last event for heartbeat
    let heartbeatInterval: NodeJS.Timeout | null = null
    let lastMetadata: {
      model?: string
      provider?: string
      tokens?: { input: number; output: number }
    } | null = null

    // Helper to clean up resources
    const cleanup = () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval)
        heartbeatInterval = null
      }
    }

    // Set up SSE subscription for real-time events
    const eventPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        unsubscribe?.()
        reject(new Error('OpenCode request timed out'))
      }, 300000) // 5 minute timeout for complex agentic tasks

      // Heartbeat: Check every second for completion conditions
      heartbeatInterval = setInterval(async () => {
        if (resolved) return

        const idleTime = Date.now() - lastActivityTime

        // If no activity for 5 seconds and we were busy, check session status
        if (idleTime >= 5000 && wasBusy && !resolved) {
          try {
            // Check actual session status before completing
            const status = await client.getSessionStatus(targetSessionId)
            console.log('[OpenCode SSE] Heartbeat: idle for', Math.round(idleTime / 1000), 's, session status:', status.status)

            if (status.status === 'busy') {
              // Session is still busy - don't complete, just log and wait
              console.log('[OpenCode SSE] Heartbeat: Session still busy, waiting...')
              return
            }

            if (status.status === 'waiting' && status.questionId) {
              // Session is waiting for a question answer
              const questions = await client.getPendingQuestions()
              const sessionQuestion = questions.find((q) => q.id === status.questionId)
              if (sessionQuestion) {
                console.log('[OpenCode SSE] Heartbeat: Found pending question:', status.questionId)
                await onEvent({ type: 'question', question: sessionQuestion })
                lastActivityTime = Date.now() // Reset timer after emitting question
                return
              }
            }

            // Check for any pending questions for this session
            const questions = await client.getPendingQuestions()
            const sessionQuestion = questions.find((q) => q.sessionID === targetSessionId)

            if (sessionQuestion) {
              console.log('[OpenCode SSE] Heartbeat: Found pending question for session')
              await onEvent({ type: 'question', question: sessionQuestion })
              lastActivityTime = Date.now() // Reset timer after emitting question
            } else if (status.status === 'idle') {
              // Session is explicitly idle and no questions - complete
              console.log('[OpenCode SSE] Heartbeat: Session idle, no questions - completing')
              resolved = true
              await onEvent({ type: 'done', sessionId: targetSessionId })
              cleanup()
              clearTimeout(timeout)
              unsubscribe?.()
              resolve()
            } else {
              // Status is 'unknown' or something else - we can't determine if done
              // Wait for SSE events to tell us the actual state
              console.log('[OpenCode SSE] Heartbeat: Status unknown, waiting for SSE events...')
            }
          } catch (err) {
            console.error('[OpenCode SSE] Heartbeat error:', err)
          }
        }
      }, 1000)

      unsubscribe = client.subscribeToEvents(
        async (sseEvent) => {
          try {
            const { type, properties } = sseEvent

            // Update activity timestamp for heartbeat
            lastActivityTime = Date.now()

            // Log question events before filtering
            if (type === 'question.asked') {
              console.log('[OpenCode SSE] Received question.asked event (before filter):', JSON.stringify(properties))
            }

            // Filter events for our session
            const eventSessionId =
              (properties.sessionID as string) ||
              (properties.info as { sessionID?: string })?.sessionID ||
              (properties.part as { sessionID?: string })?.sessionID ||
              (properties.question as { sessionID?: string })?.sessionID ||
              (properties.session as { id?: string })?.id ||
              (properties.status as { sessionID?: string })?.sessionID

            if (eventSessionId && eventSessionId !== targetSessionId) {
              if (type === 'question.asked') {
                console.log('[OpenCode SSE] Question event filtered out. Event session:', eventSessionId, 'Target:', targetSessionId)
              }
              return // Ignore events from other sessions
            }

            switch (type) {
              case 'question.asked': {
                // OpenCode is asking a question - use the data directly from the SSE event
                console.log('[OpenCode SSE] Question asked event received:', JSON.stringify(properties))
                await onEvent({ type: 'debug', partType: 'question-asked', data: properties })

                // The question data is in properties.question (from SSE event)
                // This is more reliable than fetching from API which may return incomplete data
                const questionFromEvent = properties.question as OpenCodeQuestion | undefined

                if (questionFromEvent && questionFromEvent.sessionID === targetSessionId) {
                  console.log('[OpenCode SSE] Using question from event:', questionFromEvent.id)
                  await onEvent({ type: 'question', question: questionFromEvent })
                } else {
                  // Fallback to fetching from API if event doesn't have full question
                  const questions = await client.getPendingQuestions()
                  console.log('[OpenCode SSE] Pending questions from API:', questions.length)
                  const sessionQuestion = questions.find((q) => q.sessionID === targetSessionId)

                  if (sessionQuestion) {
                    console.log('[OpenCode SSE] Found session question from API:', sessionQuestion.id)
                    await onEvent({ type: 'question', question: sessionQuestion })
                  } else {
                    console.log('[OpenCode SSE] No matching question for session:', targetSessionId)
                  }
                }
                break
              }

              case 'session.status': {
                const status = properties.status as { type: string; questionId?: string }
                console.log('[OpenCode SSE] Session status:', status?.type, 'wasBusy:', wasBusy, 'questionId:', status?.questionId)

                if (status?.type === 'busy') {
                  wasBusy = true
                  if (!emittedThinking) {
                    emittedThinking = true
                    await onEvent({ type: 'thinking' })
                  }
                } else if (status?.type === 'waiting' && !resolved) {
                  // Session is waiting for user to answer a question
                  // Note: session.status events don't include full question data, so we must fetch
                  console.log('[OpenCode SSE] Session waiting for answer, fetching question...')
                  const questions = await client.getPendingQuestions()
                  const sessionQuestion = status.questionId
                    ? questions.find((q) => q.id === status.questionId)
                    : questions.find((q) => q.sessionID === targetSessionId)

                  if (sessionQuestion) {
                    // Log what we got from API
                    console.log('[OpenCode SSE] Found question from waiting status:', sessionQuestion.id,
                      'questions array length:', sessionQuestion.questions?.length || 0)
                    await onEvent({ type: 'question', question: sessionQuestion })
                    lastActivityTime = Date.now()
                  }
                } else if (status?.type === 'idle' && wasBusy && !resolved) {
                  console.log('[OpenCode SSE] Session went idle, checking for questions...')
                  // Session went from busy to idle - check if there are pending questions
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
                    // Question found - emit it but keep stream open for answer
                    console.log('[OpenCode SSE] Found pending question, keeping stream open')
                    await onEvent({ type: 'question', question: sessionQuestion })
                    // Reset activity time so heartbeat doesn't close prematurely
                    lastActivityTime = Date.now()
                    // Don't set resolved - let heartbeat handle completion after user answers
                  } else {
                    // No questions found - but give OpenCode a moment to register one
                    // (race condition prevention)
                    console.log('[OpenCode SSE] No questions found, checking again in 2s...')
                    setTimeout(async () => {
                      if (resolved) return

                      // Check one more time for questions
                      const finalQuestions = await client.getPendingQuestions()
                      const finalQuestion = finalQuestions.find((q) => q.sessionID === targetSessionId)

                      if (finalQuestion) {
                        console.log('[OpenCode SSE] Found late question:', finalQuestion.id)
                        await onEvent({ type: 'question', question: finalQuestion })
                        lastActivityTime = Date.now()
                      } else {
                        // Truly idle - complete the stream
                        console.log('[OpenCode SSE] Confirmed idle, completing stream')
                        resolved = true
                        await onEvent({ type: 'done', sessionId: targetSessionId })
                        cleanup()
                        clearTimeout(timeout)
                        unsubscribe?.()
                        resolve()
                      }
                    }, 2000)
                  }
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
                    cleanup()
                    clearTimeout(timeout)
                    unsubscribe?.()
                    await onEvent({
                      type: 'error',
                      error: `${info.error.name}: ${info.error.message || 'Unknown error'}`,
                    })
                    resolve()
                    return
                  }

                  // Track metadata from completed messages
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
                    // Note: Completion is now handled by heartbeat interval
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
 * Uses polling to check for completion/next question.
 */
export async function handleOpenCodeAnswer(
  questionId: string,
  answer: number,
  sessionId: string,
  onEvent: (event: OpenCodeStreamEvent) => Promise<void>
): Promise<void> {
  const client = getClient()

  try {
    console.log('[OpenCode Answer] Answering question:', questionId, 'with:', answer, 'for session:', sessionId)

    // Answer the question
    await client.answerQuestion(questionId, answer)
    await onEvent({ type: 'thinking' })

    // Poll for completion using session status (max 20 seconds for same-question wait, 60 seconds total)
    const maxAttempts = 30
    const pollInterval = 2000
    let sameQuestionWaitCount = 0
    const maxSameQuestionWait = 5 // Give up after 10 seconds of waiting on same question

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval))

      // Check session status - most reliable way to know if processing is done
      const status = await client.getSessionStatus(sessionId)
      console.log('[OpenCode Answer] Poll attempt', attempt + 1, '- session status:', status.status, 'questionId:', status.questionId, 'sameWait:', sameQuestionWaitCount)

      if (status.status === 'idle' || status.status === 'unknown') {
        // Session is idle or unknown - processing complete
        console.log('[OpenCode Answer] Session', status.status, '- completing')
        await onEvent({ type: 'done', sessionId })
        return
      }

      if (status.status === 'waiting' && status.questionId && status.questionId !== questionId) {
        // A new question appeared - fetch and emit it
        console.log('[OpenCode Answer] New question detected:', status.questionId)
        const allQuestions = await client.getPendingQuestions()
        const newQuestion = allQuestions.find((q) => q.id === status.questionId)
        if (newQuestion) {
          await onEvent({ type: 'question', question: newQuestion })
          return
        }
      }

      // If waiting on the same question we answered, track how long
      if (status.status === 'waiting' && status.questionId === questionId) {
        sameQuestionWaitCount++
        if (sameQuestionWaitCount >= maxSameQuestionWait) {
          // OpenCode didn't properly clear the question - assume answered and complete
          console.log('[OpenCode Answer] Same question for', sameQuestionWaitCount, 'attempts - assuming complete')
          await onEvent({ type: 'done', sessionId })
          return
        }
      } else {
        // Reset counter if status changed
        sameQuestionWaitCount = 0
      }

      // Session is busy - keep polling
    }

    // Timeout - assume complete
    console.log('[OpenCode Answer] Polling timeout, assuming complete')
    await onEvent({ type: 'done', sessionId })
  } catch (error) {
    console.error('[OpenCode Answer] Error:', error)
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
