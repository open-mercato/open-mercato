/**
 * OpenCode API Route Handlers
 *
 * These handlers can be used by Next.js API routes to interact with OpenCode.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { findApiKeyByOpencodeSessionId } from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { normalizeOpenCodeToolPart } from '@open-mercato/shared/lib/ai/opencode-tool-parts'
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

/**
 * Auth context required to resume or answer an existing OpenCode session.
 *
 * The runtime asserts that the OpenCode session id presented by the caller is
 * bound to an api_key row whose `sessionUserId`, `tenantId`, and
 * `organizationId` exactly match this triple — otherwise we refuse the
 * request with `OpenCodeSessionOwnershipError`.
 */
export type OpenCodeAuthContext = {
  userId: string
  tenantId: string | null
  organizationId: string | null
}

/**
 * Thrown when an OpenCode session resume / answer attempt cannot be tied to
 * an api_key row owned by the current authenticated principal.
 *
 * `code === 'session_unbound'` means the OpenCode session id has no api_key
 * binding (either it never existed, or auth context was missing).
 * `code === 'session_owner_mismatch'` means the binding exists but belongs to
 * a different user / tenant / organization.
 *
 * Both variants surface the same opaque user-facing message — callers MUST
 * NOT leak the discriminator into HTTP responses or SSE events.
 */
export class OpenCodeSessionOwnershipError extends Error {
  readonly code: 'session_owner_mismatch' | 'session_unbound'
  constructor(code: 'session_owner_mismatch' | 'session_unbound', message: string) {
    super(message)
    this.code = code
    this.name = 'OpenCodeSessionOwnershipError'
  }
}

async function assertOpencodeSessionOwnership(
  em: EntityManager,
  opencodeSessionId: string,
  auth: OpenCodeAuthContext
): Promise<void> {
  const row = await findApiKeyByOpencodeSessionId(em, opencodeSessionId)
  if (!row) {
    throw new OpenCodeSessionOwnershipError('session_unbound', 'Session not available')
  }
  const rowTenantId = row.tenantId ?? null
  const rowOrgId = row.organizationId ?? null
  if (
    row.sessionUserId !== auth.userId ||
    rowTenantId !== auth.tenantId ||
    rowOrgId !== auth.organizationId
  ) {
    throw new OpenCodeSessionOwnershipError('session_owner_mismatch', 'Session not available')
  }
}

export type OpenCodeTestRequest = {
  message: string
  sessionId?: string
  model?: {
    providerID: string
    modelID: string
  }
  /**
   * Authenticated principal that owns this chat turn.
   *
   * Optional at the type level for source-compatibility, but REQUIRED at
   * runtime whenever the caller resumes an existing `sessionId`. New call
   * sites MUST always pass it — see the security fix in
   * `.ai/specs/2026-05-23-fix-opencode-session-ownership.md`.
   *
   * @since 0.6.0
   */
  auth?: OpenCodeAuthContext
  /**
   * MikroORM `EntityManager` used to look up the api_key binding for
   * ownership checks. Optional at the type level for source-compatibility,
   * but REQUIRED at runtime whenever `auth` is passed.
   *
   * @since 0.6.0
   */
  em?: EntityManager
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
  search?: {
    available: boolean
    driver: string | null // 'meilisearch' or null
    url: string | null // Meilisearch URL
  }
  url: string
  mcpUrl: string
  message?: string
}

/**
 * Handle POST request to send a message to OpenCode.
 */
