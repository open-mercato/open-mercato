import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { runCustomRouteAfterInterceptors } from '@open-mercato/shared/lib/crud/custom-route-interceptor'
import { salesOrderWarehouseAssignBodySchema } from '../../../../data/validators'
import { loadSalesOrderWarehouseAssignmentView } from '../../../../lib/salesOrderWarehouseAssignment'
import { executeWmsCustomPostRoute } from '../../../inventory/helpers'

const paramsSchema = z.object({
  salesOrderId: z.string().uuid(),
})

const assignmentResponseSchema = z.object({
  assignment: z
    .object({
      id: z.string().uuid(),
      salesOrderId: z.string().uuid(),
      warehouseId: z.string().uuid(),
      warehouseName: z.string().nullable(),
      warehouseCode: z.string().nullable(),
      notes: z.string().nullable(),
      assignedBy: z.string().uuid().nullable(),
    })
    .nullable(),
})

const assignSuccessSchema = z.object({
  ok: z.literal(true),
  assignmentId: z.string().uuid(),
  warehouseId: z.string().uuid(),
})

const okSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ error: z.string() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
  PUT: { requireAuth: true, requireFeatures: ['wms.manage_reservations'] },
  PATCH: { requireAuth: true, requireFeatures: ['wms.manage_reservations'] },
  DELETE: { requireAuth: true, requireFeatures: ['wms.manage_reservations'] },
}

async function resolveCommandContext(request: Request): Promise<CommandRuntimeContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }
  const organizationScope = await resolveOrganizationScopeForRequest({
    container,
    auth,
    request,
  })
  return {
    container,
    auth,
    organizationScope,
    selectedOrganizationId: organizationScope?.selectedId ?? auth.orgId ?? null,
    organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request,
  }
}

function resolveScope(ctx: CommandRuntimeContext) {
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const tenantId = ctx.auth?.tenantId ?? null
  if (!organizationId || !tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }
  return { organizationId, tenantId }
}

export async function GET(
  request: Request,
  { params }: { params: { salesOrderId: string } },
) {
  try {
    const parsedParams = paramsSchema.parse(params)
    const ctx = await resolveCommandContext(request)
    const scope = resolveScope(ctx)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const assignment = await loadSalesOrderWarehouseAssignmentView(
      em,
      parsedParams.salesOrderId,
      scope,
    )
    return NextResponse.json({ assignment })
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }
    console.error('[wms.sales-orders] GET warehouse-assignment failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function executeAssignMutation(request: Request, salesOrderId: string) {
  const body = await readJsonSafe<Record<string, unknown>>(request, {})
  const parsedBody = salesOrderWarehouseAssignBodySchema.parse(body)
  const scopedRequest = new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({
      ...parsedBody,
      salesOrderId,
    }),
  })
  return executeWmsCustomPostRoute({
    request: scopedRequest,
    routePath: `wms/sales-orders/${salesOrderId}/warehouse-assignment`,
    inputSchema: z.object({
      salesOrderId: z.string().uuid(),
      warehouseId: z.string().uuid(),
      notes: z.string().trim().max(500).optional(),
      tenantId: z.string().uuid().optional(),
      organizationId: z.string().uuid().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
    commandId: 'wms.sales-order.assign-warehouse',
    describeResource: (input) => ({
      resourceKind: 'wms.sales_order_warehouse_assignment',
      resourceId: input.salesOrderId,
    }),
    mapSuccess: (result: { assignmentId: string; warehouseId: string }) => ({
      ok: true,
      assignmentId: result.assignmentId,
      warehouseId: result.warehouseId,
    }),
  })
}

export async function PUT(
  request: Request,
  routeContext: { params: { salesOrderId: string } },
) {
  const parsedParams = paramsSchema.parse(routeContext.params)
  return executeAssignMutation(request, parsedParams.salesOrderId)
}

export async function PATCH(
  request: Request,
  routeContext: { params: { salesOrderId: string } },
) {
  const parsedParams = paramsSchema.parse(routeContext.params)
  return executeAssignMutation(request, parsedParams.salesOrderId)
}

export async function DELETE(
  request: Request,
  routeContext: { params: { salesOrderId: string } },
) {
  try {
    const parsedParams = paramsSchema.parse(routeContext.params)
    const ctx = await resolveCommandContext(request)
    const scope = resolveScope(ctx)
    const resource = {
      resourceKind: 'wms.sales_order_warehouse_assignment',
      resourceId: parsedParams.salesOrderId,
    }
    const guardResult = await validateCrudMutationGuard(ctx.container, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: ctx.auth?.sub ?? '',
      resourceKind: resource.resourceKind,
      resourceId: resource.resourceId,
      operation: 'custom',
      requestMethod: request.method,
      requestHeaders: request.headers,
      mutationPayload: { salesOrderId: parsedParams.salesOrderId },
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    await commandBus.execute('wms.sales-order.unassign-warehouse', {
      input: {
        salesOrderId: parsedParams.salesOrderId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      ctx,
    })

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(ctx.container, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: ctx.auth?.sub ?? '',
        resourceKind: resource.resourceKind,
        resourceId: resource.resourceId,
        operation: 'custom',
        requestMethod: request.method,
        requestHeaders: request.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    const responseBody = { ok: true as const }
    const intercepted = await runCustomRouteAfterInterceptors({
      routePath: `wms/sales-orders/${parsedParams.salesOrderId}/warehouse-assignment`,
      method: 'DELETE',
      request: {
        method: 'DELETE',
        url: request.url,
        body: { salesOrderId: parsedParams.salesOrderId },
        headers: Object.fromEntries(request.headers.entries()),
      },
      response: {
        statusCode: 200,
        body: responseBody,
        headers: {},
      },
      context: {
        em: ctx.container.resolve('em'),
        container: ctx.container,
        userId: ctx.auth?.sub ?? '',
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
    })
    if (!intercepted.ok) {
      return NextResponse.json(intercepted.body, { status: intercepted.statusCode })
    }
    return NextResponse.json(intercepted.body, { status: intercepted.statusCode })
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }
    console.error('[wms.sales-orders] DELETE warehouse-assignment failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Sales order warehouse assignment',
  methods: {
    GET: {
      summary: 'Get warehouse assignment for sales order',
      description:
        'Returns the explicit WMS warehouse assignment for a sales order, or null when none is set.',
      responses: [
        { status: 200, description: 'Assignment state', schema: assignmentResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    PUT: {
      summary: 'Assign warehouse to sales order',
      description:
        'Creates or replaces the explicit warehouse assignment for a sales order.',
      requestBody: { contentType: 'application/json', schema: salesOrderWarehouseAssignBodySchema },
      responses: [
        { status: 200, description: 'Warehouse assigned', schema: assignSuccessSchema },
        { status: 201, description: 'Warehouse assigned', schema: assignSuccessSchema },
      ],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Warehouse not found', schema: errorSchema },
        { status: 422, description: 'Warehouse is inactive', schema: errorSchema },
      ],
    },
    PATCH: {
      summary: 'Patch warehouse assignment for sales order',
      description: 'Same as PUT — upserts the explicit warehouse assignment.',
      requestBody: { contentType: 'application/json', schema: salesOrderWarehouseAssignBodySchema },
      responses: [{ status: 200, description: 'Warehouse assigned', schema: assignSuccessSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    DELETE: {
      summary: 'Remove warehouse assignment from sales order',
      description: 'Clears the explicit assignment so enricher and automation fall back again.',
      responses: [{ status: 200, description: 'Assignment removed', schema: okSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
  },
}
