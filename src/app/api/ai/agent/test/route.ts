import { NextResponse, type NextRequest } from 'next/server'
import {
  handleOpenCodeMessage,
  handleOpenCodeHealth,
} from '@open-mercato/ai-assistant'

/**
 * Test endpoint for OpenCode integration.
 * Creates a session, sends a message, and returns the response.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = await handleOpenCodeMessage(body)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[OpenCode Test] Error:', error)
    return NextResponse.json(
      {
        error: 'OpenCode test failed',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/**
 * Health check for OpenCode connection.
 */
export async function GET() {
  const health = await handleOpenCodeHealth()
  const status = health.status === 'ok' ? 200 : 503
  return NextResponse.json(health, { status })
}
