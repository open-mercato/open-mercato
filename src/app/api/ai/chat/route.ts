import { NextResponse, type NextRequest } from 'next/server'
import { streamText } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-sdk'
import { createOpenAI, createAnthropic, createGoogleGenerativeAI } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-sdk'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { bootstrap } from '@/bootstrap'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  resolveChatConfig,
  isProviderConfigured,
  CHAT_PROVIDERS,
  type ChatProviderId,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/chat-config'

bootstrap()

function buildSystemPrompt(context: {
  path?: string
  module?: string | null
  entityType?: string | null
  recordId?: string | null
} | null): string {
  const parts: string[] = [
    'You are an AI assistant for Open Mercato, a B2B commerce and ERP platform.',
    '',
    'You help users manage customers, products, sales orders, and other business operations.',
    '',
  ]

  if (context) {
    parts.push('## Current Context')
    if (context.path) parts.push(`- Page: ${context.path}`)
    if (context.module) parts.push(`- Module: ${context.module}`)
    if (context.entityType) parts.push(`- Entity Type: ${context.entityType}`)
    if (context.recordId) parts.push(`- Record ID: ${context.recordId}`)
    parts.push('')
  }

  parts.push('## Guidelines')
  parts.push('- Be concise and helpful')
  parts.push('- If a request is ambiguous, ask for clarification')

  return parts.join('\n')
}

function createModelClient(providerId: ChatProviderId, modelId: string) {
  switch (providerId) {
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
      const openai = createOpenAI({ apiKey })
      return openai(modelId)
    }
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
      const anthropic = createAnthropic({ apiKey })
      return anthropic(modelId)
    }
    case 'google': {
      const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
      if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not configured')
      const google = createGoogleGenerativeAI({ apiKey })
      return google(modelId)
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
    const { messages, context } = body

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages array is required' }, { status: 400 })
    }

    // Create container for config resolution
    const container = await createRequestContainer()

    // Verify user has access
    const rbacService = container.resolve<RbacService>('rbacService')
    await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })

    // Get chat configuration
    let config = await resolveChatConfig(container)

    // If no config saved, use default from first configured provider
    if (!config) {
      // Find first configured provider
      const providers: ChatProviderId[] = ['openai', 'anthropic', 'google']
      const configuredProvider = providers.find((p) => isProviderConfigured(p))

      if (!configuredProvider) {
        return NextResponse.json(
          { error: 'No AI provider configured. Please set an API key for OpenAI, Anthropic, or Google.' },
          { status: 503 }
        )
      }

      const providerInfo = CHAT_PROVIDERS[configuredProvider]
      config = {
        providerId: configuredProvider,
        model: providerInfo.defaultModel,
        updatedAt: new Date().toISOString(),
      }
    }

    // Verify the configured provider is still available
    if (!isProviderConfigured(config.providerId)) {
      return NextResponse.json(
        { error: `Configured provider ${config.providerId} is no longer available. Please update settings.` },
        { status: 503 }
      )
    }

    // Build system prompt with context
    const systemPrompt = buildSystemPrompt(context)

    // Create model client based on config
    const model = createModelClient(config.providerId, config.model)

    // Stream the response
    const result = streamText({
      model,
      system: systemPrompt,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    })

    // Return as text stream
    return result.toTextStreamResponse()
  } catch (error) {
    console.error('[AI Chat] Error:', error)
    return NextResponse.json(
      { error: 'Chat request failed' },
      { status: 500 }
    )
  }
}
