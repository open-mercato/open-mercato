import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { listAgents, loadAgentRegistry } from '../../../lib/agent-registry'
import { hasRequiredFeatures } from '../../../lib/auth'
import { toolRegistry } from '../../../lib/tool-registry'
import type { AiToolDefinition } from '../../../lib/types'

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

    // No LLM provider configured (no API keys set). The launcher and any
    // AI surface should hide silently rather than render an entry that fails
    // the moment the operator clicks it.
    const aiConfigured = llmProviderRegistry.resolveFirstConfigured() != null
    if (!aiConfigured) {
      return NextResponse.json({ agents: [], total: 0, aiConfigured: false })
    }

    await loadAgentRegistry()
    const all = listAgents()
    const accessible = all.filter((agent) =>
      hasRequiredFeatures(agent.requiredFeatures, acl.features, acl.isSuperAdmin, rbacService),
    )

    const agents = accessible.map((agent) => {
      const tools = agent.allowedTools.map((toolName) => {
        const tool = toolRegistry.getTool(toolName) as AiToolDefinition | undefined
        return {
          name: toolName,
          displayName: tool?.displayName ?? toolName,
          isMutation: Boolean(tool?.isMutation),
          registered: Boolean(tool),
        }
      })
      return {
        id: agent.id,
        moduleId: agent.moduleId,
        label: agent.label,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        executionMode: agent.executionMode ?? 'chat',
        mutationPolicy: agent.mutationPolicy ?? 'read-only',
        readOnly: Boolean(agent.readOnly),
        maxSteps: agent.maxSteps ?? null,
        allowedTools: agent.allowedTools,
        tools,
        requiredFeatures: agent.requiredFeatures ?? [],
        acceptedMediaTypes: agent.acceptedMediaTypes ?? [],
        hasOutputSchema: Boolean(agent.output),
      }
    })

    return NextResponse.json({ agents, total: agents.length, aiConfigured: true })
  } catch (error) {
    console.error('[AI Agents] Failed to list agents:', error)
    return NextResponse.json(
      { error: 'Failed to list agents', code: 'internal_error' },
      { status: 500 },
    )
  }
}
