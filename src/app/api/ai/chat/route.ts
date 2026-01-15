import { NextResponse, type NextRequest } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  handleOpenCodeMessageStreaming,
  handleOpenCodeAnswer,
  type OpenCodeStreamEvent,
} from '@open-mercato/ai-assistant'

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
      }
    }

    // Create SSE stream for frontend compatibility
    const encoder = new TextEncoder()
    const stream = new TransformStream()
    const writer = stream.writable.getWriter()

    const writeSSE = async (event: OpenCodeStreamEvent | { type: string; [key: string]: unknown }) => {
      const jsonStr = JSON.stringify(event)
      await writer.write(encoder.encode(`data: ${jsonStr}\n\n`))
    }

    // Handle question answer
    if (answerQuestion) {
      ;(async () => {
        try {
          console.log('[AI Chat] Answering question:', answerQuestion.questionId, 'with', answerQuestion.answer)

          await handleOpenCodeAnswer(
            answerQuestion.questionId,
            answerQuestion.answer,
            async (event) => {
              console.log('[AI Chat] Answer event:', event.type)
              await writeSSE(event)
            }
          )
        } catch (error) {
          console.error('[AI Chat] Answer error:', error)
          await writeSSE({
            type: 'error',
            error: error instanceof Error ? error.message : 'Failed to answer question',
          })
        } finally {
          await writer.close()
        }
      })()

      return new Response(stream.readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
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

    // Process in background
    ;(async () => {
      try {
        // Emit thinking event immediately for UX feedback
        await writeSSE({ type: 'thinking' })

        console.log('[AI Chat] Sending to OpenCode:', lastUserMessage.substring(0, 100))

        // Use streaming handler that supports questions
        await handleOpenCodeMessageStreaming(
          {
            message: lastUserMessage,
            sessionId,
          },
          async (event) => {
            console.log('[AI Chat] Event:', event.type)
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
        await writer.close()
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
