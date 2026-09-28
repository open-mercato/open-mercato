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
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'

const logger = createLogger('customer_groups')

// Groups are tenant-scoped, not organization-scoped (see the doc comment on
// `CustomerGroup.organizationId` in `../../../data/entities.ts`), so this route
// resolves only tenant context — no `resolveOrganizationScopeForRequest` call,
// unlike its template `customers/api/pipeline-stages/reorder/route.ts`.
const CUSTOMER_GROUP_RESOURCE_KIND = 'customer_groups.group'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customer_groups.groups.manage'] },
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
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

    const body = await req.json().catch(() => ({}))
    const input = customerGroupReorderSchema.parse({ ...body, tenantId })

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
    return NextResponse.json({ error: 'Failed to reorder customer groups' }, { status: 400 })
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
      description: 'Rewrites CustomerGroup.priority for the given ordered list of ids, in gaps of 10, inside one transaction.',
      requestBody: { contentType: 'application/json', schema: customerGroupReorderSchema },
      responses: [{ status: 200, description: 'Groups reordered', schema: reorderOkResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: reorderErrorSchema },
        { status: 401, description: 'Unauthorized', schema: reorderErrorSchema },
        { status: 409, description: 'Priority conflict', schema: reorderErrorSchema },
      ],
    },
  },
}
