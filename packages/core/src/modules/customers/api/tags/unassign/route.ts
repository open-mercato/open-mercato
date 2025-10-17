import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { tagAssignmentSchema } from '../../../data/validators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['customers.activities.manage'] },
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

export async function POST(req: Request) {
  try {
    const { ctx, auth, translate } = await buildContext(req)
    const body = await req.json().catch(() => ({}))
    const organizationId = body?.organizationId ?? ctx.selectedOrganizationId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
    }
    const tenantId = body?.tenantId ?? auth.tenantId ?? null
    if (!tenantId) {
      throw new CrudHttpError(400, { error: translate('customers.errors.tenant_required', 'Tenant context is required') })
    }

    const input = tagAssignmentSchema.parse({
      ...body,
      organizationId,
      tenantId,
    })

    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const { result, logEntry } = await commandBus.execute('customers.tags.unassign', { input, ctx })
    const response = NextResponse.json({ id: result?.assignmentId ?? result?.id ?? null })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? 'customers.tagAssignment',
          resourceId: logEntry.resourceId ?? (result?.assignmentId ?? null),
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        })
      )
    }
    return response
  } catch (err) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(err.body, { status: err.status })
    }
    const { translate } = await resolveTranslations()
    console.error('customers.tags.unassign failed', err)
    return NextResponse.json({ error: translate('customers.errors.unassign_failed', 'Failed to unassign tag') }, { status: 400 })
  }
}
