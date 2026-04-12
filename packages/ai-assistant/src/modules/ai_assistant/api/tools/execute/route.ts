import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { executeTool } from '../../../lib/tool-executor'
import { loadAllModuleTools } from '../../../lib/tool-loader'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { McpToolContext } from '../../../lib/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Execute AI tool',
  methods: {
    POST: { summary: 'Execute a specific MCP tool by name' },
  },
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { toolName, args = {} } = body

    if (!toolName || typeof toolName !== 'string') {
      return NextResponse.json({ error: 'toolName is required' }, { status: 400 })
    }

    const container = await createRequestContainer()
    const rbacService = container.resolve<RbacService>('rbacService')

    // Load ACL for user
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    // Ensure tools are loaded
    await loadAllModuleTools()

    // Build tool context
    const toolContext: McpToolContext = {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
      container,
      userFeatures: acl.features,
      isSuperAdmin: acl.isSuperAdmin,
    }

    // Execute the tool
    const result = await executeTool(toolName, args, toolContext)

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.errorCode === 'UNAUTHORIZED' ? 403 : 400 }
      )
    }

    return NextResponse.json({
      success: true,
      result: result.result,
    })
  } catch (error) {
    console.error('[AI Tools] Error executing tool:', error)
    return NextResponse.json(
      { success: false, error: 'Tool execution failed' },
      { status: 500 }
    )
  }
}

const executeRequestSchema = z.object({
  toolName: z.string().describe('Fully-qualified tool name (module.action)'),
  args: z.record(z.string(), z.unknown()).default({}).describe('Tool input payload'),
})

const executeSuccessSchema = z.object({
  success: z.literal(true),
  result: z.unknown(),
})

const executeFailureSchema = z.object({
  success: z.literal(false),
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Execute an AI tool directly',
  description: 'Runs a specific MCP tool with user-scoped permissions without going through chat.',
  methods: {
    POST: {
      summary: 'Execute tool',
      requestBody: {
        contentType: 'application/json',
        schema: executeRequestSchema,
        description: 'Tool name and arguments.',
      },
      responses: [
        { status: 200, description: 'Tool executed successfully', schema: executeSuccessSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload or execution error', schema: executeFailureSchema },
        { status: 401, description: 'Unauthorized', schema: executeFailureSchema },
        { status: 403, description: 'Forbidden / missing features', schema: executeFailureSchema },
        { status: 500, description: 'Tool execution failed', schema: executeFailureSchema },
      ],
    },
  },
}
