/**
 * OpenCode API Route Handlers
 *
 * These handlers can be used by Next.js API routes to interact with OpenCode.
 */

import { createOpenCodeClient, type OpenCodeClient } from './opencode-client'

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
