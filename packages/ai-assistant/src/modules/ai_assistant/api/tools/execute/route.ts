import { createLogger } from '@open-mercato/shared/lib/logger'
import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { executeTool } from '../../../lib/tool-executor'
import { loadAllModuleTools } from '../../../lib/tool-loader'
import { getToolRegistry } from '../../../lib/tool-registry'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { AiToolDefinition, McpToolContext } from '../../../lib/types'

const logger = createLogger('ai_assistant')

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Execute AI tool',
  methods: {
    POST: {
      summary: 'Execute a specific read-only MCP tool by name',
      description: 'Mutation tools must use the agent chat or run-object dispatcher and its mutation approval policy.',
      errors: [{ status: 403, description: 'Mutation tools cannot execute directly, or caller lacks tool permissions.' }],
    },
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

    const tool = getToolRegistry().getTool(toolName) as AiToolDefinition | undefined
    if (tool?.isMutation === true) {
      const { t } = await resolveTranslations()
      return NextResponse.json(
        { success: false, error: t('ai_assistant.errors.directMutationDenied') },
        { status: 403 }
      )
    }

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
    logger.error('AI Tools — Error executing tool', { err: error })
    return NextResponse.json(
      { success: false, error: 'Tool execution failed' },
      { status: 500 }
    )
  }
}
