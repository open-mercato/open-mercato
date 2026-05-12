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
} from '@open-mercato/shared/lib/ai/opencode-provider'
import { AiAgentRuntimeOverrideRepository, AiAgentRuntimeOverrideValidationError } from '../../data/repositories/AiAgentRuntimeOverrideRepository'
import { AiTenantModelAllowlistRepository } from '../../data/repositories/AiTenantModelAllowlistRepository'
import { isBaseurlAllowlisted, readBaseurlAllowlist } from '../../lib/baseurl-allowlist'
import { loadAgentRegistry, listAgents } from '../../lib/agent-registry'
import { createModelFactory } from '../../lib/model-factory'
import {
  agentOverrideModelAllowlistEnvVarName,
  agentOverrideProviderAllowlistEnvVarName,
  canonicalProviderId,
  hasAllowlistSnapshotRestrictions,
  intersectEffectiveAllowlistWithSnapshot,
  intersectAllowlists,
  isProviderAllowed,
  isProviderAllowedInEffective,
  isProviderModelAllowed,
  isProviderModelAllowedInEffective,
  modelAllowlistEnvVarName,
  readAgentRuntimeOverrideAllowlist,
  readAllowedModels,
  readAllowedProviders,
  readAllowlistConfig,
  type TenantAllowlistSnapshot,
} from '../../lib/model-allowlist'

