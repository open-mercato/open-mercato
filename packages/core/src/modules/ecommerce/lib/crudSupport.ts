import type { EntityManager } from '@mikro-orm/postgresql'
import type { EntityName, FilterQuery } from '@mikro-orm/core'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export type Translate = (key: string, fallback?: string) => string

export type EcommerceWriteScope = { tenantId: string; organizationId: string }

export function resolveWriteScope(ctx: CrudCtx): EcommerceWriteScope {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: '[internal] ecommerce write scope is missing a tenant id' })
  const organizationId = resolveScopeOrganizationId(ctx)
  if (!organizationId) {
    throw new CrudHttpError(400, { error: '[internal] ecommerce write scope is missing an organization id' })
  }
  return { tenantId, organizationId }
}

export function resolveScopeOrganizationId(ctx: CrudCtx): string | null {
  return ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
}

type ScopedRecord = { id: string; tenantId: string; organizationId: string; deletedAt?: Date | null }

/**
 * Writes, reference checks, enrichers and the branding routes all work in the single organization of
 * `resolveWriteScope`, while the CRUD factory also admits descendant organizations. Updates and
 * deletes are held to that organization too, so a parent selection cannot half-edit a child
 * organization's record; a record outside it answers the same 404 as a missing one.
 */
export async function assertRecordInWriteScope<T extends ScopedRecord>(
  ctx: CrudCtx,
  entityName: EntityName<T>,
  id: unknown,
  notFound: { key: string; fallback: string },
): Promise<void> {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = resolveScopeOrganizationId(ctx)
  if (typeof id !== 'string' || !id || !tenantId || !organizationId) return
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const record = await findOneWithDecryption(
    em,
    entityName,
    { id, tenantId, deletedAt: null } as FilterQuery<T>,
    undefined,
    { tenantId, organizationId },
  )
  if (!record || record.organizationId === organizationId) return
  throw new CrudHttpError(404, { error: await translateEcommerceError(notFound.key, notFound.fallback) })
}

export function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

/**
 * A client-facing error message from the `ecommerce.errors.*` catalogue, falling back to `fallback`
 * when translations cannot be loaded (route catch blocks must still answer).
 */
export async function translateEcommerceError(key: string, fallback: string): Promise<string> {
  try {
    const { translate } = await resolveTranslations()
    return translate(key, fallback)
  } catch {
    return fallback
  }
}

export const ECOMMERCE_INTERNAL_ERROR_KEY = 'ecommerce.errors.internal'
export const ECOMMERCE_INTERNAL_ERROR_FALLBACK = 'Something went wrong. Try again.'

export async function ecommerceInternalErrorBody(): Promise<{ error: string }> {
  return { error: await translateEcommerceError(ECOMMERCE_INTERNAL_ERROR_KEY, ECOMMERCE_INTERNAL_ERROR_FALLBACK) }
}

export function fieldError(status: number, fieldErrors: Record<string, string>): CrudHttpError {
  const [message] = Object.values(fieldErrors)
  return new CrudHttpError(status, { error: message, fieldErrors })
}
