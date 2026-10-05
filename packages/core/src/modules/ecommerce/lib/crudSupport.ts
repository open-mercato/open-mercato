import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

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

export function fieldError(status: number, fieldErrors: Record<string, string>): CrudHttpError {
  const [message] = Object.values(fieldErrors)
  return new CrudHttpError(status, { error: message, fieldErrors })
}
