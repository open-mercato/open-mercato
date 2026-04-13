import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { handleOpenCodeHealth } from '../../lib/opencode-handlers'

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'AI assistant health check',
  methods: {
    GET: { summary: 'Check OpenCode and MCP connection status' },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

/**
 * GET /api/ai_assistant/health
 *
 * Returns OpenCode and MCP connection status.
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const health = await handleOpenCodeHealth()
    return NextResponse.json(health)
  } catch (error) {
    console.error('[AI Health] Error:', error)
    return NextResponse.json(
      { error: 'Failed to check health', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
