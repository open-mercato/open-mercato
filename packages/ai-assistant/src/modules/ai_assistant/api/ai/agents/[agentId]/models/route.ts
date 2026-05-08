import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import { getAgent, loadAgentRegistry } from '../../../../../lib/agent-registry'
import { hasRequiredFeatures } from '../../../../../lib/auth'
import { createModelFactory, resolveAllowRuntimeOverride } from '../../../../../lib/model-factory'

const agentIdPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/

const agentIdParamSchema = z.object({
  agentId: z
    .string()
    .regex(agentIdPattern, 'agentId must match "<module>.<agent>" (lowercase, digits, underscores only)'),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'Available models for an AI agent',
  methods: {
    GET: {
      operationId: 'aiAssistantGetAgentModels',
      summary: 'Get the providers and curated models available for the chat-UI picker for this agent',
      description:
        'Returns all configured providers with their curated model catalogs, filtered to providers ' +
        'that have an API key configured in the current environment. When the agent declares ' +
        '`allowRuntimeOverride: false`, the response reflects that constraint so the ' +
        'UI picker can hide itself. Includes the agent\'s resolved default provider/model so ' +
        'the picker can render a "(default)" badge next to the right entry. ' +
        'RBAC: requires the same features as the agent itself (typically `ai_assistant.view`).',
      responses: [
        {
          status: 200,
          description:
            'Providers and curated models available for the agent picker. ' +
            'Empty `providers` array when `allowRuntimeOverride` is false.',
        },
      ],
      errors: [
        { status: 401, description: 'Unauthenticated.' },
        { status: 403, description: 'Caller lacks the agent\'s required features.' },
        { status: 404, description: 'Unknown agent id.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawParams = await params
  const paramResult = agentIdParamSchema.safeParse(rawParams)
  if (!paramResult.success) {
    return NextResponse.json(
      { error: 'Invalid agentId path parameter.', code: 'validation_error', issues: paramResult.error.issues },
      { status: 400 },
    )
  }
  const agentId = paramResult.data.agentId

  try {
    await loadAgentRegistry()

    const container = await createRequestContainer()
    const rbacService = container.resolve<RbacService>('rbacService')
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    const agent = getAgent(agentId)
    if (!agent) {
      return NextResponse.json({ error: `Agent "${agentId}" not found.`, code: 'agent_unknown' }, { status: 404 })
    }

    const agentFeatures = agent.requiredFeatures ?? []
    if (agentFeatures.length > 0) {
      const permitted = hasRequiredFeatures(agentFeatures, acl.features, acl.isSuperAdmin)
      if (!permitted) {
        return NextResponse.json(
          {
            error: `Access to agent "${agentId}" requires features: ${agentFeatures.join(', ')}.`,
            code: 'agent_features_denied',
          },
          { status: 403 },
        )
      }
    }

    const allowRuntimeOverride = resolveAllowRuntimeOverride(agent)

    // Resolve the agent's current default provider/model for the "(default)" badge
    const factory = createModelFactory(container)
    const defaultResolution = factory.resolveModel({
      moduleId: agent.moduleId,
      agentDefaultModel: agent.defaultModel,
      agentDefaultProvider: agent.defaultProvider,
      agentDefaultBaseUrl: agent.defaultBaseUrl,
      allowRuntimeOverride,
    })
    const defaultProviderId = defaultResolution.providerId
    const defaultModelId = defaultResolution.modelId

    // Build provider list — only configured providers, with curated model catalogs
    const providers = allowRuntimeOverride
      ? llmProviderRegistry.list()
          .filter((provider) => provider.isConfigured())
          .map((provider) => ({
            id: provider.id,
            name: provider.id,
            isDefault: provider.id === defaultProviderId,
            models: provider.defaultModels.map((model) => ({
              id: model.id,
              name: model.name,
              contextWindow: model.contextWindow,
              tags: model.tags,
              isDefault: provider.id === defaultProviderId && model.id === defaultModelId,
            })),
          }))
      : []

    return NextResponse.json({
      agentId,
      allowRuntimeOverride,
      defaultProviderId,
      defaultModelId,
      providers,
    })
  } catch (error) {
    console.error('[AI Agents Models] GET error:', error)
    return NextResponse.json({ error: 'Failed to resolve agent models.' }, { status: 500 })
  }
}
