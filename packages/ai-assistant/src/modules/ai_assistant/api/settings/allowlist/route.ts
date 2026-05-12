import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { AiTenantModelAllowlistRepository } from '../../../data/repositories/AiTenantModelAllowlistRepository'
import {
  isModelAllowedForProvider,
  isProviderAllowed,
} from '../../../lib/model-allowlist'

const allowlistUpsertSchema = z.object({
  allowedProviders: z.array(z.string().min(1).max(64)).nullable().optional(),
  allowedModelsByProvider: z
    .record(z.string().min(1).max(64), z.array(z.string().min(1).max(256)))
    .optional(),
})

export type AllowlistUpsertBody = z.infer<typeof allowlistUpsertSchema>

export const openApi: OpenApiRouteDoc = {
  tag: 'AI Assistant',
  summary: 'AI assistant tenant allowlist',
  methods: {
    PUT: {
      summary: 'Upsert per-tenant AI provider/model allowlist',
      description:
        'Persists the per-tenant allowlist of providers and models. The runtime intersects this with the env allowlist (`OM_AI_AVAILABLE_*`) at resolution time. ' +
        'Tenant values that fall outside the env allowlist are rejected with `provider_not_in_env_allowlist` / `model_not_in_env_allowlist` 400 codes. ' +
        'Gated by `ai_assistant.settings.manage`.',
      requestBody: {
        contentType: 'application/json',
        description:
          'Allowlist payload. `allowedProviders: null` clears tenant provider restriction (inherit env). Missing key in `allowedModelsByProvider` inherits env for that provider.',
        schema: allowlistUpsertSchema,
      },
      responses: [
        { status: 200, description: 'Allowlist saved. Returns the saved snapshot.' },
      ],
      errors: [
        { status: 400, description: 'Validation error or values outside env allowlist.' },
        { status: 401, description: 'Unauthenticated.' },
        { status: 403, description: 'Caller lacks ai_assistant.settings.manage.' },
      ],
    },
    DELETE: {
      summary: 'Clear per-tenant AI provider/model allowlist',
      description:
        'Soft-deletes the tenant allowlist row. Tenant overrides revert to env-only enforcement. Idempotent — returns `{ cleared: false }` when no active row existed.',
      responses: [
        { status: 200, description: 'Returns `{ cleared: boolean }`.' },
      ],
      errors: [
        { status: 401, description: 'Unauthenticated.' },
        { status: 403, description: 'Caller lacks ai_assistant.settings.manage.' },
      ],
    },
  },
}

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['ai_assistant.settings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['ai_assistant.settings.manage'] },
}

export async function PUT(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let parsedBody: unknown
  try {
    parsedBody = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Request body must be valid JSON.', code: 'validation_error' },
      { status: 400 },
    )
  }

  const bodyResult = allowlistUpsertSchema.safeParse(parsedBody)
  if (!bodyResult.success) {
    return NextResponse.json(
      { error: 'Invalid request body.', code: 'validation_error', issues: bodyResult.error.issues },
      { status: 400 },
    )
  }

  const env = process.env as Record<string, string | undefined>
  const allowedProviders = bodyResult.data.allowedProviders === undefined
    ? null
    : bodyResult.data.allowedProviders
  const allowedModelsByProvider = bodyResult.data.allowedModelsByProvider ?? {}

  // Reject tenant entries that escape the env allowlist. The runtime would
  // intersect them away anyway; failing fast at write time keeps stored
  // tenant snapshots honest and visible in admin audits.
  if (Array.isArray(allowedProviders)) {
    for (const providerId of allowedProviders) {
      if (!isProviderAllowed(env, providerId)) {
        return NextResponse.json(
          {
            error: `Provider "${providerId}" is not in OM_AI_AVAILABLE_PROVIDERS; tenant allowlist may not widen the env allowlist.`,
            code: 'provider_not_in_env_allowlist',
          },
          { status: 400 },
        )
      }
    }
  }
  for (const providerId of Object.keys(allowedModelsByProvider)) {
    if (!isProviderAllowed(env, providerId)) {
      return NextResponse.json(
        {
          error: `Provider "${providerId}" is not in OM_AI_AVAILABLE_PROVIDERS; cannot save tenant model allowlist for it.`,
          code: 'provider_not_in_env_allowlist',
        },
        { status: 400 },
      )
    }
    for (const modelId of allowedModelsByProvider[providerId] ?? []) {
      if (!isModelAllowedForProvider(env, providerId, modelId)) {
        return NextResponse.json(
          {
            error: `Model "${modelId}" is not in OM_AI_AVAILABLE_MODELS_${providerId.toUpperCase()}; tenant allowlist may not widen the env allowlist.`,
            code: 'model_not_in_env_allowlist',
          },
          { status: 400 },
        )
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
    const canManage =
      acl.isSuperAdmin || acl.features.includes('ai_assistant.settings.manage')
    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden', code: 'forbidden' }, { status: 403 })
    }

    const em = container.resolve<EntityManager>('em')
    const repo = new AiTenantModelAllowlistRepository(em)
    const row = await repo.upsert(
      { allowedProviders, allowedModelsByProvider },
      {
        tenantId: auth.tenantId ?? '',
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
      },
    )
    return NextResponse.json({
      id: row.id,
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      allowedProviders: row.allowedProviders ?? null,
      allowedModelsByProvider: row.allowedModelsByProvider ?? {},
      updatedAt: row.updatedAt,
    })
  } catch (error) {
    console.error('[AI Settings Allowlist] PUT error:', error)
    return NextResponse.json(
      { error: 'Failed to save tenant allowlist.' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const container = await createRequestContainer()
    const rbacService = container.resolve<RbacService>('rbacService')
    const acl = await rbacService.loadAcl(auth.sub, {
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    const canManage =
      acl.isSuperAdmin || acl.features.includes('ai_assistant.settings.manage')
    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden', code: 'forbidden' }, { status: 403 })
    }

    const em = container.resolve<EntityManager>('em')
    const repo = new AiTenantModelAllowlistRepository(em)
    const cleared = await repo.clear({
      tenantId: auth.tenantId ?? '',
      organizationId: auth.orgId ?? null,
    })
    return NextResponse.json({ cleared })
  } catch (error) {
    console.error('[AI Settings Allowlist] DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to clear tenant allowlist.' },
      { status: 500 },
    )
  }
}
