import { NextResponse, type NextRequest } from 'next/server'
import { streamText, stepCountIs } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-sdk'
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
import { InProcessMcpClient } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/in-process-client'
import { convertMcpToolsToAiSdk } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/mcp-tool-adapter'
import { createToolSearchService } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-loader'
import { discoverTools } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-discovery'
import { getToolRegistry } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-registry'
import type { SearchService } from '@open-mercato/search/service'

bootstrap()

type ChatMode = 'default' | 'agentic'

// Tools that are safe to auto-execute without user confirmation
const SAFE_TOOL_PATTERNS = [
  /^search_/,      // search_query, search_schema, search_get, search_aggregate, search_status
  /^get_/,         // get_ operations are read-only
  /^list_/,        // list_ operations are read-only
  /^view_/,        // view_ operations are read-only
  /^context_/,     // context_whoami etc.
  /_get$/,         // tools ending with _get
  /_list$/,        // tools ending with _list
  /_status$/,      // tools ending with _status
  /_schema$/,      // tools ending with _schema
]

// Tools that should always require confirmation
const DANGEROUS_TOOL_PATTERNS = [
  /^delete_/,
  /^remove_/,
  /_delete$/,
  /_remove$/,
  /^reindex_/,
  /_reindex$/,
]

function isToolSafeToAutoExecute(toolName: string): boolean {
  // First check if it's a dangerous tool
  if (DANGEROUS_TOOL_PATTERNS.some(p => p.test(toolName))) {
    return false
  }
  // Then check if it matches safe patterns
  return SAFE_TOOL_PATTERNS.some(p => p.test(toolName))
}

function buildSystemPrompt(
  context: {
    path?: string
    module?: string | null
    entityType?: string | null
    recordId?: string | null
  } | null,
  availableEntities: string[] | null,
  toolsAvailable: boolean
): string {
  const parts: string[] = [
    'You are an AI assistant for Open Mercato, a B2B commerce and ERP platform.',
    '',
    'You help users manage customers, products, sales orders, and other business operations.',
    '',
  ]

  // Include available entity types from search schema
  if (availableEntities && availableEntities.length > 0) {
    parts.push('## Available Entity Types')
    parts.push('IMPORTANT: These are the ONLY valid entity types in this system. Always use these exact names:')
    for (const et of availableEntities.sort()) {
      parts.push(`- ${et}`)
    }
    parts.push('')
    parts.push('When a user mentions "companies", "customers", "deals", etc., match to the closest entity type from this list.')
    parts.push('')
  }

  if (context) {
    parts.push('## Current Context')
    if (context.path) parts.push(`- Page: ${context.path}`)
    if (context.module) parts.push(`- Module: ${context.module}`)
    if (context.entityType) parts.push(`- Entity Type: ${context.entityType}`)
    if (context.recordId) parts.push(`- Record ID: ${context.recordId}`)
    parts.push('')
  }

  parts.push('## Guidelines')
  parts.push('- Be concise and action-oriented')
  parts.push('- Prefer taking action over asking questions')
  parts.push('- Only ask for clarification when there are multiple valid interpretations')

  if (toolsAvailable) {
    parts.push('')
    parts.push('## Tools')
    parts.push('You have access to many tools that can help you perform actions in the system.')
    parts.push('Use them when the user asks to search, create, update, delete, or retrieve data.')
    parts.push('You can use ANY tool that matches the user\'s request - you are not limited to a single tool.')
    parts.push('')
    parts.push('### Important Instructions')
    parts.push('- BE PROACTIVE: Infer parameter values from the user\'s request whenever possible')
    parts.push('- DO NOT ask for clarification if you can make a reasonable assumption')
    parts.push('- CRITICAL: Use ONLY entity types from the "Available Entity Types" list above. Never guess or invent entity types.')
    parts.push('- Map user terms to available entities: "companies" might be "customers:customer_company_profile", "deals" might be "customers:customer_deal", etc.')
    parts.push('- For counting/aggregation queries, use a simple field like "status" or "_id" as groupBy')
    parts.push('- For search queries, extract the search terms directly from the user\'s message')
    parts.push('- Only ask for clarification when absolutely necessary')
    parts.push('')
    parts.push('### Tool Usage Guidelines')
    parts.push('- context_whoami: Returns AUTH context (userId, tenantId, permissions). Does NOT return company/organization data.')
    parts.push('- To get company/organization details, use search_get with the appropriate entity type (e.g., "customers:customer_company_profile")')
    parts.push('- To count records, use search_aggregate with groupBy on a field like "_id" or "status"')
    parts.push('- Chain multiple tool calls if needed to gather complete information')
    parts.push('')
    parts.push('### Response Format')
    parts.push('- ALWAYS provide a text response after using tools - never end with just a tool call')
    parts.push('- ALWAYS respond in natural, human-friendly language')
    parts.push('- NEVER show raw JSON or code blocks to the user')
    parts.push('- Interpret tool results and summarize them conversationally')
    parts.push('- Example: Instead of showing {"name": "Acme Corp"}, say "Your company name is Acme Corp"')
    parts.push('- If a tool returns an error, explain it simply without technical details')
    parts.push('')
    parts.push('Call tools as needed, then ALWAYS provide a clear text response to the user.')
  }

  return parts.join('\n')
}

