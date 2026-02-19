import { generateObject } from 'ai'
import {
  resolveFirstConfiguredOpenCodeProvider,
  resolveOpenCodeModel,
  resolveOpenCodeProviderApiKey,
  resolveOpenCodeProviderId,
  type OpenCodeProviderId,
} from '@open-mercato/shared/lib/ai/opencode-provider'
import { extractionOutputSchema } from '../data/validators'

export function resolveExtractionProviderId(): OpenCodeProviderId {
  const configuredProvider = process.env.OPENCODE_PROVIDER
  if (configuredProvider && configuredProvider.trim().length > 0) {
    return resolveOpenCodeProviderId(configuredProvider)
  }

  const firstConfiguredProvider = resolveFirstConfiguredOpenCodeProvider()
  if (firstConfiguredProvider) {
    return firstConfiguredProvider
  }

  return resolveOpenCodeProviderId(undefined)
}

async function createStructuredModel(
  providerId: OpenCodeProviderId,
  apiKey: string,
  modelId: string,
): Promise<Parameters<typeof generateObject>[0]['model']> {
  switch (providerId) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({ apiKey })(modelId) as unknown as Parameters<typeof generateObject>[0]['model']
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({ apiKey })(modelId) as unknown as Parameters<typeof generateObject>[0]['model']
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return createGoogleGenerativeAI({ apiKey })(modelId) as unknown as Parameters<typeof generateObject>[0]['model']
    }
    default:
      throw new Error(`Unsupported provider: ${providerId}`)
  }
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })

  try {
    return await Promise.race([operation, timeoutPromise])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

export async function runExtractionWithConfiguredProvider(input: {
  systemPrompt: string
  userPrompt: string
  modelOverride?: string | null
  timeoutMs: number
}): Promise<{
  object: ReturnType<typeof extractionOutputSchema.parse>
  totalTokens: number
  modelWithProvider: string
}> {
  const providerId = resolveExtractionProviderId()
  const apiKey = resolveOpenCodeProviderApiKey(providerId)
  if (!apiKey) {
    throw new Error(`Missing API key for provider "${providerId}"`)
  }

  const modelConfig = resolveOpenCodeModel(providerId, {
    overrideModel: input.modelOverride,
  })
  const model = await createStructuredModel(providerId, apiKey, modelConfig.modelId)

  const result = await withTimeout(
    generateObject({
      model,
      schema: extractionOutputSchema,
      system: input.systemPrompt,
      prompt: input.userPrompt,
      temperature: 0,
    }),
    input.timeoutMs,
    `LLM extraction timed out after ${input.timeoutMs}ms`,
  )

  return {
    object: result.object,
    totalTokens: Number(result.usage?.totalTokens ?? 0) || 0,
    modelWithProvider: modelConfig.modelWithProvider,
  }
}
