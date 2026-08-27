import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { guardWriteBody, IGNORED_FIELDS, type UnwritableKey } from '@open-mercato/shared/lib/crud/write-payload'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
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
  /**
   * Rename snake_case keys onto the camelCase names the schema declares.
   *
   * On by default, and strictly additive: these keys were previously stripped by
   * Zod and silently discarded, so nothing that used to be written stops being
   * written. It exists because the read endpoints emit snake_case — a caller that
   * round-trips a record it just read otherwise writes nothing and is told it
   * succeeded.
   */
  aliasSnakeCaseKeys?: boolean
  /**
   * Real fields that cannot change after creation. Rejected with 400 rather than
   * accepted and dropped, so `entityId` on an activity update no longer reports
   * success while leaving the record where it was.
   */
  immutableFields?: readonly string[]
  /**
   * Reject unknown keys with 400 instead of reporting them back in the response.
   *
   * Off by default. Widget injection routinely puts non-schema keys into form
   * payloads, so flipping this on globally would break working forms; callers
   * that own their payload end-to-end can opt in.
   */
  rejectUnknownFields?: boolean
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
): z.infer<TSchema> & { customFields?: Record<string, unknown>; ignoredFields?: UnwritableKey[] } {
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
  const { base: rawBase, custom } = splitCustomFieldPayload(scoped)

  // Same guard the CRUD factory applies to its own write paths, so a command
  // action reached through `mapInput` behaves identically to an ORM-backed route.
  const guarded = guardWriteBody(schema, rawBase, {
    aliasSnakeCaseKeys: options.aliasSnakeCaseKeys,
    immutableFields: options.immutableFields,
    rejectUnknownFields: options.rejectUnknownFields,
    translate,
  })
  const base = guarded.body as Record<string, unknown>
  const unknownHits = guarded.ignoredFields

  const hasCustomFields = custom && Object.keys(custom).length > 0
  const candidates: Array<Record<string, unknown>> = hasCustomFields
    ? [base, { ...base, customFields: custom }]
    : [base]

  let parsed: z.infer<TSchema> | undefined
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      parsed = schema.parse(candidate) as z.infer<TSchema>
      break
    } catch (err) {
      lastError = err
    }
  }
  if (!parsed) {
    if (lastError instanceof Error) throw lastError
    throw new CrudHttpError(400, { error: translate('errors.invalid_input', 'Invalid input') })
  }

  const parsedWithCustom = hasCustomFields
    ? Object.assign({}, parsed, { customFields: custom })
    : parsed

  // Anything still unwritable is surfaced on the parsed input so the route can
  // report it back to the caller. A 200 that lists what it ignored is the
  // minimum a caller needs to assert on; silently dropping it is the bug.
  // Rides on a Symbol so it does not become a stray field in command inputs,
  // mutation-guard payloads, sync events or action-log snapshots.
  const withReport = unknownHits.length > 0
    ? Object.assign({}, parsedWithCustom, { [IGNORED_FIELDS]: unknownHits })
    : parsedWithCustom

  return withReport as z.infer<TSchema> & {
    customFields?: Record<string, unknown>
    ignoredFields?: UnwritableKey[]
  }
}

function normalizeTenant(candidate: unknown): string | null {
  if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  return null
}

function authIsSuperAdmin(auth: ScopedContext['auth']): boolean {
  if (!auth) return false
  return (auth as Record<string, unknown>).isSuperAdmin === true
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
