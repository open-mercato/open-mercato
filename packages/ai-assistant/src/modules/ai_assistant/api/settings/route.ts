import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import {
  OPEN_CODE_PROVIDER_IDS,
  OPEN_CODE_PROVIDERS,
  getOpenCodeProviderConfiguredEnvKey,
  isOpenCodeProviderConfigured,
  resolveAiProviderIdFromEnv,
  resolveOpenCodeModel,
} from '@open-mercato/shared/lib/ai/opencode-provider'
import { AiAgentRuntimeOverrideRepository, AiAgentRuntimeOverrideValidationError } from '../../data/repositories/AiAgentRuntimeOverrideRepository'
import { isBaseurlAllowlisted, readBaseurlAllowlist } from '../../lib/baseurl-allowlist'
import { loadAgentRegistry, listAgents } from '../../lib/agent-registry'
import { createModelFactory } from '../../lib/model-factory'
import {
  isProviderAllowed,
  isProviderModelAllowed,
  readAllowedModels,
  readAllowedProviders,
  readAllowlistConfig,
} from '../../lib/model-allowlist'

const runtimeOverrideUpsertSchema = z.object({
  providerId: z.string().min(1).max(64).nullable().optional(),
  modelId: z.string().min(1).max(256).nullable().optional(),
  baseURL: z.string().url().max(2048).nullable().optional(),
  agentId: z.string().min(1).max(128).nullable().optional(),
})

const runtimeOverrideClearSchema = z.object({
  agentId: z.string().min(1).max(128).nullable().optional(),
})

