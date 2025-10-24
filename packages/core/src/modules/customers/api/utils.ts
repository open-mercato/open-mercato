import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { parseWithCustomFields } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import type { z } from 'zod'

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

export function parseScopedCommandInput<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
  ctx: ScopedCtx,
  translate: TranslateFn,
  options: { requireOrganization?: boolean } = {},
): z.infer<TSchema> & { customFields?: Record<string, unknown> } {
  const scoped = withScopedPayload(
    (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>,
    ctx,
    translate,
    options,
  )
  const { parsed, custom } = parseWithCustomFields(schema, scoped)
  if (custom && Object.keys(custom).length > 0) {
    return {
      ...parsed,
      customFields: custom,
    } as z.infer<TSchema> & { customFields?: Record<string, unknown> }
  }
  return parsed as z.infer<TSchema> & { customFields?: Record<string, unknown> }
}
