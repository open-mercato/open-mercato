import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import {
  gatewayTransactionAssignmentSchema,
  replaceGatewayTransactionAssignmentsSchema,
} from '../../../../data/validators'
import type { PaymentGatewayService } from '../../../../lib/gateway-service'
import { paymentGatewaysTag } from '../../../openapi'

export const metadata = {
  path: '/payment_gateways/transactions/[id]/assignments',
  POST: { requireAuth: true, requireFeatures: ['payment_gateways.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['payment_gateways.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['payment_gateways.manage'] },
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function mapAssignments(rows: Array<{ id: string; entityType: string; entityId: string; createdAt?: Date | null }>) {
  return {
    items: rows.map((assignment) => ({
      id: assignment.id,
      entityType: assignment.entityType,
      entityId: assignment.entityId,
      createdAt: toIsoString(assignment.createdAt),
    })),
  }
}

async function resolveRequestContext(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return { errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const service = container.resolve('paymentGatewayService') as PaymentGatewayService
  const scope = { organizationId: auth.orgId as string, tenantId: auth.tenantId }

  return {
    auth,
    container,
    em,
    service,
    scope,
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  const context = await resolveRequestContext(req)
  if ('errorResponse' in context) return context.errorResponse

  const resolvedParams = await params
  const transactionId = resolvedParams?.id
  if (!transactionId) {
    return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
  }

  const payload = await readJsonSafe<unknown>(req)
  const parsed = gatewayTransactionAssignmentSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const guard = await validateCrudMutationGuard(context.container, {
    tenantId: context.scope.tenantId,
    organizationId: context.scope.organizationId,
    userId: context.auth.sub ?? '',
    resourceKind: 'payment_gateways.transaction',
    resourceId: transactionId,
    operation: 'custom',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsed.data,
  })
  if (guard && !guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status })
  }

  const assignments = await context.service.assignTransaction(transactionId, parsed.data, context.scope)

  if (guard?.ok && guard.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(context.container, {
      tenantId: context.scope.tenantId,
      organizationId: context.scope.organizationId,
      userId: context.auth.sub ?? '',
      resourceKind: 'payment_gateways.transaction',
      resourceId: transactionId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guard.metadata ?? null,
    })
  }

  return NextResponse.json(mapAssignments(assignments), { status: 200 })
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  const context = await resolveRequestContext(req)
  if ('errorResponse' in context) return context.errorResponse

  const resolvedParams = await params
  const transactionId = resolvedParams?.id
  if (!transactionId) {
    return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
  }

  const payload = await readJsonSafe<unknown>(req)
  const parsed = replaceGatewayTransactionAssignmentsSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const guard = await validateCrudMutationGuard(context.container, {
    tenantId: context.scope.tenantId,
    organizationId: context.scope.organizationId,
    userId: context.auth.sub ?? '',
    resourceKind: 'payment_gateways.transaction',
    resourceId: transactionId,
    operation: 'custom',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsed.data,
  })
  if (guard && !guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status })
  }

  const assignments = await context.service.replaceTransactionAssignments(
    transactionId,
    parsed.data.assignments,
    context.scope,
  )

  if (guard?.ok && guard.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(context.container, {
      tenantId: context.scope.tenantId,
      organizationId: context.scope.organizationId,
      userId: context.auth.sub ?? '',
      resourceKind: 'payment_gateways.transaction',
      resourceId: transactionId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guard.metadata ?? null,
    })
  }

  return NextResponse.json(mapAssignments(assignments), { status: 200 })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  const context = await resolveRequestContext(req)
  if ('errorResponse' in context) return context.errorResponse

  const resolvedParams = await params
  const transactionId = resolvedParams?.id
  if (!transactionId) {
    return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
  }

  const payload = await readJsonSafe<unknown>(req)
  const parsed = gatewayTransactionAssignmentSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 })
  }

  const guard = await validateCrudMutationGuard(context.container, {
    tenantId: context.scope.tenantId,
    organizationId: context.scope.organizationId,
    userId: context.auth.sub ?? '',
    resourceKind: 'payment_gateways.transaction',
    resourceId: transactionId,
    operation: 'custom',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsed.data,
  })
  if (guard && !guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status })
  }

  const assignments = await context.service.deassignTransaction(transactionId, parsed.data, context.scope)

  if (guard?.ok && guard.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(context.container, {
      tenantId: context.scope.tenantId,
      organizationId: context.scope.organizationId,
      userId: context.auth.sub ?? '',
      resourceKind: 'payment_gateways.transaction',
      resourceId: transactionId,
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guard.metadata ?? null,
    })
  }

  return NextResponse.json(mapAssignments(assignments), { status: 200 })
}

export const openApi = {
  tags: [paymentGatewaysTag],
  summary: 'Manage transaction assignments',
  methods: {
    POST: {
      summary: 'Assign a transaction to an entity',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Updated transaction assignment list' },
      ],
    },
    PUT: {
      summary: 'Replace transaction assignments',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Updated transaction assignment list' },
      ],
    },
    DELETE: {
      summary: 'Remove a transaction assignment',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Updated transaction assignment list' },
      ],
    },
  },
}

export default POST
