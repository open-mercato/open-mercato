import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'

type ScopedCtx = (CommandRuntimeContext | CrudCtx) & {
  auth: { tenantId?: string | null; orgId?: string | null } | null
  selectedOrganizationId?: string | null
}

type TranslateFn = (key: string, fallback?: string) => string

export function withScopedPayload<T extends Record<string, unknown>>(
  payload: T | null | undefined,
  ctx: ScopedCtx,
  translate: TranslateFn,
  options: { requireOrganization?: boolean } = {}
): T & { tenantId: string; organizationId?: string } {
  const requireOrganization = options.requireOrganization !== false
  const source = payload ? { ...payload } : {}
  const tenantId = (source as { tenantId?: string })?.tenantId ?? ctx.auth?.tenantId ?? null
  if (!tenantId) {
    throw new CrudHttpError(400, {
      error: translate('customers.errors.tenant_required', 'Tenant context is required'),
    })
  }

  const resolvedOrg =
    (source as { organizationId?: string })?.organizationId ??
    ctx.selectedOrganizationId ??
    ctx.auth?.orgId ??
    null

  if (requireOrganization && !resolvedOrg) {
    throw new CrudHttpError(400, {
      error: translate('customers.errors.organization_required', 'Organization context is required'),
    })
  }

  const scoped = {
    ...source,
    tenantId,
  } as T & { tenantId: string; organizationId?: string }

  if (resolvedOrg) scoped.organizationId = resolvedOrg

  return scoped
}
