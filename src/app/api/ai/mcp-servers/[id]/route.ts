import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  getMcpServerConfig,
  updateMcpServerConfig,
  deleteMcpServerConfig,
  validateMcpServerConfig,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/mcp-server-config'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.mcp_servers.view'] },
  PUT: { requireAuth: true, requireFeatures: ['ai_assistant.mcp_servers.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['ai_assistant.mcp_servers.manage'] },
}

const updateServerSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['http', 'stdio']).optional(),
  url: z.string().url().optional().nullable(),
  command: z.string().optional().nullable(),
  args: z.array(z.string()).optional().nullable(),
  apiKeyId: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
})

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * GET /api/ai/mcp-servers/:id
 * Get a single MCP server configuration.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const container = await createRequestContainer()

  try {
    const server = await getMcpServerConfig(container, id)

    if (!server) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    return NextResponse.json({ server })
  } catch (error) {
    console.error('[MCP Server] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch MCP server' }, { status: 500 })
  }
}

/**
 * PUT /api/ai/mcp-servers/:id
 * Update an MCP server configuration.
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const container = await createRequestContainer()

  try {
    // Check if server exists
    const existing = await getMcpServerConfig(container, id)
    if (!existing) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    const body = await req.json()
    const parsed = updateServerSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const updates = parsed.data

    // Merge updates with existing and validate
    const merged = {
      ...existing,
      ...updates,
      // Handle nullable fields
      url: updates.url === null ? undefined : (updates.url ?? existing.url),
      command: updates.command === null ? undefined : (updates.command ?? existing.command),
      args: updates.args === null ? undefined : (updates.args ?? existing.args),
      apiKeyId: updates.apiKeyId === null ? undefined : (updates.apiKeyId ?? existing.apiKeyId),
    }

    const validation = validateMcpServerConfig(merged)
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      )
    }

    // Update configuration
    const updatedConfig = await updateMcpServerConfig(container, id, updates)

    return NextResponse.json({
      success: true,
      server: updatedConfig,
    })
  } catch (error) {
    console.error('[MCP Server] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update MCP server' }, { status: 500 })
  }
}

/**
 * DELETE /api/ai/mcp-servers/:id
 * Delete an MCP server configuration.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const container = await createRequestContainer()

  try {
    const deleted = await deleteMcpServerConfig(container, id)

    if (!deleted) {
      return NextResponse.json({ error: 'Server not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error('[MCP Server] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete MCP server' }, { status: 500 })
  }
}