export type RuntimeOverrideUpsertBody = z.infer<typeof runtimeOverrideUpsertSchema>
export type RuntimeOverrideClearBody = z.infer<typeof runtimeOverrideClearSchema>

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'AI assistant settings',
  methods: {
    GET: { summary: 'Get AI provider configuration' },
    PUT: {
      summary: 'Upsert per-tenant AI runtime override',
      description:
        'Creates or updates the per-tenant AI runtime override (provider, model, baseURL). ' +
        'Optionally scoped to a specific agent via `agentId`. ' +
        'Gated by `ai_assistant.settings.manage`. ' +
        'baseURL must match AI_RUNTIME_BASEURL_ALLOWLIST when set.',
      requestBody: {
        contentType: 'application/json',
        description: 'Override payload. All fields nullable/optional; null explicitly clears the axis.',
        schema: runtimeOverrideUpsertSchema,
      },
      responses: [
        { status: 200, description: 'Override saved. Returns the saved row.' },
      ],
      errors: [
        { status: 400, description: 'Validation error: unknown provider, invalid URL, or baseURL not allowlisted.' },
        { status: 401, description: 'Unauthenticated.' },
        { status: 403, description: 'Caller lacks ai_assistant.settings.manage.' },
      ],
    },
    DELETE: {
      summary: 'Clear per-tenant AI runtime override',
      description:
        'Soft-deletes the active per-tenant runtime override. ' +
        'Pass `agentId` to clear only the agent-specific row; omit to clear the tenant-wide default. ' +
        'Gated by `ai_assistant.settings.manage`. Idempotent — returns 200 with `cleared: false` when no active row existed.',
      requestBody: {
        contentType: 'application/json',
        description: 'Optional agentId to scope the delete.',
        schema: runtimeOverrideClearSchema,
      },
      responses: [
        { status: 200, description: 'Returns `{ cleared: boolean }` indicating whether a row was found and removed.' },
      ],
      errors: [
        { status: 401, description: 'Unauthenticated.' },
        { status: 403, description: 'Caller lacks ai_assistant.settings.manage.' },
      ],
    },
  },
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['ai_assistant.view'] },
  PUT: { requireAuth: true, requireFeatures: ['ai_assistant.settings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['ai_assistant.settings.manage'] },
}

/**
 * GET /api/ai_assistant/settings
 *
 * Returns the current OpenCode provider configuration from environment variables
 * plus the Phase 4a additive fields: resolvedDefault, tenantOverride, agents[],
 * and availableProviders[].defaultModels.
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

    // Phase 4a: resolve tenant override row and per-agent resolution matrix
    let tenantOverride: {
      providerId: string | null
      modelId: string | null
      baseURL: string | null
      agentId: string | null
      updatedAt: string
    } | null = null

    let agentResolutions: Array<{
      agentId: string
      moduleId: string
      allowRuntimeModelOverride: boolean
      providerId: string
      modelId: string
      baseURL: string | null
      source: string
    }> = []

    let resolvedDefault: {
      providerId: string
      modelId: string
      baseURL: string | null
      source: string
    } | null = null

    try {
      const container = await createRequestContainer()
      const tenantId = auth.tenantId ?? null
      const organizationId = auth.orgId ?? null

      if (tenantId) {
        const em = container.resolve<EntityManager>('em')
        const repo = new AiAgentRuntimeOverrideRepository(em)
        const overrideRow = await repo.getDefault({ tenantId, organizationId, agentId: null })
        if (overrideRow) {
          tenantOverride = {
            providerId: overrideRow.providerId ?? null,
            modelId: overrideRow.modelId ?? null,
            baseURL: overrideRow.baseUrl ?? null,
            agentId: overrideRow.agentId ?? null,
            updatedAt: overrideRow.updatedAt.toISOString(),
          }
        }

        const factory = createModelFactory(container)
        const defaultResolution = factory.resolveModel({
          tenantOverride: tenantOverride
            ? { providerId: tenantOverride.providerId, modelId: tenantOverride.modelId, baseURL: tenantOverride.baseURL }
            : undefined,
        })
        resolvedDefault = {
          providerId: defaultResolution.providerId,
          modelId: defaultResolution.modelId,
          baseURL: defaultResolution.baseURL ?? null,
          source: defaultResolution.source,
        }

        await loadAgentRegistry()
        const agents = listAgents()
        const agentResolutionPromises = agents.map(async (agent) => {
          const agentOverrideRow = await repo.getDefault({
            tenantId,
            organizationId,
            agentId: agent.id,
          })
          const agentTenantOverride = agentOverrideRow
            ? {
                providerId: agentOverrideRow.providerId ?? null,
                modelId: agentOverrideRow.modelId ?? null,
                baseURL: agentOverrideRow.baseUrl ?? null,
              }
            : (tenantOverride ?? undefined)
          const agentResolution = factory.resolveModel({
            moduleId: agent.moduleId,
            agentDefaultModel: agent.defaultModel,
            agentDefaultProvider: agent.defaultProvider,
            agentDefaultBaseUrl: agent.defaultBaseUrl,
            allowRuntimeModelOverride: agent.allowRuntimeModelOverride,
            tenantOverride: agentTenantOverride,
          })
          return {
            agentId: agent.id,
            moduleId: agent.moduleId,
            allowRuntimeModelOverride: agent.allowRuntimeModelOverride !== false,
            providerId: agentResolution.providerId,
            modelId: agentResolution.modelId,
            baseURL: agentResolution.baseURL ?? null,
            source: agentResolution.source,
          }
        })
        agentResolutions = await Promise.all(agentResolutionPromises)
      }
    } catch (overrideError) {
      // Phase 4a fields are best-effort — log and continue returning the base response
      console.warn('[AI Settings] Failed to compute Phase 4a override fields:', overrideError)
    }

    // Build availableProviders with Phase 4a defaultModels, then clip to the
    // operator-approved set (OM_AI_AVAILABLE_PROVIDERS /
    // OM_AI_AVAILABLE_MODELS_<PROVIDER>). The env allowlist is the ULTIMATE
    // constraint — the settings UI must never offer a value the runtime would
    // refuse to honor.
    const env = process.env as Record<string, string | undefined>
    const knownProviderIdsForAllowlist: string[] = [
      ...OPEN_CODE_PROVIDER_IDS,
      ...llmProviderRegistry
        .list()
        .map((p) => p.id)
        .filter((id) => !(OPEN_CODE_PROVIDER_IDS as readonly string[]).includes(id)),
    ]
    const allowlistConfig = readAllowlistConfig(env, knownProviderIdsForAllowlist)

    const allRawProviders = [
      ...OPEN_CODE_PROVIDER_IDS.map((id) => {
        const info = OPEN_CODE_PROVIDERS[id]
        const registryProvider = llmProviderRegistry.get(id)
        return {
          id,
          name: info.name,
          defaultModel: info.defaultModel,
          envKey: getOpenCodeProviderConfiguredEnvKey(id),
          configured: isOpenCodeProviderConfigured(id),
          defaultModels: registryProvider?.defaultModels ?? [],
        }
      }),
      // Also surface any llmProviderRegistry providers not in OPEN_CODE_PROVIDER_IDS
      ...llmProviderRegistry.list()
        .filter((p) => !(OPEN_CODE_PROVIDER_IDS as readonly string[]).includes(p.id))
        .map((p) => ({
          id: p.id,
          name: p.id,
          defaultModel: p.defaultModels[0]?.id ?? '',
          envKey: null,
          configured: p.isConfigured(),
          defaultModels: p.defaultModels,
        })),
    ]

    const availableProviders = allRawProviders
      .filter((p) => isProviderAllowed(env, p.id))
      .map((p) => {
        const allowedModels = readAllowedModels(env, p.id)
        const clippedDefaults = allowedModels
          ? p.defaultModels.filter((m) => allowedModels.includes(m.id))
          : p.defaultModels
        return {
          ...p,
          defaultModel: allowedModels && !allowedModels.includes(p.defaultModel)
            ? (allowedModels[0] ?? p.defaultModel)
            : p.defaultModel,
          defaultModels: clippedDefaults,
        }
      })

    return NextResponse.json({
      provider: {
        id: providerId,
        name: providerInfo.name,
        model: resolvedModel.modelWithProvider,
        defaultModel: providerInfo.defaultModel,
        envKey: displayEnvKey,
        configured: apiKeyConfigured,
      },
      availableProviders,
      // Snapshot of the env-driven allowlist so the UI can render hints like
      // "limited to: openai, anthropic" without re-implementing the parser.
      allowlist: allowlistConfig,
      mcpKeyConfigured,
      resolvedDefault,
      tenantOverride,
      agents: agentResolutions,
    })
  } catch (error) {
    console.error('[AI Settings] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }
}

/**
 * PUT /api/ai_assistant/settings
 *
 * Upserts the per-tenant AI runtime override (Phase 4a). Requires
 * `ai_assistant.settings.manage`. The body is Zod-validated; a `baseURL`
 * must match `AI_RUNTIME_BASEURL_ALLOWLIST` when that env var is set.
 */
export async function PUT(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.', code: 'validation_error' }, { status: 400 })
  }

  const bodyResult = runtimeOverrideUpsertSchema.safeParse(parsedBody)
  if (!bodyResult.success) {
    return NextResponse.json(
      { error: 'Invalid request body.', code: 'validation_error', issues: bodyResult.error.issues },
      { status: 400 },
    )
  }

  const { providerId, modelId, baseURL, agentId } = bodyResult.data

  if (baseURL && baseURL.trim().length > 0) {
    const allowlist = readBaseurlAllowlist()
    if (!isBaseurlAllowlisted(baseURL.trim(), allowlist)) {
      return NextResponse.json(
        {
          error: `baseURL "${baseURL}" is not in AI_RUNTIME_BASEURL_ALLOWLIST.`,
          code: 'baseurl_not_allowlisted',
        },
        { status: 400 },
      )
    }
  }

  // Env-driven provider/model allowlist (Phase 1780-5): operators can restrict
  // the (provider, model) pairs accepted by the runtime via
  // OM_AI_AVAILABLE_PROVIDERS and OM_AI_AVAILABLE_MODELS_<PROVIDER>. Reject
  // settings PUT requests for pairs outside that allowlist so the settings UI
  // never persists a value the runtime would later refuse.
  if (providerId) {
    if (!isProviderAllowed(process.env, providerId)) {
      return NextResponse.json(
        {
          error: `Provider "${providerId}" is not in OM_AI_AVAILABLE_PROVIDERS.`,
          code: 'provider_not_allowlisted',
        },
        { status: 400 },
      )
    }
    if (modelId && !isProviderModelAllowed(process.env, providerId, modelId)) {
      return NextResponse.json(
        {
          error: `Model "${modelId}" is not in OM_AI_AVAILABLE_MODELS_${providerId.toUpperCase()}.`,
          code: 'model_not_allowlisted',
        },
        { status: 400 },
      )
    }
  }

  try {
    const container = await createRequestContainer()
    const rbacService = container.resolve<RbacService>('rbacService')
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    const canManage = acl.isSuperAdmin || acl.features.includes('ai_assistant.settings.manage')
    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden', code: 'forbidden' }, { status: 403 })
    }

    const em = container.resolve<EntityManager>('em')
    const repo = new AiAgentRuntimeOverrideRepository(em)
    const row = await repo.upsertDefault(
      { providerId: providerId ?? null, modelId: modelId ?? null, baseURL: baseURL ?? null, agentId: agentId ?? null },
      { tenantId: auth.tenantId ?? '', organizationId: auth.orgId ?? null, userId: auth.sub },
    )
    return NextResponse.json({
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      agentId: row.agentId,
      providerId: row.providerId,
      modelId: row.modelId,
      baseURL: row.baseUrl,
      updatedAt: row.updatedAt,
    })
  } catch (error) {
    if (error instanceof AiAgentRuntimeOverrideValidationError) {
      return NextResponse.json({ error: error.message, code: 'provider_unknown' }, { status: 400 })
    }
    console.error('[AI Settings] PUT error:', error)
    return NextResponse.json({ error: 'Failed to save runtime override.' }, { status: 500 })
  }
}

