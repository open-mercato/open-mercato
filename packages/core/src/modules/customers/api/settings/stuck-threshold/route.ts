import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import {
  customerStuckThresholdUpsertSchema,
  type CustomerStuckThresholdUpsertInput,
} from '../../../data/validators'
import { loadCustomerSettings } from '../../../commands/settings'
import { withScopedPayload } from '../../utils'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const DEFAULT_THRESHOLD = 14

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.deals.manage'] },
}

type SettingsRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
  em: EntityManager
}

async function resolveSettingsContext(req: Request): Promise<SettingsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, {
      error: translate('customers.errors.unauthorized', 'Unauthorized'),
    })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('customers.errors.organization_required', 'Organization context is required'),
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

  const em = container.resolve('em') as EntityManager
  return {
    ctx,
    tenantId: auth.tenantId,
    organizationId,
    translate,
    em,
  }
}

export async function GET(req: Request) {
  try {
    const { em, tenantId, organizationId } = await resolveSettingsContext(req)
    const record = await loadCustomerSettings(em, { tenantId, organizationId })
    return NextResponse.json({
      stuckThresholdDays: record?.stuckThresholdDays ?? DEFAULT_THRESHOLD,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.settings.stuck-threshold.get failed', err)
    return NextResponse.json(
      { error: translate('customers.errors.lookup_failed', 'Failed to load settings') },
      { status: 400 },
    )
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, tenantId, organizationId, translate } = await resolveSettingsContext(req)
    const payload = await req.json().catch(() => ({}))
    const scoped = withScopedPayload(payload, ctx, translate)
    const input = customerStuckThresholdUpsertSchema.parse(scoped)

    // Mutation-guard contract for custom write routes. The resource is the customer
    // settings row scoped to the organization; we use the organizationId as the
    // resourceId because the (tenant, organization) pair uniquely identifies it.
    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId,
      organizationId,
      // `resolveSettingsContext` throws 401 when auth is missing, so by the time we reach
      // here `ctx.auth.sub` is guaranteed to be a string per `AuthContext`.
      userId: ctx.auth!.sub,
      resourceKind: 'customers.settings',
      resourceId: organizationId,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<
      CustomerStuckThresholdUpsertInput,
      { settingsId: string; stuckThresholdDays: number }
    >('customers.settings.save_stuck_threshold', { input, ctx })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId,
        // `resolveSettingsContext` throws 401 when auth is missing, so by the time we reach
      // here `ctx.auth.sub` is guaranteed to be a string per `AuthContext`.
      userId: ctx.auth!.sub,
        resourceKind: 'customers.settings',
        resourceId: organizationId,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({
      stuckThresholdDays: result?.stuckThresholdDays ?? input.stuckThresholdDays,
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.settings.stuck-threshold.put failed', err)
    return NextResponse.json(
      { error: translate('customers.errors.save_failed', 'Failed to save settings') },
      { status: 400 },
    )
  }
}

const stuckThresholdResponseSchema = z.object({
  stuckThresholdDays: z.number(),
})

const stuckThresholdErrorSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Customer deals stuck-threshold setting',
  methods: {
    GET: {
      summary: 'Retrieve stuck-threshold days',
      description: 'Returns the current stuck-deal threshold (in days) for the selected organization.',
      responses: [
        { status: 200, description: 'Current threshold', schema: stuckThresholdResponseSchema },
        { status: 401, description: 'Unauthorized', schema: stuckThresholdErrorSchema },
        { status: 400, description: 'Organization context missing', schema: stuckThresholdErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update stuck-threshold days',
      description: 'Updates the stuck-deal threshold for the selected organization.',
      requestBody: {
        contentType: 'application/json',
        schema: customerStuckThresholdUpsertSchema,
      },
      responses: [
        { status: 200, description: 'Updated threshold', schema: stuckThresholdResponseSchema },
        { status: 401, description: 'Unauthorized', schema: stuckThresholdErrorSchema },
        { status: 400, description: 'Invalid payload', schema: stuckThresholdErrorSchema },
      ],
    },
  },
}
