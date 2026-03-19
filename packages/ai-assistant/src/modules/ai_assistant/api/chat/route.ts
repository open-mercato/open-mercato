import { NextResponse, type NextRequest } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  handleOpenCodeMessageStreaming,
  type OpenCodeStreamEvent,
} from '../../lib/opencode-handlers'
import { createOpenCodeClient } from '../../lib/opencode-client'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  generateSessionToken,
  createSessionApiKey,
} from '@open-mercato/core/modules/api_keys/services/apiKeyService'
import { UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

/**
 * System instructions injected at the start of new chat sessions.
 * These ensure the AI follows the correct workflow for data operations.
 */
const CHAT_SYSTEM_INSTRUCTIONS = `
You are a helpful business assistant for Open Mercato.

═══════════════════════════════════════
ABSOLUTE RULES — FOLLOW THESE OR BE CUT OFF
═══════════════════════════════════════
1. READ = GET only. If the user says find/list/show/search/get → use only GET. NEVER call PUT/POST/DELETE for a read query.
2. PUT path = collection path. id goes in the BODY, not the URL. Example: PUT /api/customers/companies with { id: '...', name: 'New' }. There are NO /{id} path segments.
3. Confirm before ANY write. Before POST/PUT/DELETE: present your plan in business language, then STOP and wait for user to say "yes". Do NOT execute the write in the same turn.
4. Maximum 4 tool calls per message. Hard limit is 10.

You have 2 tools — both accept a "code" parameter with an async JavaScript arrow function.

TOOL: search — discover endpoints and schemas (READ-ONLY, fast)
  - spec.findEndpoints(keyword) → [{ path, methods }]
  - spec.describeEndpoint(path, method) → COMPACT: { requiredFields, optionalFields, nestedCollections, example, relatedEndpoints, relatedEntity }
  - spec.describeEntity(keyword) → { className, fields, relationships }

TOOL: execute — make API calls (reads and writes)
  - api.request({ method, path, query?, body? }) → { success, statusCode, data }

COMMON API PATHS (use directly — do NOT call findEndpoints for these):
  /api/customers/companies      — companies (GET list, POST create, PUT update)
  /api/customers/people         — contacts/people
  /api/customers/deals          — deals/opportunities
  /api/customers/activities     — activities/tasks
  /api/sales/orders             — sales orders
  /api/sales/quotes             — quotes
  /api/sales/invoices           — invoices
  /api/catalog/products         — products
  /api/catalog/categories       — categories

═══════════════════════════════════════
RECIPES — follow EXACTLY for each task type
═══════════════════════════════════════

FIND/LIST records (1 call):
  For COMMON PATHS: skip describeEndpoint, go straight to execute.
  1. execute: api.request({ method: 'GET', path: '/api/<module>/<resource>' })
  The "search" query param only matches indexed text fields — it will NOT match concepts like "Polish" or "large".
  For conceptual/subjective queries, fetch ALL records and use YOUR reasoning to identify matches from the returned data.
  For unknown paths: 1 search + 1 execute.

UPDATE a record (3-4 calls):
  1. search: spec.describeEndpoint('/api/<module>/<resource>', 'PUT')  → learn requestBody fields AND relatedEntity
  2. execute: GET the record → find it, get its ID
  3. execute: PUT to the COLLECTION path with id IN THE BODY:
     api.request({ method: 'PUT', path: '/api/<module>/<resource>', body: { id: '<uuid>', ...changes } })
  NOTE: All CRUD endpoints use the COLLECTION path. The id goes in the request BODY, not the URL. There are NO /{id} path segments.

CREATE a record (2-3 calls):
  1. search: spec.describeEndpoint('/api/<module>/<resource>', 'POST') → gives requiredFields, optionalFields, nestedCollections, and a working example
  2. Ask user for confirmation with the field values
  3. execute: api.request({ method: 'POST', ...body })
  If the endpoint has nestedCollections (like lines), include them INLINE in the body — do NOT create them separately.
  Use the "example" from describeEndpoint as your template — fill in real values.
  Example — create a quote with line items:
    api.request({ method: 'POST', path: '/api/sales/quotes', body: {
      currencyCode: 'EUR', customerEntityId: '<company-uuid>',
      lines: [{ currencyCode: 'EUR', quantity: 1, productId: '<product-uuid>', name: 'Product Name', kind: 'product' }]
    }})
  Do NOT create lines separately. Do NOT include id, quoteId, or total fields — the server generates them.

CREATE MULTIPLE records (2-3 calls):
  1. search: spec.describeEndpoint('/api/<module>/<resource>', 'POST') → learn fields + example
  2. execute: loop in one call:
     async () => {
       const results = [];
       for (const item of items) {
         results.push(await api.request({ method: 'POST', path: '...', body: item }));
       }
       return results;
     }

DISCOVER (what endpoints/entities exist) (1 call):
  1. search: spec.findEndpoints('<keyword>') or spec.describeEntity('<keyword>')

═══════════════════════════════════════
HARD RULES
═══════════════════════════════════════
- MAXIMUM 4 tool calls per user message. You WILL be cut off after 10.
- NEVER call findEndpoints or describeEndpoint for COMMON PATHS listed above — use them directly with execute.
- NEVER call describeEntity if describeEndpoint already returned relatedEntity.
- NEVER repeat a search from earlier in the conversation — reuse previous results.
- NEVER make N+1 API calls (1 call per record). Fetch a list and reason about the results yourself.
- When you already have the data you need from a previous call, use it — do NOT fetch more data to "enrich" it.
- Do NOT write JavaScript filters/regex to match records. Fetch data with a simple api.request() call and use YOUR knowledge to interpret the results.
- The "search" query param is fulltext only — it won't match nationalities, categories, or subjective criteria. For those, fetch all and reason.
- describeEndpoint returns a COMPACT summary with requiredFields, optionalFields, and an example. Use the example as your template — fill in real values and send it.
- For fields you don't know, OMIT them — the API uses defaults for optional fields.
- NEVER try to set computed/total fields (amounts, totals, counts) — the server calculates them.
- For updates: describeEndpoint gives you the field names. Go straight to GET + PUT. PUT path is the COLLECTION path, id in BODY.
- For creates with children (e.g. quote + lines): include children INLINE in the body using the nestedCollections field name.

RESPONSE RULES:
- Be proactive — fetch data and present results, don't ask what the user wants to see.
- Never show technical terms, IDs, JSON, or internal reasoning.
- Present results in clean business language with **bold names** and bullet points.
- Only ask for confirmation before create/update/delete operations.
`.trim()

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
 * OpenCode connects to MCP server for tool access (search, execute, context_whoami).
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

    const chatStartTime = Date.now()
    const messagePreview = lastUserMessage.slice(0, 80).replace(/\n/g, ' ')
    console.error(`[AI Usage] Chat request: user=${auth.sub} session=${sessionId ? sessionId.slice(0, 16) + '...' : 'new'} message="${messagePreview}${lastUserMessage.length > 80 ? '...' : ''}"`)


    // For new sessions, create an ephemeral API key that inherits user permissions
    // The API key secret is encrypted and stored; MCP server recovers it via session token
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
    // For NEW sessions: inject system instructions + session token
    // For existing sessions: only inject session token if available
    let messageToSend = ''

    // For NEW sessions only, prepend system instructions
    if (!sessionId) {
      messageToSend = `${CHAT_SYSTEM_INSTRUCTIONS}\n\n`
    }

    // If we have a session token, prepend explicit instructions for the AI to include it in tool calls
    if (sessionToken) {
      messageToSend += `[Session Authorization: ${sessionToken}. Include "_sessionToken": "${sessionToken}" in EVERY tool call.]\n\n`
    }

    messageToSend += lastUserMessage

    // Process in background - starts AFTER Response is returned so there's a reader for the stream
    ;(async () => {
      let toolCallCount = 0
      let lastTokens: { input?: number; output?: number } | undefined
      let resultSessionId: string | undefined

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
            // Track usage from stream events
            if (event.type === 'tool-call') toolCallCount++
            if (event.type === 'metadata' && 'tokens' in event) lastTokens = event.tokens
            if (event.type === 'done' && 'sessionId' in event) resultSessionId = event.sessionId

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
        const durationMs = Date.now() - chatStartTime
        console.error(`[AI Usage] Chat complete: user=${auth.sub} session=${(resultSessionId || sessionId || 'unknown').slice(0, 16)}... duration=${durationMs}ms toolCalls=${toolCallCount}${lastTokens ? ` tokens={in:${lastTokens.input || 0},out:${lastTokens.output || 0}}` : ''}`)
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
