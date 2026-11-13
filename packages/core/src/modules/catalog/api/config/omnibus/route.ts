import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { omnibusConfigPatchSchema, type OmnibusConfigPatch } from '../../../data/validators'
import { OMNIBUS_CONFIG_MODULE_ID, OMNIBUS_CONFIG_NAME, omnibusConfigSchema, type OmnibusConfig } from '../../../lib/omnibusTypes'
import {
  buildOmnibusFieldErrors,
  evaluateOmnibusConfig,
  invalidOmnibusConfig,
  mergeOmnibusConfig,
  parseStoredOmnibusConfig,
  type OmnibusConfigEvaluation,
} from '../../../lib/omnibusConfig'
import { invalidateOmnibusTenantCache, resolveOmnibusCache } from '../../../lib/omnibusCache'

const logger = createLogger('catalog')

const OMNIBUS_CONFIG_RESOURCE_KIND = 'catalog.settings'

const OMNIBUS_CONFIG_READ_FEATURES = ['catalog.settings.view', 'catalog.settings.manage'] as const

export const metadata = {
  GET: { requireAuth: true },
  PATCH: { requireAuth: true, requireFeatures: ['catalog.settings.manage'] },
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown })?.features
  if (!Array.isArray(features)) return []
  return features.filter((value): value is string => typeof value === 'string')
}

async function readStoredConfig(service: ModuleConfigService, tenantId: string): Promise<OmnibusConfig | null> {
  const raw = await service.getValue<unknown>(OMNIBUS_CONFIG_MODULE_ID, OMNIBUS_CONFIG_NAME, { scope: { tenantId } })
  const config = parseStoredOmnibusConfig(raw)
  if (raw !== null && raw !== undefined && !config) {
    logger.warn('[internal] catalog omnibus stored config is invalid; treating it as unset', { tenantId })
  }
  return config
}

function evaluatePatch(existing: OmnibusConfig | null, payload: unknown): OmnibusConfigEvaluation & { patch?: OmnibusConfigPatch } {
  const parsed = omnibusConfigPatchSchema.safeParse(payload)
  if (!parsed.success) return invalidOmnibusConfig(buildOmnibusFieldErrors(parsed.error.issues))
  return { ...evaluateOmnibusConfig(mergeOmnibusConfig(existing, parsed.data)), patch: parsed.data }
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const container = await createRequestContainer()
    const rbacService = container.resolve('rbacService') as RbacService
    const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
    let canRead = false
    for (const feature of OMNIBUS_CONFIG_READ_FEATURES) {
      if (await rbacService.userHasAllFeatures(auth.sub, [feature], scope)) {
        canRead = true
        break
      }
    }
    if (!canRead) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const service = container.resolve('moduleConfigService') as ModuleConfigService
    const config = await readStoredConfig(service, auth.tenantId)
    return NextResponse.json(config ?? {})
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('catalog.config.omnibus.GET failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const tenantId = auth.tenantId
    const organizationId = auth.orgId ?? null

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const container = await createRequestContainer()
    const service = container.resolve('moduleConfigService') as ModuleConfigService
    const existing = await readStoredConfig(service, tenantId)

    let evaluation = evaluatePatch(existing, body)
    if (!evaluation.ok) return NextResponse.json(evaluation.body, { status: evaluation.status })

    const legacyGuard = bridgeLegacyGuard(container)
    const guards: MutationGuard[] = [...getAllMutationGuardInstances()]
    if (legacyGuard) guards.push(legacyGuard)
    const guardInput = {
      tenantId,
      organizationId,
      userId: auth.sub ?? '',
      resourceKind: OMNIBUS_CONFIG_RESOURCE_KIND,
      resourceId: OMNIBUS_CONFIG_NAME,
      operation: 'update' as const,
      requestMethod: req.method,
      requestHeaders: req.headers,
    }
    const guardResult = await runMutationGuards(
      guards,
      { ...guardInput, mutationPayload: evaluation.patch ?? null },
      { userFeatures: resolveUserFeatures(auth) },
    )
    if (!guardResult.ok) {
      return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, {
        status: guardResult.errorStatus ?? 422,
      })
    }
    if (guardResult.modifiedPayload) {
      evaluation = evaluatePatch(existing, { ...evaluation.patch, ...guardResult.modifiedPayload })
      if (!evaluation.ok) return NextResponse.json(evaluation.body, { status: evaluation.status })
    }

    const nextConfig = evaluation.config
    // optimistic-lock-exempt: single tenant-scoped config blob merged server-side; no per-record version to compare
    await service.setValue(OMNIBUS_CONFIG_MODULE_ID, OMNIBUS_CONFIG_NAME, nextConfig, { tenantId })
    await invalidateOmnibusTenantCache(resolveOmnibusCache(container), tenantId)

    for (const callback of guardResult.afterSuccessCallbacks) {
      if (!callback.guard.afterSuccess) continue
      try {
        await callback.guard.afterSuccess({ ...guardInput, metadata: callback.metadata ?? null })
      } catch (callbackError) {
        logger.error('Mutation guard afterSuccess callback failed', {
          component: 'catalog.config.omnibus',
          guardId: callback.guard.id,
          err: callbackError,
        })
      }
    }

    return NextResponse.json(nextConfig)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('catalog.config.omnibus.PATCH failed', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const errorSchema = z.object({ error: z.string() }).passthrough()

const invalidConfigSchema = z.object({
  error: z.literal('Invalid config'),
  details: z.object({ fieldErrors: z.record(z.string(), z.array(z.string())) }),
})

const backfillRequiredSchema = z.object({
  field: z.literal('enabled'),
  error: z.literal('backfill_required_before_enable'),
  channels: z.array(z.string()),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Omnibus price-reference configuration',
  methods: {
    GET: {
      summary: 'Read the tenant Omnibus configuration',
      description: 'Returns the tenant-scoped Omnibus configuration with defaults applied, or an empty object when it has never been configured.',
      tags: ['Catalog'],
      responses: [
        { status: 200, description: 'Tenant Omnibus configuration ({} when unset)', schema: omnibusConfigSchema.partial() },
      ],
      errors: [{ status: 401, description: 'Unauthorized', schema: errorSchema }],
    },
    PATCH: {
      summary: 'Update the tenant Omnibus configuration',
      description:
        'Shallow-merges the provided top-level fields into the stored tenant configuration (a provided `channels` map replaces the stored one; `null` clears `defaultPresentedPriceKindId`). Member-state derogation fields and `backfillCoverage` are rejected. Enabling requires a resolvable presented price kind and completed backfill coverage for every in-scope EU channel.',
      tags: ['Catalog'],
      requestBody: { schema: omnibusConfigPatchSchema },
      responses: [{ status: 200, description: 'Merged Omnibus configuration', schema: omnibusConfigSchema }],
      errors: [
        { status: 400, description: 'Invalid JSON body or invalid config', schema: invalidConfigSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 422, description: 'Backfill required before enabling, or blocked by a mutation guard', schema: backfillRequiredSchema },
      ],
    },
  },
}