function createModelClient(providerId: ChatProviderId, modelId: string): Parameters<typeof streamText>[0]['model'] {
  switch (providerId) {
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
      const openai = createOpenAI({ apiKey })
      return openai(modelId) as unknown as Parameters<typeof streamText>[0]['model']
    }
    case 'anthropic': {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')
      const anthropic = createAnthropic({ apiKey })
      return anthropic(modelId) as unknown as Parameters<typeof streamText>[0]['model']
    }
    case 'google': {
      const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
      if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not configured')
      const google = createGoogleGenerativeAI({ apiKey })
      return google(modelId) as unknown as Parameters<typeof streamText>[0]['model']
    }
    default:
      throw new Error(`Unknown provider: ${providerId}`)
  }
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { messages, context, authContext, availableEntities, mode = 'default', toolName } = body as {
      messages: Array<{ role: string; content: string }>
      context?: {
        path?: string
        module?: string | null
        entityType?: string | null
        recordId?: string | null
      }
      authContext?: {
        tenantId: string | null
        organizationId: string | null
        userId: string
        isSuperAdmin: boolean
        features: string[]
      }
      availableEntities?: string[]
      mode?: ChatMode
      toolName?: string
    }

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages array is required' }, { status: 400 })
    }

    // Create container for config resolution
    const container = await createRequestContainer()

    // Load user ACL
    const rbacService = container.resolve<RbacService>('rbacService')
    const acl = await rbacService.loadAcl(auth.sub, {
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

    // Create MCP client for tool access
    const mcpClient = await InProcessMcpClient.createWithAuthContext({
      container,
      authContext: {
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
        userFeatures: acl.features,
        isSuperAdmin: acl.isSuperAdmin,
      },
    })

    // Get ALL available tools from MCP
    const allMcpTools = await mcpClient.listToolsWithSchemas()

    // Use tool discovery to find relevant tools for the user's query
    let filteredMcpTools = allMcpTools
    let discoveryInfo: { tools: string[]; strategies: string[]; quality: string; timing?: number } | null = null

    try {
      // Get user's last message for discovery
      const lastUserMessage = messages.filter((m) => m.role === 'user').pop()?.content ?? ''

      if (lastUserMessage) {
        // Try to resolve search service for hybrid search
        const searchService = container.resolve<SearchService>('searchService')
        const toolSearchService = createToolSearchService(searchService)
        const toolRegistry = getToolRegistry()

        // Create tool context for discovery
        const toolContext = {
          tenantId: auth.tenantId ?? null,
          organizationId: auth.orgId ?? null,
          userId: auth.sub,
          container,
          userFeatures: acl.features,
          isSuperAdmin: acl.isSuperAdmin,
          apiKeySecret: undefined,
        }

        // Discover relevant tools using hybrid search
        const discovery = await discoverTools(
          lastUserMessage,
          toolContext,
          toolSearchService,
          toolRegistry,
          { limit: 15, includeEssential: true }
        )

        discoveryInfo = {
          tools: discovery.tools,
          strategies: discovery.strategies,
          quality: discovery.quality,
          timing: discovery.timing,
        }

        // Filter tools to only include discovered ones
        const discoveredToolSet = new Set(discovery.tools)
        filteredMcpTools = allMcpTools.filter((tool) => discoveredToolSet.has(tool.name))

        console.log(
          `[AI Chat] Tool discovery: ${filteredMcpTools.length}/${allMcpTools.length} tools selected`,
          `via ${discovery.strategies.join(',')}`,
          `quality: ${discovery.quality}`,
          `(${discovery.timing}ms)`
        )
      }
    } catch (error) {
      // If discovery fails, fall back to all tools
      console.error('[AI Chat] Tool discovery failed, using all tools:', error)
      filteredMcpTools = allMcpTools
    }

    // Convert filtered tools to AI SDK format
    const aiTools = convertMcpToolsToAiSdk(mcpClient, filteredMcpTools)
    const hasTools = Object.keys(aiTools).length > 0

    // Create model client based on config
    const model = createModelClient(config.providerId, config.model)

    // Build system prompt with discovered tools
    const systemPrompt = buildSystemPrompt(context ?? null, availableEntities ?? null, hasTools)
    console.log(
      '[AI Chat] System prompt length:', systemPrompt.length,
      'tools:', Object.keys(aiTools).length,
      'total available:', allMcpTools.length,
      discoveryInfo ? `discovery: ${discoveryInfo.quality}` : 'discovery: disabled'
    )

    // Agentic mode - SSE streaming with all tools available
    if (mode === 'agentic') {
      const encoder = new TextEncoder()
      const stream = new TransformStream()
      const writer = stream.writable.getWriter()

      // Helper to send SSE events
      const sendEvent = async (data: object) => {
        const jsonStr = JSON.stringify(data)
        const eventStr = `data: ${jsonStr}\n\n`
        if ((data as {type?: string}).type !== 'text') {
          console.log('[AI Chat] Sending SSE:', jsonStr)
        }
        await writer.write(encoder.encode(eventStr))
      }

      // Start streaming in background
      ;(async () => {
        try {
          console.log('[AI Chat] Starting agentic streamText with', Object.keys(aiTools).length, 'tools')
          // Stream with ALL tools available - AI can use any tool
          const result = streamText({
            model,
            system: systemPrompt,
            messages: messages.map((m) => ({
              role: m.role as 'user' | 'assistant' | 'system',
              content: m.content,
            })),
            tools: hasTools ? aiTools : undefined,
            stopWhen: stepCountIs(20), // Allow up to 20 agentic steps (tool calls + final response)
          })

          let partCount = 0
          let textContent = ''
          const toolCallsMap = new Map<string, { id: string; toolName: string; argsJson: string }>()

          for await (const part of result.fullStream) {
            partCount++
            const partType = (part as any).type

            if (partCount <= 20) {
              console.log('[AI Chat] Part', partCount, 'type:', partType, 'keys:', Object.keys(part))
              // Log finish reasons and tool results for debugging
              if (partType === 'finish-step' || partType === 'finish') {
                console.log('[AI Chat] Finish info:', JSON.stringify({
                  finishReason: (part as any).finishReason,
                  usage: (part as any).usage,
                }))
              }
              if (partType === 'tool-result') {
                console.log('[AI Chat] Tool result:', JSON.stringify((part as any).output)?.substring(0, 500))
              }
            }

            if (partType === 'text-delta') {
              const delta = (part as any).text ?? ''
              if (delta) {
                textContent += delta
                await sendEvent({ type: 'text', content: delta })
              }
            } else if (partType === 'tool-call') {
              console.log('[AI Chat] Tool call part:', JSON.stringify(part))
              const toolCallId = (part as any).toolCallId ?? (part as any).id
              const toolCallName = (part as any).toolName ?? (part as any).name
              const args = (part as any).args ?? (part as any).input ?? (part as any).arguments ?? {}
              console.log('[AI Chat] Tool call:', toolCallName, 'args:', JSON.stringify(args))

              // Check accumulated args if empty
              let finalArgs = args
              if (Object.keys(args).length === 0) {
                const accumulatedData = toolCallsMap.get(toolCallId)
                if (accumulatedData?.argsJson) {
                  try {
                    finalArgs = JSON.parse(accumulatedData.argsJson)
                    console.log('[AI Chat] Using accumulated args:', JSON.stringify(finalArgs))
                  } catch (e) {
                    console.error('[AI Chat] Failed to parse accumulated args')
                  }
                }
              }

              await sendEvent({
                type: 'tool-call',
                id: toolCallId,
                toolName: toolCallName,
                args: finalArgs,
              })
            } else if (partType === 'tool-input-start') {
              const toolCallId = (part as any).toolCallId
              const tName = (part as any).toolName
              toolCallsMap.set(toolCallId, { id: toolCallId, toolName: tName, argsJson: '' })
            } else if (partType === 'tool-input-delta') {
              const toolCallId = (part as any).toolCallId
              const delta = (part as any).argsTextDelta ?? (part as any).inputDelta ?? (part as any).delta ?? ''
              const existing = toolCallsMap.get(toolCallId)
              if (existing && delta) {
                existing.argsJson += delta
              }
            } else if (partType === 'tool-input-end') {
              const toolCallId = (part as any).toolCallId
              const toolData = toolCallsMap.get(toolCallId)
              if (toolData?.argsJson) {
                try {
                  const args = JSON.parse(toolData.argsJson)
                  console.log('[AI Chat] Tool input complete:', toolData.toolName, args)
                  await sendEvent({
                    type: 'tool-call',
                    id: toolData.id,
                    toolName: toolData.toolName,
                    args,
                  })
                } catch (e) {
                  console.error('[AI Chat] Failed to parse tool args:', toolData.argsJson)
                }
              }
            } else if (partType === 'tool-result') {
              // Stream tool results to client for debugging/display
              const toolCallId = (part as any).toolCallId
              const toolName = (part as any).toolName
              const output = (part as any).output
              // Enhanced logging to diagnose AI hallucination
              console.log('[AI Chat] TOOL RESULT DATA:', {
                toolName,
                toolCallId,
                outputType: typeof output,
                outputLength: typeof output === 'string' ? output.length : JSON.stringify(output)?.length,
                outputPreview: typeof output === 'string'
                  ? output.substring(0, 1000)
                  : JSON.stringify(output)?.substring(0, 1000),
              })
              await sendEvent({
                type: 'tool-result',
                id: toolCallId,
                toolName: toolName,
                result: output,
              })
            }
          }

          console.log('[AI Chat] Stream finished after', partCount, 'parts, text content length:', textContent.length)
          await sendEvent({ type: 'done' })
        } catch (error) {
          console.error('[AI Chat] Streaming error:', error)
          await sendEvent({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        } finally {
          await writer.close()
        }
      })()

      return new Response(stream.readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // Default mode - simple text stream
    const result = streamText({
      model,
      system: systemPrompt,
      messages: messages.map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      tools: hasTools ? aiTools : undefined,
    })

    return result.toTextStreamResponse()
  } catch (error) {
    console.error('[AI Chat] Error:', error)
    return NextResponse.json(
      { error: 'Chat request failed' },
      { status: 500 }
    )
  }
}