const runtimeOverrideUpsertSchema = z.object({
  providerId: z.string().min(1).max(64).nullable().optional(),
  modelId: z.string().min(1).max(256).nullable().optional(),
  baseURL: z.string().url().max(2048).nullable().optional(),
  agentId: z.string().min(1).max(128).nullable().optional(),
  allowedOverrideProviders: z.array(z.string().min(1).max(64)).nullable().optional(),
  allowedOverrideModelsByProvider: z
    .record(z.string().min(1).max(64), z.array(z.string().min(1).max(256)))
    .optional(),
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
    const env = process.env as Record<string, string | undefined>
    const configuredProviderHint = env.OM_AI_PROVIDER?.trim() || env.OPENCODE_PROVIDER?.trim() || null
    const registryProviders = llmProviderRegistry.list()
    const knownProviderIdsForAllowlist: string[] = [
      ...OPEN_CODE_PROVIDER_IDS,
      ...registryProviders
        .map((p) => p.id)
        .filter((id) => !(OPEN_CODE_PROVIDER_IDS as readonly string[]).includes(id)),
    ]
    const registryProviderId = configuredProviderHint
      ? canonicalProviderId(configuredProviderHint, registryProviders.map((provider) => provider.id))
      : null
    const registryProvider = registryProviderId ? llmProviderRegistry.get(registryProviderId) : null
    const fallbackOpenCodeProviderId = (
      (configuredProviderHint
        ? canonicalProviderId(configuredProviderHint, OPEN_CODE_PROVIDER_IDS as readonly string[])
        : null) ?? 'openai'
    ) as keyof typeof OPEN_CODE_PROVIDERS
    const fallbackOpenCodeProvider = OPEN_CODE_PROVIDERS[fallbackOpenCodeProviderId]

    const providerId = registryProvider?.id ?? fallbackOpenCodeProviderId
    const providerName = registryProvider?.name ?? fallbackOpenCodeProvider?.name ?? providerId
    const defaultProviderModel = registryProvider?.defaultModel ?? fallbackOpenCodeProvider?.defaultModel ?? ''
    const configuredModelHint = env.OM_AI_MODEL?.trim() || env.OPENCODE_MODEL?.trim() || defaultProviderModel
    const fallbackModelWithProvider = `${providerId}/${configuredModelHint}`
    const apiKeyConfigured = registryProvider
      ? registryProvider.isConfigured(env)
      : fallbackOpenCodeProvider
        ? isOpenCodeProviderConfigured(fallbackOpenCodeProviderId)
        : false
    const displayEnvKey = registryProvider
      ? registryProvider.getConfiguredEnvKey(env)
      : fallbackOpenCodeProvider
        ? getOpenCodeProviderConfiguredEnvKey(fallbackOpenCodeProviderId)
        : null

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
      codeDefaultProviderId: string | null
      codeDefaultModelId: string | null
      override: {
        providerId: string | null
        modelId: string | null
        baseURL: string | null
        updatedAt: string
      } | null
      runtimeOverrideAllowlist: {
        env: TenantAllowlistSnapshot | null
        tenant: TenantAllowlistSnapshot | null
        effective: ReturnType<typeof intersectAllowlists>
        envVarNames: {
          providers: string
          modelsByProvider: Record<string, string>
        }
      }
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

    let tenantAllowlistSnapshot: TenantAllowlistSnapshot | null = null

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

        const allowlistRepo = new AiTenantModelAllowlistRepository(em)
        tenantAllowlistSnapshot = await allowlistRepo.getSnapshot({
          tenantId,
          organizationId,
        })

        const factory = createModelFactory(container)
        const defaultResolution = factory.resolveModel({
          tenantAllowlist: tenantAllowlistSnapshot,
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
          const agentOverrideRow = await repo.getExact({
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
            tenantAllowlist: tenantAllowlistSnapshot,
          })
          const agentEnvAllowlist = readAgentRuntimeOverrideAllowlist(
            env,
            agent.id,
            knownProviderIdsForAllowlist,
          )
          const agentTenantAllowlist = agentOverrideRow
            ? {
                allowedProviders: agentOverrideRow.allowedOverrideProviders ?? null,
                allowedModelsByProvider: agentOverrideRow.allowedOverrideModelsByProvider ?? {},
              }
            : null
          const baseEffectiveAllowlist = intersectAllowlists(
            env,
            knownProviderIdsForAllowlist,
            tenantAllowlistSnapshot,
          )
          const agentEffectiveAllowlist = intersectEffectiveAllowlistWithSnapshot(
            intersectEffectiveAllowlistWithSnapshot(
              baseEffectiveAllowlist,
              knownProviderIdsForAllowlist,
              agentEnvAllowlist,
            ),
            knownProviderIdsForAllowlist,
            agentTenantAllowlist,
          )
          const agentModelEnvVars = Object.fromEntries(
            knownProviderIdsForAllowlist.map((providerId) => [
              providerId,
              agentOverrideModelAllowlistEnvVarName(agent.id, providerId),
            ]),
          )
          return {
            agentId: agent.id,
            moduleId: agent.moduleId,
            allowRuntimeModelOverride: agent.allowRuntimeModelOverride !== false,
            codeDefaultProviderId: agent.defaultProvider ?? null,
            codeDefaultModelId: agent.defaultModel ?? null,
            override: agentOverrideRow
              ? {
                  providerId: agentOverrideRow.providerId ?? null,
                  modelId: agentOverrideRow.modelId ?? null,
                  baseURL: agentOverrideRow.baseUrl ?? null,
                  updatedAt: agentOverrideRow.updatedAt.toISOString(),
                }
              : null,
            runtimeOverrideAllowlist: {
              env: agentEnvAllowlist,
              tenant: hasAllowlistSnapshotRestrictions(agentTenantAllowlist)
                ? agentTenantAllowlist
                : null,
              effective: agentEffectiveAllowlist,
              envVarNames: {
                providers: agentOverrideProviderAllowlistEnvVarName(agent.id),
                modelsByProvider: agentModelEnvVars,
              },
            },
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
    // EFFECTIVE allowlist — env intersected with the per-tenant snapshot.
    // The env allowlist is the OUTER constraint; the tenant allowlist (Phase
    // 1780-6) narrows it further. The settings UI must never offer a value
    // the runtime would refuse to honor.
    const allowlistConfig = readAllowlistConfig(env, knownProviderIdsForAllowlist)
    const effectiveAllowlist = intersectAllowlists(
      env,
      knownProviderIdsForAllowlist,
      tenantAllowlistSnapshot,
    )

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
          name: p.name,
          defaultModel: p.defaultModels[0]?.id ?? '',
          envKey: null,
          configured: p.isConfigured(),
          defaultModels: p.defaultModels,
        })),
    ]

    const availableProviders = allRawProviders
      .filter((p) => isProviderAllowedInEffective(effectiveAllowlist, p.id))
      .map((p) => {
        const effectiveModelsList = effectiveAllowlist.modelsByProvider[p.id]
        const clippedDefaults = effectiveModelsList !== undefined
          ? p.defaultModels.filter((m) => effectiveModelsList.includes(m.id))
          : p.defaultModels
        return {
          ...p,
          defaultModel: effectiveModelsList && !effectiveModelsList.includes(p.defaultModel)
            ? (effectiveModelsList[0] ?? p.defaultModel)
            : p.defaultModel,
          defaultModels: clippedDefaults,
        }
      })

    const allowlistProviders = allRawProviders
      .filter((p) => isProviderAllowed(env, p.id))
      .map((p) => {
        const envModelsList = allowlistConfig.modelsByProvider[p.id]
        const envClippedDefaults = envModelsList !== undefined
          ? p.defaultModels.filter((m) => envModelsList.includes(m.id))
          : p.defaultModels
        return {
          ...p,
          defaultModel: envModelsList && !envModelsList.includes(p.defaultModel)
            ? (envModelsList[0] ?? p.defaultModel)
            : p.defaultModel,
          defaultModels: envClippedDefaults,
        }
      })

    return NextResponse.json({
      provider: {
        id: providerId,
        name: providerName,
        model: resolvedDefault
          ? `${resolvedDefault.providerId}/${resolvedDefault.modelId}`
          : fallbackModelWithProvider,
        defaultModel: defaultProviderModel,
        envKey: displayEnvKey,
        configured: apiKeyConfigured,
      },
      availableProviders,
      // Editable universe for the tenant allowlist page. This is clipped only
      // by env so tenant-hidden models remain visible and can be re-enabled.
      allowlistProviders,
      // Snapshot of the env-driven allowlist so the UI can render hints like
      // "limited to: openai, anthropic" without re-implementing the parser.
      allowlist: allowlistConfig,
      // Per-tenant allowlist snapshot (Phase 1780-6). `null` when no row has
      // been persisted yet — the runtime then falls back to env-only
      // enforcement. The UI uses this to drive the editable MultiSelect.
      tenantAllowlist: tenantAllowlistSnapshot,
      // Effective allowlist after intersecting env with tenant. The UI uses
      // this to render the "what the runtime will actually accept" summary
      // and to clip pickers without re-implementing the intersection.
      effectiveAllowlist,
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

  const { providerId: requestedProviderId, modelId, baseURL, agentId } = bodyResult.data
  const knownProviderIdsForRequest = llmProviderRegistry.list().map((p) => p.id)
  const providerId = requestedProviderId
    ? canonicalProviderId(requestedProviderId, knownProviderIdsForRequest) ?? requestedProviderId
    : requestedProviderId

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

  const allowedOverrideProviders = bodyResult.data.allowedOverrideProviders === undefined
    ? undefined
    : bodyResult.data.allowedOverrideProviders?.map((id) =>
        canonicalProviderId(id, knownProviderIdsForRequest) ?? id,
      ) ?? null
  const allowedOverrideModelsByProvider = bodyResult.data.allowedOverrideModelsByProvider === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(bodyResult.data.allowedOverrideModelsByProvider ?? {}).map(([id, models]) => [
          canonicalProviderId(id, knownProviderIdsForRequest) ?? id,
          models,
        ]),
      )
  const hasRuntimeOverrideAllowlistWrite =
    allowedOverrideProviders !== undefined || allowedOverrideModelsByProvider !== undefined

  // Env-driven provider/model allowlist (Phase 1780-5) intersected with the
  // per-tenant allowlist (Phase 1780-6): the EFFECTIVE allowlist clips which
  // (provider, model) pairs the runtime accepts. Reject settings PUT requests
  // for pairs outside that effective set so the settings UI never persists a
  // value the runtime would later refuse. Tenant-allowlist enforcement is
  // best-effort here: if the snapshot lookup fails we fall back to env-only
  // checks (the runtime still re-clips at resolution time).
  let putEffectiveAllowlist: ReturnType<typeof intersectAllowlists> | null = null
  if (providerId || hasRuntimeOverrideAllowlistWrite) {
    try {
      const previewContainer = await createRequestContainer()
      const knownIdsForCheck = [
        ...OPEN_CODE_PROVIDER_IDS,
        ...llmProviderRegistry
          .list()
          .map((p) => p.id)
          .filter((id) => !(OPEN_CODE_PROVIDER_IDS as readonly string[]).includes(id)),
      ]
      let snapshot: TenantAllowlistSnapshot | null = null
      if (auth.tenantId) {
        try {
          const em = previewContainer.resolve<EntityManager>('em')
          const allowlistRepo = new AiTenantModelAllowlistRepository(em)
          snapshot = await allowlistRepo.getSnapshot({
            tenantId: auth.tenantId,
            organizationId: auth.orgId ?? null,
          })
        } catch {
          snapshot = null
        }
      }
      putEffectiveAllowlist = intersectAllowlists(
        process.env as Record<string, string | undefined>,
        knownIdsForCheck,
        snapshot,
      )
    } catch {
      putEffectiveAllowlist = null
    }

    if (putEffectiveAllowlist) {
      if (!isProviderAllowedInEffective(putEffectiveAllowlist, providerId)) {
        const source = putEffectiveAllowlist.tenantOverridesActive
          ? 'the effective allowlist (env ∩ tenant)'
          : 'OM_AI_AVAILABLE_PROVIDERS'
        return NextResponse.json(
          {
            error: `Provider "${providerId}" is not in ${source}.`,
            code: 'provider_not_allowlisted',
          },
          { status: 400 },
        )
      }
      if (
        modelId
        && !isProviderModelAllowedInEffective(putEffectiveAllowlist, providerId, modelId)
      ) {
        const source = putEffectiveAllowlist.tenantOverridesActive
          ? `the effective allowlist (env ∩ tenant) for "${providerId}"`
          : modelAllowlistEnvVarName(providerId)
        return NextResponse.json(
          {
            error: `Model "${modelId}" is not in ${source}.`,
            code: 'model_not_allowlisted',
          },
          { status: 400 },
        )
      }
    } else {
      if (!isProviderAllowed(process.env, providerId)) {
        return NextResponse.json(
          {
            error: `Provider "${requestedProviderId}" is not in OM_AI_AVAILABLE_PROVIDERS.`,
            code: 'provider_not_allowlisted',
          },
          { status: 400 },
        )
      }
      if (modelId && !isProviderModelAllowed(process.env, providerId, modelId)) {
        return NextResponse.json(
          {
            error: `Model "${modelId}" is not in ${modelAllowlistEnvVarName(providerId)}.`,
            code: 'model_not_allowlisted',
          },
          { status: 400 },
        )
      }
    }
  }

  if (hasRuntimeOverrideAllowlistWrite && !agentId) {
    return NextResponse.json(
      {
        error: 'agentId is required when saving chat override allowlist settings.',
        code: 'agent_required',
      },
      { status: 400 },
    )
  }

  if (Array.isArray(allowedOverrideProviders)) {
    for (const id of allowedOverrideProviders) {
      if (putEffectiveAllowlist && !isProviderAllowedInEffective(putEffectiveAllowlist, id)) {
        return NextResponse.json(
          {
            error: `Provider "${id}" is not in the effective tenant allowlist; per-agent chat override choices may not widen it.`,
            code: 'provider_not_allowlisted',
          },
          { status: 400 },
        )
      }
    }
  }
  if (allowedOverrideModelsByProvider) {
    for (const [id, models] of Object.entries(allowedOverrideModelsByProvider)) {
      if (putEffectiveAllowlist && !isProviderAllowedInEffective(putEffectiveAllowlist, id)) {
        return NextResponse.json(
          {
            error: `Provider "${id}" is not in the effective tenant allowlist; cannot save per-agent model choices for it.`,
            code: 'provider_not_allowlisted',
          },
          { status: 400 },
        )
      }
      for (const allowedModelId of models) {
        if (
          putEffectiveAllowlist &&
          !isProviderModelAllowedInEffective(putEffectiveAllowlist, id, allowedModelId)
        ) {
          return NextResponse.json(
            {
              error: `Model "${allowedModelId}" is not in the effective tenant allowlist for "${id}".`,
              code: 'model_not_allowlisted',
            },
            { status: 400 },
          )
        }
      }
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
    const upsertInput = {
      agentId: agentId ?? null,
      ...(Object.prototype.hasOwnProperty.call(bodyResult.data, 'providerId')
        ? { providerId: providerId ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyResult.data, 'modelId')
        ? { modelId: modelId ?? null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(bodyResult.data, 'baseURL')
        ? { baseURL: baseURL ?? null }
        : {}),
      ...(allowedOverrideProviders !== undefined
        ? { allowedOverrideProviders }
        : {}),
      ...(allowedOverrideModelsByProvider !== undefined
        ? { allowedOverrideModelsByProvider }
        : {}),
    }
    const row = await repo.upsertDefault(
      upsertInput,
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
      allowedOverrideProviders: row.allowedOverrideProviders ?? null,
      allowedOverrideModelsByProvider: row.allowedOverrideModelsByProvider ?? {},
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
