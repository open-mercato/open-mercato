import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export type Translate = (key: string, fallback?: string) => string

export type EcommerceWriteScope = { tenantId: string; organizationId: string }

export function resolveWriteScope(ctx: CrudCtx): EcommerceWriteScope {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: '[internal] ecommerce write scope is missing a tenant id' })
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: '[internal] ecommerce write scope is missing an organization id' })
  }
  return { tenantId, organizationId }
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