export async function handleOpenCodeMessage(
  request: OpenCodeTestRequest
): Promise<OpenCodeTestResponse> {
  const client = getClient()

  const { message, sessionId, model, auth, em } = request

  if (!message) {
    throw new Error('Message is required')
  }

  // Create or get session
  let session
  if (sessionId) {
    if (!auth || !em) {
      // Fail closed — resuming an existing OpenCode session without an auth
      // context is the very scenario this guard prevents (cross-user resume).
      throw new OpenCodeSessionOwnershipError(
        'session_unbound',
        'OpenCode session resume requires auth context'
      )
    }
    await assertOpencodeSessionOwnership(em, sessionId, auth)
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
  // MCP_URL is the full URL (e.g., https://mcp.example.com), fallback to localhost with port
  const mcpUrl = process.env.MCP_URL ?? `http://localhost:${process.env.MCP_DEV_PORT ?? '3001'}`
  const meilisearchHost = process.env.MEILISEARCH_HOST ?? null

  // Check search service availability
  let searchStatus: { available: boolean; driver: string | null; url: string | null } = {
    available: false,
    driver: null,
    url: meilisearchHost,
  }
  try {
    const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
    const container = await createRequestContainer()
    const searchService = container.resolve<{
      isStrategyAvailable: (strategy: string) => boolean
    }>('searchService')
    const available = searchService.isStrategyAvailable('fulltext')
    searchStatus = {
      available,
      driver: available ? 'meilisearch' : null,
      url: meilisearchHost,
    }
  } catch {
    // Search service not available
  }

  try {
    const [health, mcp] = await Promise.all([client.health(), client.mcpStatus()])

    return {
      status: 'ok',
      opencode: health,
      mcp,
      search: searchStatus,
      url,
      mcpUrl,
    }
  } catch (error) {
    return {
      status: 'error',
      search: searchStatus,
      message: error instanceof Error ? error.message : 'OpenCode not reachable',
      url,
      mcpUrl,
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
  const { message, sessionId, model, auth, em } = request
  const startTime = Date.now()

  // Accumulators for usage summary
  const usageStats = {
    toolCalls: 0,
    toolNames: [] as string[],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    messageCount: 0,
  }
  // OpenCode re-emits the same tool part on every state transition; track which
  // call ids already streamed a `tool-call` so each tool surfaces once.
  const seenToolCallIds = new Set<string>()

  if (!message) {
    await onEvent({ type: 'error', error: 'Message is required' })
    return
  }

  try {
    // Create or get session
    let session
    if (sessionId) {
      if (!auth || !em) {
        // Fail closed — resuming an existing OpenCode session without an
        // auth context is exactly what this guard prevents (cross-user
        // resume). Use the streaming error-event shape used elsewhere in
        // this function and surface the same opaque message regardless of
        // which ownership variant failed.
        await onEvent({ type: 'error', error: 'Session not available' })
        return
      }
      try {
        await assertOpencodeSessionOwnership(em, sessionId, auth)
      } catch (err) {
        if (err instanceof OpenCodeSessionOwnershipError) {
          await onEvent({ type: 'error', error: 'Session not available' })
          return
        }
        throw err
      }
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

            if (status.status === 'busy') {
              // Session is still busy - wait
              return
            }

            if (status.status === 'waiting' && status.questionId) {
              // Session is waiting for a question answer
              const questions = await client.getPendingQuestions()
              const sessionQuestion = questions.find((q) => q.id === status.questionId)
              if (sessionQuestion) {
                await onEvent({ type: 'question', question: sessionQuestion })
                lastActivityTime = Date.now() // Reset timer after emitting question
                return
              }
            }

            // Check for any pending questions for this session
            const questions = await client.getPendingQuestions()
            const sessionQuestion = questions.find((q) => q.sessionID === targetSessionId)

            if (sessionQuestion) {
              await onEvent({ type: 'question', question: sessionQuestion })
              lastActivityTime = Date.now() // Reset timer after emitting question
            } else if (status.status === 'idle') {
              // Session is explicitly idle and no questions - complete
              resolved = true
              const durationMs = Date.now() - startTime
              console.error(`[AI Usage] Session complete (heartbeat): sessionId=${targetSessionId.slice(0, 16)}... duration=${durationMs}ms tokens={in:${usageStats.totalInputTokens},out:${usageStats.totalOutputTokens}} toolCalls=${usageStats.toolCalls} tools=[${usageStats.toolNames.join(',')}] messages=${usageStats.messageCount}`)
              try {
                await onEvent({ type: 'done', sessionId: targetSessionId })
              } catch (err) {
                console.error('[OpenCode SSE] Heartbeat: Failed to emit done event:', err)
              }
              cleanup()
              clearTimeout(timeout)
              unsubscribe?.()
              resolve()
            }
            // Status is 'unknown' or something else - wait for SSE events
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

            // Filter events for our session
            const eventSessionId =
              (properties.sessionID as string) ||
              (properties.info as { sessionID?: string })?.sessionID ||
              (properties.part as { sessionID?: string })?.sessionID ||
              (properties.question as { sessionID?: string })?.sessionID ||
              (properties.session as { id?: string })?.id ||
              (properties.status as { sessionID?: string })?.sessionID

            if (eventSessionId && eventSessionId !== targetSessionId) {
              return // Ignore events from other sessions
            }

            switch (type) {
              case 'question.asked': {
                // OpenCode is asking a question - use the data directly from the SSE event
                await onEvent({ type: 'debug', partType: 'question-asked', data: properties })

                // The question data is in properties.question (from SSE event)
                // This is more reliable than fetching from API which may return incomplete data
                const questionFromEvent = properties.question as OpenCodeQuestion | undefined

                if (questionFromEvent && questionFromEvent.sessionID === targetSessionId) {
                  await onEvent({ type: 'question', question: questionFromEvent })
                } else {
                  // Fallback to fetching from API if event doesn't have full question
                  const questions = await client.getPendingQuestions()
                  const sessionQuestion = questions.find((q) => q.sessionID === targetSessionId)

                  if (sessionQuestion) {
                    await onEvent({ type: 'question', question: sessionQuestion })
                  }
                }
                break
              }

              case 'session.status': {
                const status = properties.status as { type: string; questionId?: string }

                if (status?.type === 'busy') {
                  wasBusy = true
                  if (!emittedThinking) {
                    emittedThinking = true
                    await onEvent({ type: 'thinking' })
                  }
                } else if (status?.type === 'waiting' && !resolved) {
                  // Session is waiting for user to answer a question
                  const questions = await client.getPendingQuestions()
                  const sessionQuestion = status.questionId
                    ? questions.find((q) => q.id === status.questionId)
                    : questions.find((q) => q.sessionID === targetSessionId)

                  if (sessionQuestion) {
                    await onEvent({ type: 'question', question: sessionQuestion })
                    lastActivityTime = Date.now()
                  }
                } else if (status?.type === 'idle' && wasBusy && !resolved) {
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
                    await onEvent({ type: 'question', question: sessionQuestion })
                    // Reset activity time so heartbeat doesn't close prematurely
                    lastActivityTime = Date.now()
                    // Don't set resolved - let heartbeat handle completion after user answers
                  } else {
                    // No questions found - but give OpenCode a moment to register one
                    // (race condition prevention)
                    setTimeout(async () => {
                      try {
                        if (resolved) {
                          return
                        }

                        // Check one more time for questions
                        const finalQuestions = await client.getPendingQuestions()
                        const finalQuestion = finalQuestions.find((q) => q.sessionID === targetSessionId)

                        if (finalQuestion) {
                          await onEvent({ type: 'question', question: finalQuestion })
                          lastActivityTime = Date.now()
                        } else {
                          // Truly idle - complete the stream
                          resolved = true
                          const durationMs = Date.now() - startTime
                          console.error(`[AI Usage] Session complete: sessionId=${targetSessionId.slice(0, 16)}... duration=${durationMs}ms tokens={in:${usageStats.totalInputTokens},out:${usageStats.totalOutputTokens}} toolCalls=${usageStats.toolCalls} tools=[${usageStats.toolNames.join(',')}] messages=${usageStats.messageCount}`)
                          await onEvent({ type: 'done', sessionId: targetSessionId })
                          cleanup()
                          clearTimeout(timeout)
                          unsubscribe?.()
                          resolve()
                        }
                      } catch (err) {
                        console.error('[OpenCode SSE] Error in timeout callback:', err)
                        // Still try to complete even if there was an error
                        if (!resolved) {
                          resolved = true
                          try {
                            await onEvent({ type: 'done', sessionId: targetSessionId })
                          } catch (e2) {
                            console.error('[OpenCode SSE] Failed to emit done event:', e2)
                          }
                          cleanup()
                          clearTimeout(timeout)
                          unsubscribe?.()
                          resolve()
                        }
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

                    // Accumulate token usage
                    usageStats.messageCount++
                    if (info.tokens) {
                      usageStats.totalInputTokens += info.tokens.input || 0
                      usageStats.totalOutputTokens += info.tokens.output || 0
                      console.error(`[AI Usage] Tokens (message ${usageStats.messageCount}): input=${info.tokens.input} output=${info.tokens.output} model=${info.modelID || 'unknown'}`)
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

                // Tool invocations (native `type: 'tool'` state machine or the
                // legacy `tool_use` / `tool_result` shape) are normalized to a
                // single lifecycle update. OpenCode re-emits the same part on
                // each transition, so a `tool-call` event is streamed once per
                // call id and `tool-result` once it reaches a terminal status.
                const toolUpdate = normalizeOpenCodeToolPart(part)
                if (toolUpdate) {
                  if (!seenToolCallIds.has(toolUpdate.callId) && toolUpdate.toolName) {
                    seenToolCallIds.add(toolUpdate.callId)
                    usageStats.toolCalls++
                    usageStats.toolNames.push(toolUpdate.toolName)
                    console.error(`[AI Usage] Tool call #${usageStats.toolCalls}: ${toolUpdate.toolName}`)
                    await onEvent({
                      type: 'tool-call',
                      id: toolUpdate.callId,
                      toolName: toolUpdate.toolName,
                      args: toolUpdate.input,
                    })
                  }
                  if (toolUpdate.phase === 'finish') {
                    await onEvent({
                      type: 'tool-result',
                      id: toolUpdate.callId,
                      result: toolUpdate.output,
                    })
                  }
                  break
                }

                switch (part.type) {
                  case 'text':
                    // Use delta for streaming text if available
                    if (delta) {
                      await onEvent({ type: 'text', content: delta })
                    }
                    break
                  case 'thinking':
                    // Extended thinking blocks — route to debug panel only, never to chat
                    console.error(`[OpenCode SSE] Thinking block received (${(delta || part.text || '').length} chars)`)
                    await onEvent({ type: 'debug', partType: 'thinking', data: { text: delta || part.text } })
                    break
                  case 'step-start':
                  case 'step-finish':
                    await onEvent({ type: 'debug', partType: part.type, data: part })
                    break
                }
                break
              }

              case 'message.part.delta': {
                const part = properties.part as { type?: string } | undefined
                const delta = properties.delta as string | undefined
                // Filter out thinking deltas — only stream text part deltas to chat
                if (delta && part?.type !== 'thinking') {
                  await onEvent({ type: 'text', content: delta })
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

    // Send message (don't await - let SSE handle the response via events)
    // We only catch errors here - successful completion is signaled via SSE session.status: idle
    client.sendMessage(session.id, message, { model }).catch((err) => {
      // Log send errors - SSE should also receive an error event
      console.error('[OpenCode] Send error (SSE should handle):', err)
    })

    // Wait for SSE to indicate completion (session.status: idle or error)
    await eventPromise
  } catch (error) {
    await onEvent({
      type: 'error',
      error: error instanceof Error ? error.message : 'OpenCode request failed',
    })
  }
}

/**
 * Optional ownership guard for {@link handleOpenCodeAnswer}.
 *
 * Pass `{ auth, em }` to enforce that the question being answered belongs to
 * an OpenCode session bound to the current authenticated principal. Required
 * at runtime for any caller resuming a session — see the security fix in
 * `.ai/specs/2026-05-23-fix-opencode-session-ownership.md`.
 */
export type OpenCodeAnswerOwnershipOptions = {
  auth?: OpenCodeAuthContext
  em?: EntityManager
}

/**
 * Answer a pending question and continue processing.
 * Uses polling to check for completion/next question.
 */
export async function handleOpenCodeAnswer(
  questionId: string,
  answer: number,
  sessionId: string,
  onEvent: (event: OpenCodeStreamEvent) => Promise<void>,
  ownership?: OpenCodeAnswerOwnershipOptions
): Promise<void> {
  const client = getClient()

  try {
    // Resolve the question's actual sessionID via OpenCode's pending list.
    // This is the only trustworthy source: the caller-supplied `sessionId`
    // could be tampered with, but the question's `sessionID` is whatever
    // OpenCode actually emitted when the question was raised. If those two
    // do not match — or if the question is unknown/stale — refuse early.
    const pending = await client.getPendingQuestions()
    const matchingQuestion = pending.find((q) => q.id === questionId)
    if (!matchingQuestion) {
      await onEvent({ type: 'error', error: 'Session not available' })
      return
    }
    if (matchingQuestion.sessionID !== sessionId) {
      // The caller named a session id that does not own this question —
      // refuse with the same opaque message used for ownership failures.
      await onEvent({ type: 'error', error: 'Session not available' })
      return
    }

    // Now assert ownership against the question's own sessionID (not the
    // caller-supplied `sessionId`, which we have already cross-checked).
    if (ownership?.auth && ownership?.em) {
      try {
        await assertOpencodeSessionOwnership(
          ownership.em,
          matchingQuestion.sessionID,
          ownership.auth
        )
      } catch (err) {
        if (err instanceof OpenCodeSessionOwnershipError) {
          await onEvent({ type: 'error', error: 'Session not available' })
          return
        }
        throw err
      }
    } else {
      // Fail closed when ownership context is missing — never answer a
      // question against an unverified OpenCode session.
      await onEvent({ type: 'error', error: 'Session not available' })
      return
    }

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

      if (status.status === 'idle' || status.status === 'unknown') {
        // Session is idle or unknown - processing complete
        await onEvent({ type: 'done', sessionId })
        return
      }

      if (status.status === 'waiting' && status.questionId && status.questionId !== questionId) {
        // A new question appeared - fetch and emit it
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
 * Get pending OpenCode questions whose sessions are owned by the given
 * authenticated principal.
 *
 * Replaces the cross-user-leaky `getPendingQuestions()` overload. For each
 * pending question, the helper resolves its `sessionID` to the api_key row
 * via {@link findApiKeyByOpencodeSessionId} and keeps the question only when
 * the row's `sessionUserId / tenantId / organizationId` exactly matches the
 * auth triple.
 *
 * Questions whose sessions have no api_key binding (and therefore cannot be
 * owned by anyone yet) are dropped.
 */
export async function getOwnedPendingQuestions(
  em: EntityManager,
  auth: OpenCodeAuthContext
): Promise<OpenCodeQuestion[]> {
  const client = getClient()
  const all = await client.getPendingQuestions()
  if (!Array.isArray(all) || all.length === 0) return []

  const owned: OpenCodeQuestion[] = []
  for (const question of all) {
    const sessionId = question?.sessionID
    if (!sessionId) continue
    const row = await findApiKeyByOpencodeSessionId(em, sessionId)
    if (!row) continue
    if (
      row.sessionUserId !== auth.userId ||
      (row.tenantId ?? null) !== auth.tenantId ||
      (row.organizationId ?? null) !== auth.organizationId
    ) {
      continue
    }
    owned.push(question)
  }
  return owned
}

/**
 * Get pending questions for a session.
 *
 * @deprecated since 0.6.0 — the original unscoped overload returned ALL
 * pending questions across every OpenCode session and leaked cross-user /
 * cross-tenant information (see security fix
 * `.ai/specs/2026-05-24-fix-opencode-session-ownership.md`). The overload
 * is kept as an importable symbol for source-compatibility (BC §3) but
 * now throws on call. Migrate callers to {@link getOwnedPendingQuestions}
 * with an authenticated principal.
 *
 * Throws an error rather than silently returning `[]` so stale callers
 * surface during integration rather than producing "no questions ever"
 * symptoms that would mask a regression.
 */
export async function getPendingQuestions(): Promise<OpenCodeQuestion[]> {
  throw new Error(
    'getPendingQuestions() is no longer safe to call without an auth context — ' +
      'use getOwnedPendingQuestions(em, auth) instead. See ' +
      '.ai/specs/2026-05-24-fix-opencode-session-ownership.md'
  )
}

// Re-export the question type
export type { OpenCodeQuestion }
