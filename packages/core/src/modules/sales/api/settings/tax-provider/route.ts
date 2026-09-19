import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { salesTaxProviderSettingsSchema } from '../../../data/validators'
import { loadSalesSettings } from '../../../commands/settings'
import { listTaxProviders } from '../../../lib/providers'
import {
  DEFAULT_TAX_PROVIDER_KEY,
  resolveDefaultTaxProviderTimeout,
} from '../../../lib/providers/taxContext'
import { withScopedPayload } from '../../utils'

const logger = createLogger('sales')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
}

type SettingsRouteContext = {
  ctx: CommandRuntimeContext
  em: EntityManager
  translate: (key: string, fallback?: string) => string
  organizationId: string
  tenantId: string
}

async function resolveSettingsContext(req: Request): Promise<SettingsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('sales.settings.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('sales.settings.errors.organization_required', 'Organization context is required'),
    })
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return { ctx, em: container.resolve('em') as EntityManager, translate, tenantId: auth.tenantId, organizationId }
}

/** Field definitions only — never a configured value and never a credential. */
function providerCatalog() {
  return listTaxProviders().map((provider) => ({
    key: provider.key,
    label: provider.label,
    description: provider.description ?? null,
    integrationId: provider.integrationId ?? null,
    capabilities: provider.capabilities ?? null,
    fields: (provider.settings?.fields ?? []).filter((field) => field.type !== 'secret'),
  }))
}

export async function GET(req: Request) {
  try {
    const { em, organizationId, tenantId } = await resolveSettingsContext(req)
    const record = await loadSalesSettings(em, { tenantId, organizationId })
    return NextResponse.json({
      // A NULL column means the built in default, which is what the select must
      // show rather than an empty choice.
      providerKey: record?.taxProviderKey ?? DEFAULT_TAX_PROVIDER_KEY,
      providerSettings: record?.taxProviderSettings ?? null,
      shipFromAddress: record?.shipFromAddress ?? null,
      timeoutMs: record?.taxProviderTimeoutMs ?? resolveDefaultTaxProviderTimeout(),
      providers: providerCatalog(),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('sales.settings.tax-provider.get failed', { err })
    return NextResponse.json(
      { error: translate('sales.settings.errors.load_failed', 'Failed to load sales settings') },
      { status: 400 }
    )
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, translate, organizationId, tenantId, em } = await resolveSettingsContext(req)
    const payload = (await readJsonSafe<Record<string, unknown>>(req, {})) ?? {}
    const scoped = withScopedPayload(payload, ctx, translate)
    const parsed = salesTaxProviderSettingsSchema.parse(scoped)

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId,
      organizationId,
      userId: ctx.auth!.sub,
      resourceKind: 'sales.settings',
      resourceId: organizationId,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: parsed,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute('sales.settings.save_tax_provider', { input: parsed, ctx })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId,
        userId: ctx.auth!.sub,
        resourceKind: 'sales.settings',
        resourceId: organizationId,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    // Re-read rather than echoing the command result, so the response is the
    // same shape GET returns and the client can replace its state wholesale.
    const record = await loadSalesSettings(em.fork(), { tenantId, organizationId })
    return NextResponse.json({
      providerKey: record?.taxProviderKey ?? DEFAULT_TAX_PROVIDER_KEY,
      providerSettings: record?.taxProviderSettings ?? null,
      shipFromAddress: record?.shipFromAddress ?? null,
      timeoutMs: record?.taxProviderTimeoutMs ?? resolveDefaultTaxProviderTimeout(),
      providers: providerCatalog(),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('sales.settings.tax-provider.put failed', { err })
    return NextResponse.json(
      { error: translate('sales.settings.errors.save_failed', 'Failed to save sales settings') },
      { status: 400 }
    )
  }
}

const providerFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.string(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
})

const taxProviderSettingsResponseSchema = z.object({
  providerKey: z.string(),
  providerSettings: z.record(z.string(), z.unknown()).nullable(),
  shipFromAddress: z.record(z.string(), z.unknown()).nullable(),
  timeoutMs: z.number(),
  providers: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      description: z.string().nullable(),
      integrationId: z.string().nullable(),
      capabilities: z.record(z.string(), z.unknown()).nullable(),
      fields: z.array(providerFieldSchema),
    })
  ),
})

const settingsErrorSchema = z.object({ error: z.string(), code: z.string().optional() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Tax provider selection',
  methods: {
    GET: {
      summary: 'Get the tax provider selection',
      description:
        'Returns the organization\'s selected tax provider, its non secret options, the ship from address and the effective timeout. Never returns credentials.',
      responses: [
        { status: 200, description: 'Current selection', schema: taxProviderSettingsResponseSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 400, description: 'Missing scope', schema: settingsErrorSchema },
      ],
    },
    PUT: {
      summary: 'Set the tax provider selection',
      description:
        'Selects a registered tax provider for the organization. An unknown provider, or a settings key the provider declared as a secret, is rejected with 400.',
      requestBody: { contentType: 'application/json', schema: salesTaxProviderSettingsSchema },
      responses: [
        { status: 200, description: 'Updated selection', schema: taxProviderSettingsResponseSchema },
        { status: 400, description: 'Unknown provider, secret field or invalid settings', schema: settingsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: settingsErrorSchema },
        { status: 403, description: 'Forbidden', schema: settingsErrorSchema },
        { status: 409, description: 'Conflict detected', schema: settingsErrorSchema },
      ],
    },
  },
}
