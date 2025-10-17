import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { todoLinkCreateSchema, todoLinkWithTodoCreateSchema } from '../../data/validators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { withScopedPayload } from '../utils'

const unlinkSchema = z.object({
  id: z.string().uuid(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
}

async function buildContext(
  req: Request
): Promise<{ ctx: CommandRuntimeContext; auth: Awaited<ReturnType<typeof getAuthFromRequest>>; translate: (key: string, fallback?: string) => string }> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  return { ctx, auth, translate }
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
    const { ctx, translate } = await buildContext(req)
    const raw = await req.json().catch(() => ({}))
    const scopedPayload = withScopedPayload(raw, ctx, translate)
    const input = todoLinkWithTodoCreateSchema.parse({
      ...scopedPayload,
      todoCustom: (scopedPayload as { todoCustom?: unknown; custom?: unknown }).todoCustom ?? (scopedPayload as { custom?: unknown }).custom,
    })

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
    const { translate } = await resolveTranslations()
    console.error('customers.todos.create failed', err)
    return NextResponse.json({ error: translate('customers.errors.todo_create_failed', 'Failed to create todo') }, { status: 400 })
  }
}

export async function PUT(req: Request) {
  try {
    const { ctx, translate } = await buildContext(req)
    const raw = await req.json().catch(() => ({}))
    const scopedPayload = withScopedPayload(raw, ctx, translate)
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
    const { translate } = await resolveTranslations()
    console.error('customers.todos.link failed', err)
    return NextResponse.json({ error: translate('customers.errors.todo_link_failed', 'Failed to link todo') }, { status: 400 })
  }
}

export async function DELETE(req: Request) {
  try {
    const { ctx, translate } = await buildContext(req)
    let body: unknown = {}
    try {
      body = await req.json()
    } catch {
      // ignore empty body
    }
    const params = new URL(req.url).searchParams
    const idValue = (body as { id?: string })?.id ?? params.get('id')
    if (!idValue) {
      throw new CrudHttpError(400, { error: translate('customers.errors.todo_link_required', 'Todo link id is required') })
    }
    const input = unlinkSchema.parse({ id: idValue })

    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute('customers.todos.unlink', { input, ctx })
    const response = NextResponse.json({ linkId: result?.linkId ?? null })
    attachOperationHeader(response, logEntry, result?.linkId ?? input.id)
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.todos.unlink failed', err)
    return NextResponse.json({ error: translate('customers.errors.todo_unlink_failed', 'Failed to unlink todo') }, { status: 400 })
  }
}
