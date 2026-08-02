import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { executeReferenceCommand, resolveReferenceRouteContext, runReferenceGuardCallbacks, runReferenceRouteGuards } from '../../../../context'

const paramsSchema = z.object({ id: z.string().uuid(), linkId: z.string().uuid() })

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['reference_module.manage'] },
}

export async function DELETE(request: Request, context: { params?: { id?: string; linkId?: string } }) {
  try {
    const routeContext = await resolveReferenceRouteContext(request)
    if (!routeContext) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id, linkId } = paramsSchema.parse(context.params)
    const guards = await runReferenceRouteGuards(routeContext, {
      resourceKind: 'reference_module.reference_task_link', resourceId: linkId, operation: 'delete', payload: null,
    })
    if (!guards.ok) return NextResponse.json(guards.errorBody, { status: guards.errorStatus })
    const { response } = await executeReferenceCommand(routeContext, 'reference_module.reference_task.link.delete', { taskId: id, linkId })
    await runReferenceGuardCallbacks(guards.afterSuccessCallbacks, {
      tenantId: routeContext.scope.tenantId,
      organizationId: routeContext.scope.organizationId,
      userId: routeContext.auth.sub,
      resourceKind: 'reference_module.reference_task_link',
      resourceId: linkId,
      operation: 'delete',
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
  summary: 'Remove reference task link',
  methods: {
    DELETE: { summary: 'Soft-delete a scoped task link', responses: [{ status: 200, description: 'Link removed' }, { status: 409, description: 'Optimistic-lock conflict' }] },
  },
}
