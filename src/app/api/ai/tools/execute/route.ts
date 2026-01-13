import { NextResponse, type NextRequest } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { bootstrap } from '@/bootstrap'
import { executeTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-executor'
import { loadAllModuleTools } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-loader'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { McpToolContext } from '@open-mercato/ai-assistant/types'

bootstrap()

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
