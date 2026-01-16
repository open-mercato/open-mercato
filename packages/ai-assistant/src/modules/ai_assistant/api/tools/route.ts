import { NextResponse, type NextRequest } from 'next/server'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { getToolRegistry } from '../../lib/tool-registry'
import { loadAllModuleTools } from '../../lib/tool-loader'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

function hasRequiredFeatures(
  requiredFeatures: string[] | undefined,
  userFeatures: string[],
  isSuperAdmin: boolean
): boolean {
  if (isSuperAdmin) return true
  if (!requiredFeatures?.length) return true

  return requiredFeatures.every((required) => {
    if (userFeatures.includes(required)) return true
    if (userFeatures.includes('*')) return true

    return userFeatures.some((feature) => {
      if (feature.endsWith('.*')) {
        const prefix = feature.slice(0, -2)
        return required.startsWith(prefix + '.')
      }
      return false
    })
  })
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
      hasRequiredFeatures(tool.requiredFeatures, acl.features, acl.isSuperAdmin)
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
