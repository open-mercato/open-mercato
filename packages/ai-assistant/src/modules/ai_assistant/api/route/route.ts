import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { generateObject } from '../../lib/ai-sdk'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import {
  resolveAiProviderIdFromEnv,
  resolveOpenCodeModel,
} from '@open-mercato/shared/lib/ai/opencode-provider'
import {
  resolveChatConfig,
  isProviderConfigured,
  type ChatProviderId,
} from '../../lib/chat-config'

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'AI query routing',
  methods: {
    POST: { summary: 'Route user query to appropriate AI handler' },
  },
}

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

const RouteResultSchema = z.object({
  intent: z.enum(['tool', 'general_chat']),
  toolName: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

function createRoutingModel(providerId: ChatProviderId, configuredModel?: string) {
  const provider = llmProviderRegistry.get(providerId)
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`)
  }

  // resolveOpenCodeModel is still used for token parsing and provider-prefix
  // validation (`openai/gpt-5-mini` vs `anthropic/claude-…`). It falls back
  // to the provider's defaultModel via the opencode-provider facade, which
  // is only populated for the three native providers — if the registry
  // returns a preset-based provider whose id is unknown to opencode-provider,
  // we short-circuit and use the provider's own defaultModel.
  let modelId: string
  let modelWithProvider: string
  try {
    const resolved = resolveOpenCodeModel(providerId as 'anthropic' | 'openai' | 'google', {
      overrideModel: configuredModel,
    })
    modelId = resolved.modelId
    modelWithProvider = resolved.modelWithProvider
  } catch {
    // Preset-based provider or unknown id — fall back to the provider's own
    // model list. The explicit override (if any) wins.
    const requested = (configuredModel ?? '').trim()
    modelId = requested.length > 0 ? requested : provider.defaultModel
    modelWithProvider = `${providerId}/${modelId}`
  }

  const apiKey = provider.resolveApiKey()
  if (!apiKey) {
    const envKey = provider.getConfiguredEnvKey()
    throw new Error(`${envKey} not configured for provider "${providerId}"`)
  }

  const model = provider.createModel({ modelId, apiKey }) as unknown as Parameters<
    typeof generateObject
  >[0]['model']
  return { model, modelWithProvider }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { query, availableTools } = body as {
      query: string
      availableTools: Array<{ name: string; description: string }>
    }

    console.log('[AI Route] Routing query:', query)
    console.log('[AI Route] Available tools count:', availableTools?.length)

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'query is required' }, { status: 400 })
    }

    if (!availableTools || !Array.isArray(availableTools)) {
      return NextResponse.json({ error: 'availableTools array is required' }, { status: 400 })
    }

    // Get user's configured provider
    const container = await createRequestContainer()
    let config = await resolveChatConfig(container)

    // Fallback to first configured provider from the LLM provider registry.
    // Honors the operator-selected provider via OM_AI_PROVIDER (with the
    // legacy OPENCODE_PROVIDER as the BC fallback) and only then walks the
    // native adapters before any OpenAI-compatible presets so a deployment
    // that just sets OPENAI_API_KEY still resolves to OpenAI by default.
    if (!config) {
      const operatorPreferred = resolveAiProviderIdFromEnv(process.env)
      const baseOrder: ChatProviderId[] = ['openai', 'anthropic', 'google']
      const order = [
        operatorPreferred,
        ...baseOrder.filter((id) => id !== operatorPreferred),
      ]
      const picked = llmProviderRegistry.resolveFirstConfigured({ order })
      if (!picked) {
        return NextResponse.json(
          {
            error:
              'No AI provider configured. Please set an API key for one of the registered providers (Anthropic, OpenAI, Google, DeepInfra, Groq, …).',
          },
          { status: 503 },
        )
      }
      config = { providerId: picked.id, model: '', updatedAt: '' }
    }

    console.log('[AI Route] Using provider:', config.providerId)

    // Verify the configured provider is still available
    if (!isProviderConfigured(config.providerId)) {
      return NextResponse.json(
        { error: `Configured provider ${config.providerId} is no longer available. Please update settings.` },
        { status: 503 }
      )
    }

    // Use fast model for the configured provider
    const { model, modelWithProvider } = createRoutingModel(config.providerId, config.model)

    const toolList = availableTools
      .map((t) => `- ${t.name}: ${t.description}`)
      .join('\n')

    console.log('[AI Route] Calling generateObject with', modelWithProvider)

    const result = await generateObject({
      model,
      schema: RouteResultSchema,
      prompt: `You are a routing assistant. Given a user query, determine if they want to use a specific tool or have a general conversation.

Available tools:
${toolList}

User query: "${query}"

Respond with:
- intent: "tool" if user wants to perform an action with a specific tool, "general_chat" otherwise
- toolName: the exact tool name if intent is "tool"
- confidence: 0-1 how confident you are
- reasoning: brief explanation`,
    })

    console.log('[AI Route] Result:', result.object)
    return NextResponse.json(result.object)
  } catch (error) {
    console.error('[AI Route] Error routing query:', error)
    return NextResponse.json(
      { error: 'Routing request failed' },
      { status: 500 }
    )
  }
}
