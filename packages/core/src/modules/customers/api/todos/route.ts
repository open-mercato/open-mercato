import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { todoLinkCreateSchema, todoLinkWithTodoCreateSchema } from '../../data/validators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const unlinkSchema = z.object({
  id: z.string().uuid(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
}

async function buildContext(req: Request): Promise<{ ctx: CommandRuntimeContext; auth: Awaited<ReturnType<typeof getAuthFromRequest>> }> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth) throw new CrudHttpError(401, { error: 'Unauthorized' })
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  return { ctx, auth }
}

function attachOperationHeader(response: NextResponse, logEntry: any, fallbackId: string | null) {
  if (!response || !logEntry || !logEntry.undoToken || !logEntry.id || !logEntry.commandId) return
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? 'customers.todoLink',
      resourceId: logEntry.resourceId ?? fallbackId,
      executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
    })
  )
}

export async function POST(req: Request) {
  try {
    const { ctx, auth } = await buildContext(req)
    const raw = await req.json().catch(() => ({}))
    const organizationId = raw?.organizationId ?? ctx.selectedOrganizationId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: 'organizationId is required' })
    const tenantId = raw?.tenantId ?? auth.tenantId ?? null
    if (!tenantId) throw new CrudHttpError(400, { error: 'tenantId is required' })

    const scopedPayload = { ...raw, organizationId, tenantId }
    const input = todoLinkWithTodoCreateSchema.parse(scopedPayload)

    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute('customers.todos.create', { input, ctx })
    const response = NextResponse.json(
      {
        todoId: result?.todoId ?? null,
        linkId: result?.linkId ?? null,
      },
      { status: 201 }
    )
    attachOperationHeader(response, logEntry, result?.linkId ?? null)
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.todos.create failed', err)
    return NextResponse.json({ error: 'Failed to create todo' }, { status: 400 })
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, auth } = await buildContext(req)
    const raw = await req.json().catch(() => ({}))
    const organizationId = raw?.organizationId ?? ctx.selectedOrganizationId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: 'organizationId is required' })
    const tenantId = raw?.tenantId ?? auth.tenantId ?? null
    if (!tenantId) throw new CrudHttpError(400, { error: 'tenantId is required' })

    const scopedPayload = { ...raw, organizationId, tenantId }
    const input = todoLinkCreateSchema.parse(scopedPayload)

    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute('customers.todos.link', { input, ctx })
    const response = NextResponse.json({ linkId: result?.linkId ?? null })
    attachOperationHeader(response, logEntry, result?.linkId ?? null)
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.todos.link failed', err)
    return NextResponse.json({ error: 'Failed to link todo' }, { status: 400 })
  }
}

export async function DELETE(req: Request) {
  try {
    const { ctx } = await buildContext(req)
    let body: unknown = {}
    try {
      body = await req.json()
    } catch {
      // ignore empty body
    }
    const params = new URL(req.url).searchParams
    const id = (body as { id?: string })?.id ?? params.get('id')
    const input = unlinkSchema.parse({ id })

    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute('customers.todos.unlink', { input, ctx })
    const response = NextResponse.json({ linkId: result?.linkId ?? null })
    attachOperationHeader(response, logEntry, result?.linkId ?? input.id)
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('customers.todos.unlink failed', err)
    return NextResponse.json({ error: 'Failed to unlink todo' }, { status: 400 })
  }
}
