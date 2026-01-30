import { NextResponse, type NextRequest } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

// Provider information with their API key environment variable names
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    defaultModel: 'claude-haiku-4-5-20251001',
    envKeys: ['ANTHROPIC_API_KEY'],
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    envKeys: ['OPENAI_API_KEY'],
  },
  google: {
    name: 'Google',
    defaultModel: 'gemini-3-flash',
    envKeys: ['GOOGLE_GENERATIVE_AI_API_KEY'],
  },
} as const

/**
 * Check if any of the given env keys are configured
 */
function isProviderConfigured(envKeys: readonly string[]): boolean {
  return envKeys.some(key => !!process.env[key]?.trim())
}

/**
 * Get the first configured env key name for display
 */
function getConfiguredEnvKey(envKeys: readonly string[]): string {
  return envKeys.find(key => !!process.env[key]?.trim()) ?? envKeys[0]
}

type ProviderId = keyof typeof PROVIDERS

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
    // Read provider config from environment
    const providerId = (process.env.OPENCODE_PROVIDER || 'anthropic') as ProviderId
    const providerInfo = PROVIDERS[providerId] || PROVIDERS.anthropic

    // Check if the provider's API key is configured (supports multiple fallback keys)
    const apiKeyConfigured = isProviderConfigured(providerInfo.envKeys)

    // Get model (custom or default)
    const customModel = process.env.OPENCODE_MODEL
    const model = customModel || `${providerId}/${providerInfo.defaultModel}`

    // Show the env key that's configured, or the first one as instruction
    const displayEnvKey = getConfiguredEnvKey(providerInfo.envKeys)

    // Check if MCP_SERVER_API_KEY is configured (required for MCP authentication)
    const mcpKeyConfigured = !!process.env.MCP_SERVER_API_KEY?.trim()

    return NextResponse.json({
      provider: {
        id: providerId,
        name: providerInfo.name,
        model,
        defaultModel: providerInfo.defaultModel,
        envKey: displayEnvKey,
        configured: apiKeyConfigured,
      },
      availableProviders: Object.entries(PROVIDERS).map(([id, info]) => ({
        id,
        name: info.name,
        defaultModel: info.defaultModel,
        envKey: getConfiguredEnvKey(info.envKeys),
        configured: isProviderConfigured(info.envKeys),
      })),
      mcpKeyConfigured,
    })
  } catch (error) {
    console.error('[AI Settings] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}
