import {
  CatalogProduct,
  CatalogOffer,
  CatalogProductVariant,
  CatalogOptionSchemaTemplate,
  CatalogPriceKind,
} from '../data/entities'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
export { ensureOrganizationScope, ensureSameScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

type QueryIndexCrudAction = 'created' | 'updated' | 'deleted'

export function ensureSameTenant(entity: Pick<{ tenantId: string }, 'tenantId'>, tenantId: string): void {
  if (entity.tenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Cross-tenant relation forbidden' })
  }
}

export { assertFound } from '@open-mercato/shared/lib/crud/errors'

export function cloneJson<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

const OPTION_SCHEMA_CODE_MAX_LENGTH = 150

export function randomSuffix(length = 6): string {
  return Math.random().toString(36).slice(2, 2 + length)
}

export function normalizeOptionSchemaCode(value?: string | null): string {
  if (!value || typeof value !== 'string') return ''
  const ascii = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  const slug = ascii
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(?:^-+|-+$)/g, '')
  return slug.slice(0, OPTION_SCHEMA_CODE_MAX_LENGTH)
}

export function resolveOptionSchemaCode(opts: {
  code?: string | null
  name?: string | null
  fallback?: string | null
  uniqueHint?: string | null
}): string {
  const baseCandidate =
    normalizeOptionSchemaCode(opts.code) ||
    normalizeOptionSchemaCode(opts.name) ||
    normalizeOptionSchemaCode(opts.fallback)
  let resolved = baseCandidate || ''
  if (!resolved) {
    resolved = `schema-${randomSuffix()}`
  }
  if (opts.uniqueHint) {
    const hinted = normalizeOptionSchemaCode(`${resolved}-${opts.uniqueHint}`)
    if (hinted) {
      resolved = hinted
    }
  }
  return resolved || `schema-${randomSuffix()}`
}

export function toNumericString(value: number | null | undefined): string | null {
  if (value === undefined || value === null) return null
  return value.toString()
}

export type RequireScope = {
  tenantId: string | null
  organizationId: string | null
}

// Derives the actor's effective tenant/org scope for entry-point lookups, mirroring
// the bypass semantics of ensureTenantScope/ensureOrganizationScope: tenant is always
// strict, organization is left unrestricted for super-admins and global-org actors.
export function commandActorScope(ctx: CommandRuntimeContext): RequireScope {
  const orgUnrestricted = ctx.auth?.isSuperAdmin === true || ctx.organizationScope?.allowedIds === null
  return {
    tenantId: ctx.auth?.tenantId ?? null,
    organizationId: orgUnrestricted ? null : (ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null),
  }
}

function applyScopeToWhere(where: Record<string, unknown>, scope: RequireScope): void {
  if (scope.tenantId != null) where.tenantId = scope.tenantId
  if (scope.organizationId != null) where.organizationId = scope.organizationId
}

export async function requireProduct(
  em: EntityManager,
  id: string,
  scope: RequireScope,
  message = 'Catalog product not found'
): Promise<CatalogProduct> {
  const where: Record<string, unknown> = { id, deletedAt: null }
  applyScopeToWhere(where, scope)
  const product = await findOneWithDecryption(
    em,
    CatalogProduct,
    where as FilterQuery<CatalogProduct>,
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!product) throw new CrudHttpError(404, { error: message })
  return product
}

export async function requireVariant(
  em: EntityManager,
  id: string,
  scope: RequireScope,
  message = 'Catalog variant not found'
): Promise<CatalogProductVariant> {
  const where: Record<string, unknown> = { id, deletedAt: null }
  applyScopeToWhere(where, scope)
  const variant = await findOneWithDecryption(
    em,
    CatalogProductVariant,
    where as FilterQuery<CatalogProductVariant>,
    { populate: ['product'] },
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!variant) throw new CrudHttpError(404, { error: message })
  return variant
}

export async function requireOffer(
  em: EntityManager,
  id: string,
  scope: RequireScope,
  message = 'Catalog offer not found'
): Promise<CatalogOffer> {
  const where: Record<string, unknown> = { id }
  applyScopeToWhere(where, scope)
  const offer = await findOneWithDecryption(
    em,
    CatalogOffer,
    where as FilterQuery<CatalogOffer>,
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!offer) throw new CrudHttpError(404, { error: message })
  return offer
}

export async function requirePriceKind(
  em: EntityManager,
  id: string,
  scope: RequireScope,
  message = 'Catalog price kind not found'
): Promise<CatalogPriceKind> {
  // Price kinds are tenant-global: organization_id is always null and the unique key is
  // (tenant_id, code). Scope by tenant only — applying a concrete org would never match the
  // null row. Tenant scoping still closes the cross-tenant read hole this helper guards.
  const where: Record<string, unknown> = { id, deletedAt: null }
  applyScopeToWhere(where, { tenantId: scope.tenantId, organizationId: null })
  const priceKind = await findOneWithDecryption(
    em,
    CatalogPriceKind,
    where as FilterQuery<CatalogPriceKind>,
    undefined,
    { tenantId: scope.tenantId, organizationId: null },
  )
  if (!priceKind) throw new CrudHttpError(404, { error: message })
  return priceKind
}

export async function requireOptionSchemaTemplate(
  em: EntityManager,
  id: string,
  scope: RequireScope,
  message = 'Option schema not found'
): Promise<CatalogOptionSchemaTemplate> {
  const where: Record<string, unknown> = { id, deletedAt: null }
  applyScopeToWhere(where, scope)
  const schema = await findOneWithDecryption(
    em,
    CatalogOptionSchemaTemplate,
    where as FilterQuery<CatalogOptionSchemaTemplate>,
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!schema) throw new CrudHttpError(404, { error: message })
  return schema
}

export function getErrorConstraint(error: unknown): string | null {
  const errObj = error as { constraint?: unknown; message?: unknown }
  if (typeof errObj.constraint === 'string') return errObj.constraint
  if (typeof errObj.message === 'string') {
    return null
  }
  return null
}

export function getErrorMessage(error: unknown): string {
  const errObj = error as { message?: unknown }
  return typeof errObj.message === 'string' ? errObj.message : ''
}

export async function emitCatalogQueryIndexEvent(
  ctx: CommandRuntimeContext,
  params: {
    entityType: string
    recordId: string
    organizationId?: string | null
    tenantId?: string | null
    action: QueryIndexCrudAction
    coverageBaseDelta?: number
  },
): Promise<void> {
  const entityType = String(params.entityType || '')
  const recordId = String(params.recordId || '')
  if (!entityType || !recordId) return

  let bus: { emitEvent: (event: string, payload: Record<string, unknown>, options?: Record<string, unknown>) => Promise<void> } | null = null
  try {
    bus = ctx.container.resolve('eventBus')
  } catch {
    bus = null
  }
  if (!bus?.emitEvent) return

  const payload: Record<string, unknown> = {
    entityType,
    recordId,
    organizationId: params.organizationId ?? null,
    tenantId: params.tenantId ?? null,
    crudAction: params.action,
  }
  if (params.coverageBaseDelta !== undefined) {
    payload.coverageBaseDelta = params.coverageBaseDelta
  } else if (params.action === 'created') {
    payload.coverageBaseDelta = 1
  } else if (params.action === 'deleted') {
    payload.coverageBaseDelta = -1
  }

  const eventName = params.action === 'deleted' ? 'query_index.delete_one' : 'query_index.upsert_one'
  await bus.emitEvent(eventName, payload, {
    tenantId: params.tenantId ?? null,
    organizationId: params.organizationId ?? null,
  }).catch(() => undefined)
}
