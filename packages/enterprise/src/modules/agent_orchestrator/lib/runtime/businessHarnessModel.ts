import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createModelFactory } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory'
import { OPENAI_COMPATIBLE_PRESETS } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/openai-compatible-presets'
import { AiAgentRuntimeOverrideRepository } from '@open-mercato/ai-assistant/modules/ai_assistant/data/repositories/AiAgentRuntimeOverrideRepository'
import { AiTenantModelAllowlistRepository } from '@open-mercato/ai-assistant/modules/ai_assistant/data/repositories/AiTenantModelAllowlistRepository'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import type { AwilixContainer } from 'awilix'
import type { AgentRegistryEntry } from '../sdk/defineAgent'
import type { AgentRunCtx } from './persistence'
import type { BusinessHarnessModelBinding, BusinessHarnessModelDriver } from './businessHarnessContracts'

export class BusinessHarnessModelConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BusinessHarnessModelConfigurationError'
  }
}

export type ResolvedBusinessHarnessModel = {
  binding: BusinessHarnessModelBinding
  providerId: string
  credentialAudience: string
  loopOverride: {
    disabled: boolean
    maxSteps?: number
    maxToolCalls?: number
    maxWallClockMs?: number
  }
}

export async function resolveBusinessHarnessModel(
  container: AwilixContainer,
  entry: AgentRegistryEntry,
  ctx: AgentRunCtx,
): Promise<ResolvedBusinessHarnessModel> {
  const em = container.resolve<EntityManager>('em')
  const runtimeOverrideRepo = new AiAgentRuntimeOverrideRepository(em)
  const allowlistRepo = new AiTenantModelAllowlistRepository(em)
  const [runtimeOverride, tenantAllowlist] = await Promise.all([
    runtimeOverrideRepo.getDefault({
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      agentId: entry.id,
    }),
    allowlistRepo.getSnapshot({
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    }),
  ])

  const resolution = createModelFactory(container).resolveModel({
    moduleId: entry.moduleId,
    agentDefaultModel: entry.defaultModel,
    agentDefaultProvider: entry.defaultProvider,
    tenantOverride: runtimeOverride
      ? {
          providerId: runtimeOverride.providerId ?? null,
          modelId: runtimeOverride.modelId ?? null,
          baseURL: runtimeOverride.baseUrl ?? null,
        }
      : undefined,
    tenantAllowlist,
  })

  const provider = llmProviderRegistry.get(resolution.providerId)
  if (!provider) {
    throw new BusinessHarnessModelConfigurationError(
      `Resolved provider "${resolution.providerId}" is not registered in Open Mercato`,
    )
  }
  if (!provider.resolveApiKey(process.env)) {
    throw new BusinessHarnessModelConfigurationError(
      `Resolved provider "${resolution.providerId}" has no credential in Open Mercato`,
    )
  }

  const driver = resolveDriver(resolution.providerId, resolution.baseURL)
  const baseUrl = resolveCompatibleBaseUrl(resolution.providerId, resolution.baseURL)
  if (driver === 'openai-compatible' && !baseUrl) {
    throw new BusinessHarnessModelConfigurationError(
      `OpenAI-compatible provider "${resolution.providerId}" has no base URL configured`,
    )
  }
  if (driver === 'anthropic' && resolution.baseURL) {
    throw new BusinessHarnessModelConfigurationError(
      'Anthropic proxy base URLs are not supported by business-harness protocol v1',
    )
  }

  const revision = sha256(
    stableJson({
      providerId: resolution.providerId,
      modelId: resolution.modelId,
      driver,
      baseUrl: baseUrl ?? null,
      overrideUpdatedAt: runtimeOverride?.updatedAt?.toISOString() ?? null,
    }),
  )
  const credentialBindingId = `om-env-provider:${resolution.providerId}`
  const binding: BusinessHarnessModelBinding = {
    bindingId: `om-model:${resolution.providerId}:${revision.slice(0, 16)}`,
    bindingRevision: revision,
    driver,
    modelId: resolution.modelId,
    credentialBindingId,
    ...(baseUrl ? { baseUrl } : {}),
  }
  return {
    binding,
    providerId: resolution.providerId,
    credentialAudience: `model:${driver}`,
    loopOverride: {
      disabled: runtimeOverride?.loopDisabled === true,
      ...(runtimeOverride?.loopMaxSteps != null ? { maxSteps: runtimeOverride.loopMaxSteps } : {}),
      ...(runtimeOverride?.loopMaxToolCalls != null
        ? { maxToolCalls: runtimeOverride.loopMaxToolCalls }
        : {}),
      ...(runtimeOverride?.loopMaxWallClockMs != null
        ? { maxWallClockMs: runtimeOverride.loopMaxWallClockMs }
        : {}),
    },
  }
}

function resolveDriver(providerId: string, explicitBaseUrl?: string): BusinessHarnessModelDriver {
  if (providerId === 'anthropic') return 'anthropic'
  if (providerId === 'openai' && !explicitBaseUrl) return 'openai'
  if (OPENAI_COMPATIBLE_PRESETS.some((preset) => preset.id === providerId)) {
    return 'openai-compatible'
  }
  throw new BusinessHarnessModelConfigurationError(
    `Provider "${providerId}" is not supported by business-harness protocol v1`,
  )
}

function resolveCompatibleBaseUrl(providerId: string, explicitBaseUrl?: string): string | undefined {
  if (providerId === 'anthropic') return undefined
  if (explicitBaseUrl) return explicitBaseUrl
  if (providerId === 'openai') return undefined
  const preset = OPENAI_COMPATIBLE_PRESETS.find((candidate) => candidate.id === providerId)
  if (!preset) return undefined
  for (const envKey of preset.baseURLEnvKeys ?? []) {
    const value = process.env[envKey]?.trim()
    if (value) return value
  }
  return preset.baseURL
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
