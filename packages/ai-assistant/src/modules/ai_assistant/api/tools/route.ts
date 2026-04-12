import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getToolRegistry } from '../../lib/tool-registry'
import { loadAllModuleTools } from '../../lib/tool-loader'
import { hasRequiredFeatures } from '../../lib/auth'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const container = await createRequestContainer()
    const rbacService = container.resolve<RbacService>('rbacService')

    // Load ACL for user
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    // Ensure tools are loaded
    await loadAllModuleTools()

    // Get tools filtered by ACL
    const registry = getToolRegistry()
    const allTools = Array.from(registry.getTools().values())

    const accessibleTools = allTools.filter((tool) =>
      hasRequiredFeatures(tool.requiredFeatures, acl.features, acl.isSuperAdmin, rbacService)
    )

    const tools = accessibleTools.map((tool) => {
      const nameParts = tool.name.split('.')
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema as any) as Record<string, unknown>,
        module: nameParts[0] || 'other',
      }
    })

    return NextResponse.json({ tools })
  } catch (error) {
    console.error('[AI Tools] Error listing tools:', error)
    return NextResponse.json({ error: 'Failed to list tools' }, { status: 500 })
  }
}

const toolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  module: z.string(),
})

const toolsResponseSchema = z.object({ tools: z.array(toolSchema) })
const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'List AI tools',
  description: 'Returns MCP-discoverable tools filtered by user features/roles.',
  methods: {
    GET: {
      summary: 'Get accessible tools',
      responses: [{ status: 200, description: 'Accessible tools with JSON Schemas', schema: toolsResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 500, description: 'Failed to list tools', schema: errorSchema },
      ],
    },
  },
}