/**
 * DELETE /api/ai_assistant/settings
 *
 * Soft-deletes the active per-tenant AI runtime override (Phase 4a). Requires
 * `ai_assistant.settings.manage`. Pass `agentId` in the body to clear only
 * the agent-specific row; omit (or null) to clear the tenant-wide default.
 * Idempotent — returns `{ cleared: false }` when no active row was found.
 */
export async function DELETE(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let parsedBody: unknown = {}
  try {
    parsedBody = await req.json()
  } catch {
    // Body is optional for DELETE — empty body is fine
  }

  const bodyResult = runtimeOverrideClearSchema.safeParse(parsedBody)
  if (!bodyResult.success) {
    return NextResponse.json(
      { error: 'Invalid request body.', code: 'validation_error', issues: bodyResult.error.issues },
      { status: 400 },
    )
  }

  try {
    const container = await createRequestContainer()
    const rbacService = container.resolve<RbacService>('rbacService')
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    const canManage = acl.isSuperAdmin || acl.features.includes('ai_assistant.settings.manage')
    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden', code: 'forbidden' }, { status: 403 })
    }

    const em = container.resolve<EntityManager>('em')
    const repo = new AiAgentRuntimeOverrideRepository(em)
    const cleared = await repo.clearDefault({
      tenantId: auth.tenantId ?? '',
      organizationId: auth.orgId ?? null,
      agentId: bodyResult.data.agentId ?? null,
    })
    return NextResponse.json({ cleared })
  } catch (error) {
    console.error('[AI Settings] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to clear runtime override.' }, { status: 500 })
  }
}
