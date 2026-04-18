import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { listAgents, loadAgentRegistry } from '../../../lib/agent-registry'
import { hasRequiredFeatures } from '../../../lib/auth'

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'List AI agents the caller can invoke',
  methods: {
    GET: {
      operationId: 'aiAssistantListAgents',
      summary: 'List registered AI agents, filtered by the caller\'s features.',
      description:
        'Returns `{ agents: [...] }` — the subset of agents from `ai-agents.generated.ts` that the ' +
        'authenticated caller can invoke based on each agent\'s `requiredFeatures`. Mirrors the ' +
        '`meta.list_agents` tool handler so backoffice pages (e.g. the playground) can render an ' +
        'agent picker without going through the MCP tool transport.',
      responses: [
        {
          status: 200,
          description: 'Accessible agent summaries.',
          mediaType: 'application/json',
        },
      ],
      errors: [
        { status: 401, description: 'Unauthenticated caller.' },
        { status: 500, description: 'Internal failure while loading the agent registry.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized', code: 'unauthenticated' }, { status: 401 })
  }

  try {
    const container = await createRequestContainer()
    const rbacService = container.resolve<RbacService>('rbacService')
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    await loadAgentRegistry()
    const all = listAgents()
    const accessible = all.filter((agent) =>
      hasRequiredFeatures(agent.requiredFeatures, acl.features, acl.isSuperAdmin, rbacService),
    )

    const agents = accessible.map((agent) => ({
      id: agent.id,
      moduleId: agent.moduleId,
      label: agent.label,
      description: agent.description,
      executionMode: agent.executionMode ?? 'chat',
      mutationPolicy: agent.mutationPolicy ?? 'read-only',
      allowedTools: agent.allowedTools,
      requiredFeatures: agent.requiredFeatures ?? [],
      acceptedMediaTypes: agent.acceptedMediaTypes ?? [],
      hasOutputSchema: Boolean(agent.output),
    }))

    return NextResponse.json({ agents, total: agents.length })
  } catch (error) {
    console.error('[AI Agents] Failed to list agents:', error)
    return NextResponse.json(
      { error: 'Failed to list agents', code: 'internal_error' },
      { status: 500 },
    )
  }
}
