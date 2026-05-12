import { NextResponse, type NextRequest } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  OPEN_CODE_PROVIDER_IDS,
  OPEN_CODE_PROVIDERS,
  getOpenCodeProviderConfiguredEnvKey,
  isOpenCodeProviderConfigured,
  resolveAiProviderIdFromEnv,
  resolveOpenCodeModel,
} from '@open-mercato/shared/lib/ai/opencode-provider'

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'AI assistant settings',
  methods: {
    GET: { summary: 'Get AI provider configuration' },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

/**
 * GET /api/ai_assistant/settings
 *
 * Returns the current OpenCode provider configuration from environment variables.
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Read provider config from environment. `OM_AI_PROVIDER` is the new
    // canonical variable; `OPENCODE_PROVIDER` is kept as a BC fallback by
    // `resolveAiProviderIdFromEnv`. Falls back to the unified default
    // (`openai`) when neither is set.
    const providerId = resolveAiProviderIdFromEnv(process.env)
    const providerInfo = OPEN_CODE_PROVIDERS[providerId]

    // Check if the provider's API key is configured (supports multiple fallback keys)
    const apiKeyConfigured = isOpenCodeProviderConfigured(providerId)

    // Get model (custom or default)
    const resolvedModel = resolveOpenCodeModel(providerId)

    // Show the env key that's configured, or the first one as instruction
    const displayEnvKey = getOpenCodeProviderConfiguredEnvKey(providerId)

    // Check if MCP_SERVER_API_KEY is configured (required for MCP authentication)
    const mcpKeyConfigured = !!process.env.MCP_SERVER_API_KEY?.trim()

    return NextResponse.json({
      provider: {
        id: providerId,
        name: providerInfo.name,
        model: resolvedModel.modelWithProvider,
        defaultModel: providerInfo.defaultModel,
        envKey: displayEnvKey,
        configured: apiKeyConfigured,
      },
      availableProviders: OPEN_CODE_PROVIDER_IDS.map((id) => {
        const info = OPEN_CODE_PROVIDERS[id]
        return {
          id,
          name: info.name,
          defaultModel: info.defaultModel,
          envKey: getOpenCodeProviderConfiguredEnvKey(id),
          configured: isOpenCodeProviderConfigured(id),
        }
      }),
      mcpKeyConfigured,
    })
  } catch (error) {
    console.error('[AI Settings] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}
