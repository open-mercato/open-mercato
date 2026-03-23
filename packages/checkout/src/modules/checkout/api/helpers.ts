import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CHECKOUT_PASSWORD_COOKIE } from '../lib/constants'
import { verifyCheckoutAccessToken } from '../lib/utils'

export async function requireAdminContext(req: Request): Promise<{
  auth: Exclude<AuthContext, null>
  container: Awaited<ReturnType<typeof createRequestContainer>>
  em: EntityManager
  commandBus: CommandBus
}> {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }
  const container = await createRequestContainer()
  return {
    auth,
    container,
    em: container.resolve('em') as EntityManager,
    commandBus: container.resolve('commandBus') as CommandBus,
  }
}

export async function requirePreviewContext(
  req: Request,
  feature = 'checkout.view',
): Promise<{
  auth: Exclude<AuthContext, null>
  container: Awaited<ReturnType<typeof createRequestContainer>>
  em: EntityManager
}> {
  const context = await requireAdminContext(req)
  const allowed = await userHasCheckoutFeature(context.container, context.auth, feature)
  if (!allowed) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
  return {
    auth: context.auth,
    container: context.container,
    em: context.em,
  }
}

export function buildCommandRuntimeContext(
  req: Request,
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  auth: AuthContext,
): CommandRuntimeContext {
  return {
    container,
    auth,
    organizationScope: null,
    selectedOrganizationId: auth?.orgId ?? null,
    organizationIds: auth?.orgId ? [auth.orgId] : null,
    request: req,
  }
}

export async function userHasCheckoutFeature(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  auth: Exclude<AuthContext, null>,
  feature: string,
): Promise<boolean> {
  const rbac = container.resolve('rbacService') as RbacService
  return rbac.userHasAllFeatures(auth.sub, [feature], {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })
}

export function readCheckoutAccessCookie(req: Request): string | null {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${CHECKOUT_PASSWORD_COOKIE}=([^;]+)`))
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export function requireCheckoutPasswordSession(
  req: Request,
  slug: string,
  options?: { linkId?: string | null; sessionVersion?: Date | string | null },
): void {
  const token = readCheckoutAccessCookie(req)
  if (!verifyCheckoutAccessToken(token, slug, options)) {
    throw new CrudHttpError(401, { error: 'Password verification is required' })
  }
}

export function handleCheckoutRouteError(error: unknown) {
  if (error instanceof CrudHttpError) {
    return NextResponse.json(error.body ?? { error: error.message }, { status: error.status })
  }
  if (error instanceof z.ZodError) {
    const fieldErrors = error.issues.reduce<Record<string, string>>((result, issue) => {
      const path = issue.path.map((part) => String(part)).join('.')
      if (!path || result[path]) return result
      result[path] = issue.message
      return result
    }, {})
    return NextResponse.json(
      {
        error: 'Validation failed',
        fieldErrors,
        details: error.issues.map(({ path, code, message }) => ({ path, code, message })),
      },
      { status: 400 },
    )
  }
  if (error instanceof Error) {
    console.error('[checkout] Unhandled route error:', error.message)
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

type CheckoutOperationLogLike = {
  id?: string | null
  undoToken?: string | null
  commandId?: string | null
  actionLabel?: string | null
  resourceKind?: string | null
  resourceId?: string | null
  createdAt?: Date | string | null
}

export function attachOperationMetadataHeader(
  response: NextResponse,
  logEntry: CheckoutOperationLogLike | null | undefined,
  defaults: {
    resourceKind: string
    resourceId?: string | null
  },
): NextResponse {
  if (!logEntry?.id || !logEntry.undoToken || !logEntry.commandId) return response
  const executedAt = logEntry.createdAt instanceof Date
    ? logEntry.createdAt.toISOString()
    : typeof logEntry.createdAt === 'string' && logEntry.createdAt
      ? logEntry.createdAt
      : new Date().toISOString()
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? defaults.resourceKind,
      resourceId: logEntry.resourceId ?? defaults.resourceId ?? null,
      executedAt,
    }),
  )
  return response
}
