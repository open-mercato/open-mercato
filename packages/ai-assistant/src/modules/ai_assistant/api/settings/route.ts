import { NextResponse, type NextRequest } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
}

// Provider information
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    defaultModel: 'claude-haiku-4-5-20251001',
    envKey: 'OPENCODE_ANTHROPIC_API_KEY',
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    envKey: 'OPENCODE_OPENAI_API_KEY',
  },
  google: {
    name: 'Google',
    defaultModel: 'gemini-2.0-flash',
    envKey: 'OPENCODE_GOOGLE_API_KEY',
  },
} as const

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

    // Check if the provider's API key is configured
    const apiKeyConfigured = !!process.env[providerInfo.envKey]

    // Get model (custom or default)
    const customModel = process.env.OPENCODE_MODEL
    const model = customModel || `${providerId}/${providerInfo.defaultModel}`

    return NextResponse.json({
      provider: {
        id: providerId,
        name: providerInfo.name,
        model,
        defaultModel: providerInfo.defaultModel,
        envKey: providerInfo.envKey,
        configured: apiKeyConfigured,
      },
      availableProviders: Object.entries(PROVIDERS).map(([id, info]) => ({
        id,
        name: info.name,
        defaultModel: info.defaultModel,
        envKey: info.envKey,
        configured: !!process.env[info.envKey],
      })),
    })
  } catch (error) {
    console.error('[AI Settings] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}
