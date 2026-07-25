import { generateObject } from 'ai'
import type { AwilixContainer } from 'awilix'
import { createContainer } from 'awilix'
import {
  resolveAiProviderIdFromEnv,
  resolveFirstConfiguredOpenCodeProvider,
  resolveOpenCodeModel,
  requireOpenCodeProviderApiKey,
  resolveOpenCodeProviderId,
  isOpenCodeProviderId,
  type OpenCodeProviderId,
} from '@open-mercato/shared/lib/ai/opencode-provider'
import {
  AiModelFactoryError,
  createModelFactory,
  type AiModelFactory,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import { joinProviderModel } from '@open-mercato/shared/lib/ai/model-id'
import { extractionOutputSchema } from '../data/validators'

// Vercel AI SDK provider factories return LanguageModelV1 but generateObject()
// expects a narrower LanguageModel union. The types are structurally compatible
// at runtime; the cast is required until the AI SDK unifies its model types.
type AiModel = Parameters<typeof generateObject>[0]['model']
function asAiModel(model: unknown): AiModel {
  return model as AiModel
}

/**
 * Step 5.1 — thin backward-compatibility shim. The public surface of this
 * module (`resolveExtractionProviderId`, `createStructuredModel`,
 * `withTimeout`, `runExtractionWithConfiguredProvider`) is unchanged so
 * `ai-tools.ts`, `translationProvider.ts`, and `extractionWorker.ts` continue
 * to compile and pass their existing tests.
 *
 * The model-instantiation path inside {@link runExtractionWithConfiguredProvider}
 * now delegates to the shared {@link createModelFactory} so every
 * AI-runtime caller shares one resolution order. The legacy
 * `OPENCODE_MODEL` / `OPENCODE_PROVIDER` envs remain honored via
 * {@link resolveExtractionProviderId} and {@link resolveOpenCodeModel} so
 * inbox_ops deployments do not see a behavior change — the factory is
 * consulted first (honoring `OM_AI_INBOX_OPS_MODEL` — legacy `INBOX_OPS_AI_MODEL` — + `input.modelOverride`),
 * with the legacy path as the fallback when no registry provider is
 * configured (preserving the historical error messages).
 */

export function resolveExtractionProviderId(): OpenCodeProviderId {
  // Honors OM_AI_PROVIDER first, then the legacy OPENCODE_PROVIDER, then the
  // first configured provider from `OPEN_CODE_PROVIDER_IDS`, then the unified
  // default (currently `openai`). Mirrors the precedence applied by the
  // shared model factory so the BC fallback path stays consistent.
  // This resolver only runs on the legacy fallback path (the unified factory
  // already threw `no_provider_configured`). If the operator explicitly set the
  // canonical OM_AI_PROVIDER to a provider the native-only switch cannot serve
  // (e.g. a gateway like `openrouter`), fail loudly with a descriptive error
  // instead of silently coercing to `openai` via resolveAiProviderIdFromEnv —
  // reaching here means that provider is also not configured for the factory.
  const canonicalProvider = (process.env.OM_AI_PROVIDER ?? '').trim()
  if (canonicalProvider.length > 0 && !isOpenCodeProviderId(canonicalProvider.toLowerCase())) {
    throw new Error(
      `[internal] OM_AI_PROVIDER="${canonicalProvider}" is set but that provider is not configured ` +
        `(no API key found), and the legacy inbox_ops extraction fallback only supports ` +
        `anthropic, openai, or google. Set the provider's API key (e.g. OPENROUTER_API_KEY for ` +
        `openrouter) so the unified model factory can serve it, or switch OM_AI_PROVIDER to a ` +
        `configured native provider.`,
    )
  }

  const explicit = (canonicalProvider || (process.env.OPENCODE_PROVIDER ?? '').trim())
  if (explicit.length > 0) {
    return resolveAiProviderIdFromEnv(process.env)
  }

  const firstConfiguredProvider = resolveFirstConfiguredOpenCodeProvider()
  if (firstConfiguredProvider) {
    return firstConfiguredProvider
  }

  return resolveOpenCodeProviderId(undefined)
}

export async function createStructuredModel(
  providerId: OpenCodeProviderId,
  apiKey: string,
  modelId: string,
): Promise<AiModel> {
  switch (providerId) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return asAiModel(createAnthropic({ apiKey })(modelId))
    }
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return asAiModel(createOpenAI({ apiKey })(modelId))
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
      return asAiModel(createGoogleGenerativeAI({ apiKey })(modelId))
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

/**
 * Test-only seam for the factory-delegation regression suite. Production
 * callers MUST use {@link runExtractionWithConfiguredProvider} directly; the
 * suite overrides this binding via `jest.spyOn` to assert the shim actually
 * reaches `createModelFactory` without stubbing `@open-mercato/ai-assistant`.
 */
export const __inboxOpsLlmProviderInternal = {
  createModelFactory,
  createContainer,
}

function tryFactoryResolution(input: {
  moduleId?: string
  modelOverride?: string | null
}): { model: AiModel; modelWithProvider: string } | null {
  let factory: AiModelFactory
  try {
    const container = __inboxOpsLlmProviderInternal.createContainer()
    factory = __inboxOpsLlmProviderInternal.createModelFactory(container as AwilixContainer)
  } catch {
    return null
  }
  try {
    const resolution = factory.resolveModel({
      moduleId: input.moduleId ?? 'inbox_ops',
      callerOverride: input.modelOverride ?? undefined,
    })
    // Use the factory's real provider id (e.g. `openrouter`) for the label so a
    // gateway resolution reads `openrouter/anthropic/claude-…` (single prefix),
    // not a native-coerced `anthropic/…`.
    return {
      model: asAiModel(resolution.model),
      modelWithProvider: joinProviderModel(resolution.providerId, resolution.modelId),
    }
  } catch (err) {
    if (err instanceof AiModelFactoryError) {
      // Fall back to the legacy path so the shim keeps throwing the original
      // OPENCODE_*-era error messages existing tests/consumers rely on.
      return null
    }
    throw err
  }
}

/**
 * Resolves a concrete structured-output AI SDK model for inbox_ops, factory-first.
 *
 * The unified {@link createModelFactory} is consulted first — so every inbox_ops
 * LLM call site (extraction, categorize, translation) shares one resolution order
 * and gains gateway support (OpenRouter, Requesty, LiteLLM). The native-only
 * {@link createStructuredModel} switch is used only as the true no-provider BC
 * fallback, when the factory throws `AiModelFactoryError('no_provider_configured')`.
 */
export async function resolveConfiguredStructuredModel(input: {
  moduleId?: string
  modelOverride?: string | null
} = {}): Promise<{ model: AiModel; modelWithProvider: string }> {
  const fromFactory = tryFactoryResolution(input)
  if (fromFactory) return fromFactory

  // BC: Legacy OPENCODE_PROVIDER / OPENCODE_MODEL path. Only runs when the
  // factory reported no configured provider, meaning none of the new-style
  // provider env vars is set. The OPENCODE_* envs stay BC fallbacks scoped to
  // the OpenCode Code Mode stack (spec 2026-04-27-…, R1 mitigation).
  const providerId = resolveExtractionProviderId()
  const apiKey = requireOpenCodeProviderApiKey(providerId)
  const modelConfig = resolveOpenCodeModel(providerId, {
    overrideModel: input.modelOverride,
  })
  const model = await createStructuredModel(providerId, apiKey, modelConfig.modelId)
  return { model, modelWithProvider: modelConfig.modelWithProvider }
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
  const { model, modelWithProvider } = await resolveConfiguredStructuredModel({
    moduleId: 'inbox_ops',
    modelOverride: input.modelOverride,
  })

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
    modelWithProvider,
  }
}
