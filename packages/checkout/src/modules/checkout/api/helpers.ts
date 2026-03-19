import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CHECKOUT_PASSWORD_COOKIE } from '../lib/constants'
import { verifyCheckoutPasswordAccess } from '../lib/utils'

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

export function readCheckoutPasswordCookie(req: Request): string | null {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${CHECKOUT_PASSWORD_COOKIE}=([^;]+)`))
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export function requireCheckoutPasswordSession(req: Request, slug: string): void {
  const token = readCheckoutPasswordCookie(req)
  if (!verifyCheckoutPasswordAccess(token, slug)) {
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
        details: error.issues,
      },
      { status: 400 },
    )
  }
  const message = error instanceof Error ? error.message : 'Unexpected error'
  return NextResponse.json({ error: message }, { status: 500 })
}
