import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  resolveChatConfig,
  saveChatConfig,
  getConfiguredProviders,
  CHAT_PROVIDERS,
  type ChatProviderId,
  type ChatProviderConfig,
} from '../../lib/chat-config'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
  POST: { requireAuth: true, requireFeatures: ['ai_assistant.settings.manage'] },
}

const updateSchema = z.object({
  providerId: z.enum(['openai', 'anthropic', 'google']),
  model: z.string(),
})

type SettingsResponse = {
  config: ChatProviderConfig | null
  configuredProviders: ChatProviderId[]
  providers: typeof CHAT_PROVIDERS
}

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()

  try {
    const config = await resolveChatConfig(container)
    const configuredProviders = getConfiguredProviders()

    const response: SettingsResponse = {
      config,
      configuredProviders,
      providers: CHAT_PROVIDERS,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[AI Settings] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()

  try {
    const body = await req.json()
    const parsed = updateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.issues },
        { status: 400 }
      )
    }

    const { providerId, model } = parsed.data

    // Validate provider is configured
    const configuredProviders = getConfiguredProviders()
    if (!configuredProviders.includes(providerId)) {
      return NextResponse.json(
        { error: `Provider ${providerId} is not configured. Please set the required API key.` },
        { status: 400 }
      )
    }

    // Validate model exists for provider
    const providerInfo = CHAT_PROVIDERS[providerId]
    const modelExists = providerInfo.models.some((m) => m.id === model)
    if (!modelExists) {
      return NextResponse.json(
        { error: `Model ${model} is not valid for provider ${providerId}` },
        { status: 400 }
      )
    }

    // Save configuration
    const savedConfig = await saveChatConfig(container, { providerId, model })

    return NextResponse.json({
      success: true,
      config: savedConfig,
    })
  } catch (error) {
    console.error('[AI Settings] POST error:', error)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
