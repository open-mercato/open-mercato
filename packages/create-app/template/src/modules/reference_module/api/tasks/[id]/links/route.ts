import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ReferenceTask, ReferenceTaskLink } from '../../../../data/entities'
import { referenceTaskLinkCreateSchema } from '../../../../data/validators'
import { executeReferenceCommand, resolveReferenceRouteContext, runReferenceGuardCallbacks, runReferenceRouteGuards } from '../../../context'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['reference_module.view'] },
  POST: { requireAuth: true, requireFeatures: ['reference_module.manage'] },
}

export async function GET(request: Request, context: { params?: { id?: string } }) {
  const routeContext = await resolveReferenceRouteContext(request)
  if (!routeContext) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = paramsSchema.parse(context.params)
  const task = await findOneWithDecryption(
    routeContext.em,
    ReferenceTask,
    { id, ...routeContext.scope, deletedAt: null },
    undefined,
    routeContext.scope,
  )
  if (!task) return NextResponse.json({ error: 'Reference task not found' }, { status: 404 })
  const links = await findWithDecryption(
    (routeContext.em as EntityManager).fork(),
    ReferenceTaskLink,
    { task, ...routeContext.scope, deletedAt: null },
    undefined,
    routeContext.scope,
  )
  return NextResponse.json({
    items: links.map((link) => ({
      id: link.id,
      targetKind: link.targetKind,
      targetId: link.targetId,
      targetLabel: link.targetLabelSnapshot ?? null,
      updatedAt: link.updatedAt.toISOString(),
    })),
    total: links.length,
  })
}

export async function POST(request: Request, context: { params?: { id?: string } }) {
  try {
    const routeContext = await resolveReferenceRouteContext(request)
    if (!routeContext) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = paramsSchema.parse(context.params)
    const body = referenceTaskLinkCreateSchema.parse(await request.json())
    const guards = await runReferenceRouteGuards(routeContext, {
      resourceKind: 'reference_module.reference_task_link', resourceId: id, operation: 'create', payload: body,
    })
    if (!guards.ok) return NextResponse.json(guards.errorBody, { status: guards.errorStatus })
    const { result, response } = await executeReferenceCommand<{ linkId: string }>(
      routeContext,
      'reference_module.reference_task.link.create',
      { taskId: id, ...body },
      201,
    )
    await runReferenceGuardCallbacks(guards.afterSuccessCallbacks, {
      tenantId: routeContext.scope.tenantId,
      organizationId: routeContext.scope.organizationId,
      userId: routeContext.auth.sub,
      resourceKind: 'reference_module.reference_task_link',
      resourceId: result.linkId,
      operation: 'create',
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
  summary: 'Reference task links',
  methods: {
    GET: { summary: 'List scoped task links', responses: [{ status: 200, description: 'Task links' }] },
    POST: { summary: 'Create scoped task link', requestBody: { schema: referenceTaskLinkCreateSchema }, responses: [{ status: 201, description: 'Link created' }, { status: 409, description: 'Optimistic-lock conflict' }] },
  },
}
