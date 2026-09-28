import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { customerGroupReorderSchema, type CustomerGroupReorderInput } from '../../../data/validators'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'

const logger = createLogger('customer_groups')

// Groups are tenant-scoped, not organization-scoped (see the doc comment on
// `CustomerGroup.organizationId` in `../../../data/entities.ts`), so this route
// resolves only tenant context — no `resolveOrganizationScopeForRequest` call,
// unlike its template `customers/api/pipeline-stages/reorder/route.ts`.
const CUSTOMER_GROUP_RESOURCE_KIND = 'customer_groups.group'

// Upper bound on one reorder payload, enforced here rather than in the shared
// `customerGroupReorderSchema`: the command loads and rewrites every listed group
// inside one transaction, so an unbounded array is an unbounded write. The admin
// list sends at most one page (pageSize 100) of ids.
const REORDER_MAX_IDS = 500

const reorderRequestSchema = customerGroupReorderSchema.extend({
  ids: customerGroupReorderSchema.shape.ids.max(REORDER_MAX_IDS),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customer_groups.groups.manage'] },
}

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth) throw new CrudHttpError(401, { error: translate('customer_groups.errors.unauthorized', 'Unauthorized') })

    const tenantId = auth.tenantId ?? null
    if (!tenantId) {
      return NextResponse.json(
        { error: translate('customer_groups.errors.tenant_required', 'Tenant context is required') },
        { status: 400 },
      )
    }
    const organizationId = auth.orgId ?? null

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: organizationId ? [organizationId] : null,
      request: req,
    }

    const body = (await readJsonSafe<Record<string, unknown>>(req, {})) ?? {}
    const parsedInput = reorderRequestSchema.safeParse({ ...body, tenantId })
    if (!parsedInput.success) {
      return NextResponse.json(
        { error: translate('customer_groups.errors.invalid_input', 'Invalid input') },
        { status: 400 },
      )
    }
    const input: CustomerGroupReorderInput = parsedInput.data

    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId,
      organizationId,
      userId: auth.sub,
      resourceKind: CUSTOMER_GROUP_RESOURCE_KIND,
      resourceId: tenantId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute<CustomerGroupReorderInput, void>('customer_groups.groups.reorder', { input, ctx })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId,
        organizationId,
        userId: auth.sub,
        resourceKind: CUSTOMER_GROUP_RESOURCE_KIND,
        resourceId: tenantId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    logger.error('customer_groups.groups.reorder failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'customer_groups', code: 'customer_groups.reorder_failed' })
    return NextResponse.json(
      { error: translate('customer_groups.errors.reorder_failed', 'Failed to reorder customer groups') },
      { status: 500 },
    )
  }
}

const reorderOkResponseSchema = z.object({ ok: z.boolean() })
const reorderErrorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'CustomerGroups',
  summary: 'Reorder customer groups',
  methods: {
    POST: {
      summary: 'Reorder customer groups',
      description:
        'Rewrites CustomerGroup.priority for the given ordered list of ids (at most 500) inside one transaction. When the list covers every group in the tenant, priorities are renumbered in gaps of 10; otherwise the listed groups are reordered among the priority values they already hold and unlisted groups are left untouched.',
      requestBody: { contentType: 'application/json', schema: reorderRequestSchema },
      responses: [{ status: 200, description: 'Groups reordered', schema: reorderOkResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: reorderErrorSchema },
        { status: 401, description: 'Unauthorized', schema: reorderErrorSchema },
        { status: 409, description: 'Priority conflict', schema: reorderErrorSchema },
        { status: 500, description: 'Unexpected failure', schema: reorderErrorSchema },
      ],
    },
  },
}
