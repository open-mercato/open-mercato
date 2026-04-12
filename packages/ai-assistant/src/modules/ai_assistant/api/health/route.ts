import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { handleOpenCodeHealth } from '../../lib/opencode-handlers'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

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

const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  opencode: z
    .object({
      healthy: z.boolean(),
      version: z.string(),
    })
    .optional(),
  mcp: z.record(z.string(), z.object({ status: z.string(), error: z.string().optional() })).optional(),
  search: z
    .object({
      available: z.boolean(),
      driver: z.string().nullable(),
      url: z.string().nullable(),
    })
    .optional(),
  url: z.string(),
  mcpUrl: z.string(),
  message: z.string().optional(),
})

const errorSchema = z.object({ error: z.string(), message: z.string().optional() })

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Check AI Assistant health',
  description: 'Returns readiness information for OpenCode, MCP connectivity, and search availability.',
  methods: {
    GET: {
      summary: 'Health status',
      description: 'Validates authentication, then probes OpenCode server, MCP bridge, and search driver status.',
      responses: [{ status: 200, description: 'Health details', schema: healthResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 500, description: 'Failed to check health', schema: errorSchema },
      ],
    },
  },
}
