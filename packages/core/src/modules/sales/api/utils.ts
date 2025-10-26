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
      error: translate('sales.configuration.errors.tenant_required', 'Tenant context is required'),
    })
  }

  const resolvedOrg =
    (source as { organizationId?: string })?.organizationId ??
    ctx.selectedOrganizationId ??
    ctx.auth?.orgId ??
    null

  if (requireOrganization && !resolvedOrg) {
    throw new CrudHttpError(400, {
      error: translate('sales.configuration.errors.organization_required', 'Organization context is required'),
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
  options: { requireOrganization?: boolean } = {}
): z.infer<TSchema> & { customFields?: Record<string, unknown> } {
  const scoped = withScopedPayload(
    (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>,
    ctx,
    translate,
    options
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

export function requireRecordId(
  candidate: unknown,
  ctx: ScopedCtx,
  translate: TranslateFn,
  options: { fieldName?: string } = {}
): string {
  const field = options.fieldName ?? 'id'
  const id =
    typeof candidate === 'string'
      ? candidate.trim()
      : candidate && typeof candidate === 'object'
        ? typeof (candidate as Record<string, unknown>)[field] === 'string'
          ? String((candidate as Record<string, unknown>)[field])
          : null
        : null
  if (id && id.length > 0) return id
  throw new CrudHttpError(400, {
    error: translate('sales.configuration.errors.id_required', 'Record identifier is required.'),
  })
}

export function resolveCrudRecordId(
  parsed: unknown,
  ctx: ScopedCtx,
  translate: TranslateFn,
  options: { fieldName?: string; queryParam?: string } = {}
): string {
  const fieldName = options.fieldName ?? 'id'
  const queryParam = options.queryParam ?? fieldName

  if (parsed && typeof parsed === 'object') {
    const body = (parsed as Record<string, unknown>).body
    try {
      if (body && typeof body === 'object') {
        return requireRecordId(body, ctx, translate, { fieldName })
      }
      return requireRecordId(parsed, ctx, translate, { fieldName })
    } catch {
      // fall back to other sources
    }

    const query = (parsed as Record<string, unknown>).query
    if (query && typeof query === 'object') {
      const candidate = (query as Record<string, unknown>)[queryParam]
      if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
    }
  }

  if (ctx.request instanceof Request) {
    const value = new URL(ctx.request.url).searchParams.get(queryParam)
    if (value && value.trim().length > 0) return value.trim()
  }

  throw new CrudHttpError(400, {
    error: translate('sales.configuration.errors.id_required', 'Record identifier is required.'),
  })
}
