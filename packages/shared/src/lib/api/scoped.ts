import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { parseWithCustomFields } from '@open-mercato/shared/lib/commands/helpers'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import type { z } from 'zod'

export type ScopedContext = (CommandRuntimeContext | CrudCtx) & {
  auth: { tenantId?: string | null; orgId?: string | null } | null
  selectedOrganizationId?: string | null
}

export type TranslateFn = (key: string, fallback?: string) => string

export type ScopedMessage = {
  key: string
  fallback: string
}

export type ScopedPayloadMessages = {
  tenantRequired?: ScopedMessage
  organizationRequired?: ScopedMessage
  idRequired?: ScopedMessage
  tenantForbidden?: ScopedMessage
}

export type ScopedPayloadOptions = {
  requireOrganization?: boolean
  messages?: ScopedPayloadMessages
}

const DEFAULT_MESSAGES: Required<ScopedPayloadMessages> = {
  tenantRequired: { key: 'errors.tenant_required', fallback: 'Tenant context is required.' },
  organizationRequired: { key: 'errors.organization_required', fallback: 'Organization context is required.' },
  idRequired: { key: 'errors.id_required', fallback: 'Record identifier is required.' },
  tenantForbidden: { key: 'errors.tenant_forbidden', fallback: 'You are not allowed to target this tenant.' },
}

function resolveMessage(messages: ScopedPayloadMessages | undefined, key: keyof ScopedPayloadMessages): ScopedMessage {
  const override = messages?.[key]
  if (override && typeof override.key === 'string' && override.key.length > 0) {
    return {
      key: override.key,
      fallback: override.fallback ?? DEFAULT_MESSAGES[key]!.fallback,
    }
  }
  return DEFAULT_MESSAGES[key]!
}

export function withScopedPayload<T extends Record<string, unknown>>(
  payload: T | null | undefined,
  ctx: ScopedContext,
  translate: TranslateFn,
  options: ScopedPayloadOptions = {}
): T & { tenantId: string; organizationId?: string } {
  const requireOrganization = options.requireOrganization !== false
  const source = payload ? { ...payload } : {}
  const tenantId = (source as { tenantId?: string })?.tenantId ?? ctx.auth?.tenantId ?? null
  if (!tenantId) {
    const msg = resolveMessage(options.messages, 'tenantRequired')
    throw new CrudHttpError(400, { error: translate(msg.key, msg.fallback) })
  }

  const resolvedOrg =
    (source as { organizationId?: string })?.organizationId ??
    ctx.selectedOrganizationId ??
    ctx.auth?.orgId ??
    null

  if (requireOrganization && !resolvedOrg) {
    const msg = resolveMessage(options.messages, 'organizationRequired')
    throw new CrudHttpError(400, { error: translate(msg.key, msg.fallback) })
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
  ctx: ScopedContext,
  translate: TranslateFn,
  options: ScopedPayloadOptions = {}
): z.infer<TSchema> & { customFields?: Record<string, unknown> } {
  const scoped = withScopedPayload(
    (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>,
    ctx,
    translate,
    options
  )
  const actorTenantId = normalizeTenant(ctx.auth?.tenantId)
  const requestedTenantId = normalizeTenant(scoped.tenantId)
  const isSuperAdmin = authIsSuperAdmin(ctx.auth)
  if (!isSuperAdmin) {
    if (actorTenantId) {
      if (!requestedTenantId || requestedTenantId !== actorTenantId) {
        const msg = resolveMessage(options.messages, 'tenantForbidden')
        throw new CrudHttpError(403, { error: translate(msg.key, msg.fallback) })
      }
    } else if (requestedTenantId) {
      const msg = resolveMessage(options.messages, 'tenantForbidden')
      throw new CrudHttpError(403, { error: translate(msg.key, msg.fallback) })
    }
  }
  const { parsed, custom } = parseWithCustomFields(schema, scoped)
  if (custom && Object.keys(custom).length > 0) {
    return Object.assign({}, parsed, {
      customFields: custom,
    }) as z.infer<TSchema> & { customFields?: Record<string, unknown> }
  }
  return parsed as z.infer<TSchema> & { customFields?: Record<string, unknown> }
}

function normalizeTenant(candidate: unknown): string | null {
  if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  return null
}

function authIsSuperAdmin(auth: ScopedContext['auth']): boolean {
  if (!auth) return false
  if ((auth as Record<string, unknown>).isSuperAdmin === true) return true
  const roles = Array.isArray((auth as Record<string, unknown>).roles)
    ? ((auth as { roles: string[] }).roles ?? [])
    : []
  return roles.some((role) => typeof role === 'string' && role.toLowerCase() === 'superadmin')
}

export function requireRecordId(
  candidate: unknown,
  ctx: ScopedContext,
  translate: TranslateFn,
  options: ScopedPayloadOptions = {}
): string {
  const fieldName = 'id'
  const id =
    typeof candidate === 'string'
      ? candidate.trim()
      : candidate && typeof candidate === 'object'
        ? typeof (candidate as Record<string, unknown>)[fieldName] === 'string'
          ? String((candidate as Record<string, unknown>)[fieldName])
          : null
        : null
  if (id && id.length > 0) return id
  const msg = resolveMessage(options.messages, 'idRequired')
  throw new CrudHttpError(400, { error: translate(msg.key, msg.fallback) })
}

export function resolveCrudRecordId(
  parsed: unknown,
  ctx: ScopedContext,
  translate: TranslateFn,
  options: ScopedPayloadOptions & { fieldName?: string; queryParam?: string } = {}
): string {
  const fieldName = options.fieldName ?? 'id'
  const queryParam = options.queryParam ?? fieldName

  const tryRequire = (value: unknown): string | null => {
    try {
      return requireRecordId(value, ctx, translate, options)
    } catch {
      return null
    }
  }

  if (parsed && typeof parsed === 'object') {
    const body = (parsed as Record<string, unknown>).body
    const fromBody = body && typeof body === 'object' ? tryRequire(body) : null
    if (fromBody) return fromBody

    const fallback = tryRequire(parsed)
    if (fallback) return fallback

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

  const msg = resolveMessage(options.messages, 'idRequired')
  throw new CrudHttpError(400, { error: translate(msg.key, msg.fallback) })
}

export function createScopedApiHelpers(baseOptions?: ScopedPayloadOptions) {
  return {
    withScopedPayload: <T extends Record<string, unknown>>(
      payload: T | null | undefined,
      ctx: ScopedContext,
      translate: TranslateFn,
      options: ScopedPayloadOptions = {}
    ) => withScopedPayload(payload, ctx, translate, { ...baseOptions, ...options }),
    parseScopedCommandInput: <TSchema extends z.ZodTypeAny>(
      schema: TSchema,
      payload: unknown,
      ctx: ScopedContext,
      translate: TranslateFn,
      options: ScopedPayloadOptions = {}
    ) => parseScopedCommandInput(schema, payload, ctx, translate, { ...baseOptions, ...options }),
    requireRecordId: (
      candidate: unknown,
      ctx: ScopedContext,
      translate: TranslateFn,
      options: ScopedPayloadOptions = {}
    ) => requireRecordId(candidate, ctx, translate, { ...baseOptions, ...options }),
    resolveCrudRecordId: (
      parsed: unknown,
      ctx: ScopedContext,
      translate: TranslateFn,
      options: ScopedPayloadOptions & { fieldName?: string; queryParam?: string } = {}
    ) => resolveCrudRecordId(parsed, ctx, translate, { ...baseOptions, ...options }),
  }
}
