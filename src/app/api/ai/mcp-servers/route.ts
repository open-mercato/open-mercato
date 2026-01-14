import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  getMcpServerConfigs,
  saveMcpServerConfig,
  validateMcpServerConfig,
  type McpServerConfig,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/mcp-server-config'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.mcp_servers.view'] },
  POST: { requireAuth: true, requireFeatures: ['ai_assistant.mcp_servers.manage'] },
}

const createServerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['http', 'stdio']),
  url: z.string().url().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  apiKeyId: z.string().optional(),
  enabled: z.boolean().default(true),
})

type McpServersResponse = {
  servers: McpServerConfig[]
}

/**
 * GET /api/ai/mcp-servers
 * List all MCP server configurations.
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()

  try {
    const servers = await getMcpServerConfigs(container)

    const response: McpServersResponse = {
      servers,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[MCP Servers] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch MCP servers' }, { status: 500 })
  }
}

/**
 * POST /api/ai/mcp-servers
 * Create a new MCP server configuration.
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()

  try {
    const body = await req.json()
    const parsed = createServerSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const data = parsed.data

    // Validate configuration
    const validation = validateMcpServerConfig(data)
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      )
    }

    // Save configuration
    const savedConfig = await saveMcpServerConfig(container, data)

    return NextResponse.json({
      success: true,
      server: savedConfig,
    })
  } catch (error) {
    console.error('[MCP Servers] POST error:', error)
    return NextResponse.json({ error: 'Failed to create MCP server' }, { status: 500 })
  }
}
