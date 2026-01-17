import { NextResponse, type NextRequest } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  handleOpenCodeMessageStreaming,
  type OpenCodeStreamEvent,
} from '../../lib/opencode-handlers'
import { createOpenCodeClient } from '../../lib/opencode-client'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  generateSessionToken,
  createSessionApiKey,
} from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

/**
 * Get user's role IDs from the database.
 */
async function getUserRoleIds(
  em: EntityManager,
  userId: string,
  tenantId: string | null
): Promise<string[]> {
  if (!tenantId) return []

  const links = await findWithDecryption(
    em,
    UserRole,
    { user: userId as any, role: { tenantId } } as any,
    { populate: ['role'] },
    { tenantId, organizationId: null },
  )
  const linkList = Array.isArray(links) ? links : []
  return linkList
    .map((l) => (l.role as any)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/**
 * Chat endpoint that routes messages to OpenCode agent.
 * OpenCode connects to MCP server for tool access (api_discover, api_execute, api_schema).
 *
 * Emits verbose SSE events for debugging:
 * - thinking: Agent started processing
 * - metadata: Model, tokens, timing info
 * - tool-call: Tool invocation with args
 * - tool-result: Tool response
 * - text: Response text
 * - question: Confirmation question from agent
 * - done: Complete with session ID
 * - error: Error occurred
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { messages, sessionId, answerQuestion } = body as {
      messages?: Array<{ role: string; content: string }>
      sessionId?: string
      // For answering a question
      answerQuestion?: {
        questionId: string
        answer: number
        sessionId: string
      }
    }

    // Create SSE stream for frontend compatibility
    const encoder = new TextEncoder()
    const stream = new TransformStream()
    const writer = stream.writable.getWriter()
    let writerClosed = false

    const writeSSE = async (event: OpenCodeStreamEvent | { type: string; [key: string]: unknown }) => {
      if (writerClosed) return // Guard against writes after close
      try {
        const jsonStr = JSON.stringify(event)
        await writer.write(encoder.encode(`data: ${jsonStr}\n\n`))
      } catch (err) {
        // Writer may have been closed by client disconnect
        console.warn('[AI Chat] Failed to write SSE event:', event.type)
      }
    }

    const closeWriter = async () => {
      if (writerClosed) return
      writerClosed = true
      try {
        await writer.close()
      } catch {
        // Already closed
      }
    }

    // Handle question answer - simple JSON response, not SSE
    // The original SSE stream continues and will receive the follow-up response
    if (answerQuestion) {
      try {
        const client = createOpenCodeClient()
        await client.answerQuestion(answerQuestion.questionId, answerQuestion.answer)
        return NextResponse.json({ success: true })
      } catch (error) {
        console.error('[AI Chat] Answer error:', error)
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Failed to answer question' },
          { status: 500 }
        )
      }
    }

    // Handle regular message
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages array is required' }, { status: 400 })
    }

    // Get the latest user message
    const lastUserMessage = messages.filter((m) => m.role === 'user').pop()?.content
    if (!lastUserMessage) {
      return NextResponse.json({ error: 'No user message found' }, { status: 400 })
    }

    // For new sessions, create an ephemeral API key that inherits user permissions
    let sessionToken: string | null = null
    if (!sessionId) {
      try {
        const container = await createRequestContainer()
        const em = container.resolve<EntityManager>('em')

        // Get user's role IDs from database
        const userRoleIds = await getUserRoleIds(em, auth.sub, auth.tenantId)

        // Generate session token and create ephemeral key
        sessionToken = generateSessionToken()
        await createSessionApiKey(em, {
          sessionToken,
          userId: auth.sub,
          userRoles: userRoleIds,
          tenantId: auth.tenantId,
          organizationId: auth.orgId,
          ttlMinutes: 120,
        })
        console.log('[AI Chat] Created session token:', sessionToken.slice(0, 12) + '...')
      } catch (error) {
        console.error('[AI Chat] Failed to create session key:', error)
        // Continue without session key - tools will use static API key auth
      }
    }

    // Build the message to send to OpenCode
    // If we have a session token, prepend explicit instructions for the AI to include it in tool calls
    let messageToSend = lastUserMessage
    if (sessionToken) {
      messageToSend = `[SYSTEM: Your session token is "${sessionToken}". You MUST include "_sessionToken": "${sessionToken}" in EVERY tool call argument object. Without this, tools will fail with authorization errors.]\n\n${lastUserMessage}`
    }

    // Process in background - starts AFTER Response is returned so there's a reader for the stream
    ;(async () => {
      try {
        // Emit session-authorized event first (if we have a token)
        if (sessionToken) {
          console.log('[AI Chat] Emitting session-authorized event')
          await writeSSE({
            type: 'session-authorized',
            sessionToken: sessionToken.slice(0, 12) + '...',
          })
        }

        // Emit thinking event for UX feedback
        await writeSSE({ type: 'thinking' })

        // Use streaming handler that supports questions
        await handleOpenCodeMessageStreaming(
          {
            message: messageToSend,
            sessionId,
          },
          async (event) => {
            await writeSSE(event)
          }
        )
      } catch (error) {
        console.error('[AI Chat] OpenCode error:', error)
        await writeSSE({
          type: 'error',
          error: error instanceof Error ? error.message : 'OpenCode request failed',
        })
      } finally {
        await closeWriter()
      }
    })()

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('[AI Chat] Error:', error)
    return NextResponse.json({ error: 'Chat request failed' }, { status: 500 })
  }
}
