import { NextResponse, type NextRequest } from 'next/server'
import { generateObject } from '../../lib/ai-sdk'
import {
  createOpenAI,
  createAnthropic,
  createGoogleGenerativeAI,
} from '../../lib/ai-sdk'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  resolveFirstConfiguredOpenCodeProvider,
  resolveOpenCodeModel,
  resolveOpenCodeProviderApiKey,
} from '@open-mercato/shared/lib/ai/opencode-provider'
import {
  resolveChatConfig,
  isProviderConfigured,
  type ChatProviderId,
} from '../../lib/chat-config'

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
  const { modelId, modelWithProvider } = resolveOpenCodeModel(providerId, {
    overrideModel: configuredModel,
  })
  const apiKey = resolveOpenCodeProviderApiKey(providerId)
  if (!apiKey) {
    throw new Error(`${providerId.toUpperCase()} API key not configured`)
  }

  switch (providerId) {
    case 'openai': {
      const openai = createOpenAI({ apiKey })
      return {
        model: openai(modelId) as unknown as Parameters<typeof generateObject>[0]['model'],
        modelWithProvider,
      }
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey })
      return {
        model: anthropic(modelId) as unknown as Parameters<typeof generateObject>[0]['model'],
        modelWithProvider,
      }
    }
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey })
      return {
        model: google(modelId) as unknown as Parameters<typeof generateObject>[0]['model'],
        modelWithProvider,
      }
    }
    default:
      throw new Error(`Unknown provider: ${providerId}`)
  }
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

    // Fallback to first configured provider
    if (!config) {
      const configuredProvider = resolveFirstConfiguredOpenCodeProvider()
      if (!configuredProvider) {
        return NextResponse.json(
          { error: 'No AI provider configured. Please set an API key for OpenAI, Anthropic, or Google.' },
          { status: 503 }
        )
      }
      config = { providerId: configuredProvider, model: '', updatedAt: '' }
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
