import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { executeReferenceCommand, resolveReferenceRouteContext, runReferenceGuardCallbacks, runReferenceRouteGuards } from '../../../context'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['reference_module.manage'] },
}

export async function POST(request: Request, context: { params?: { id?: string } }) {
  try {
    const routeContext = await resolveReferenceRouteContext(request)
    if (!routeContext) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = paramsSchema.parse(context.params)
    const guards = await runReferenceRouteGuards(routeContext, {
      resourceKind: 'reference_module.reference_task', resourceId: id, operation: 'update', payload: null,
    })
    if (!guards.ok) return NextResponse.json(guards.errorBody, { status: guards.errorStatus })
    const { response } = await executeReferenceCommand(routeContext, 'reference_module.reference_task.restore', { id })
    await runReferenceGuardCallbacks(guards.afterSuccessCallbacks, {
      tenantId: routeContext.scope.tenantId,
      organizationId: routeContext.scope.organizationId,
      userId: routeContext.auth.sub,
      resourceKind: 'reference_module.reference_task',
      resourceId: id,
      operation: 'update',
      requestMethod: request.method,
      requestHeaders: request.headers,
    })
    return response
  } catch (error) {
    if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid input', details: error.issues }, { status: 400 })
    throw error
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Reference module',
  summary: 'Restore reference task',
  methods: {
    POST: { summary: 'Restore a soft-deleted task', responses: [{ status: 200, description: 'Task restored' }, { status: 409, description: 'Optimistic-lock conflict' }] },
  },
}
