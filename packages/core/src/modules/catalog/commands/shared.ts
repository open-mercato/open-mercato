import {
  CatalogProduct,
  CatalogOffer,
  CatalogProductVariant,
  CatalogOptionSchemaTemplate,
  CatalogPriceKind,
} from '../data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
export { ensureOrganizationScope, ensureSameScope } from '@open-mercato/shared/lib/commands/scope'
export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { env } from 'process'

type QueryIndexCrudAction = 'created' | 'updated' | 'deleted'
function logScopeViolation(
  ctx: CommandRuntimeContext,
  kind: 'tenant' | 'organization',
  expected: string,
  actual: string | null
): void {
  try {
    const requestInfo =
      ctx.request && typeof ctx.request === 'object'
        ? {
            method: (ctx.request as Request).method ?? undefined,
            url: (ctx.request as Request).url ?? undefined,
          }
        : null
    const scope = ctx.organizationScope
      ? {
          selectedId: ctx.organizationScope.selectedId ?? null,
          tenantId: ctx.organizationScope.tenantId ?? null,
          allowedIdsCount: Array.isArray(ctx.organizationScope.allowedIds)
            ? ctx.organizationScope.allowedIds.length
            : null,
          filterIdsCount: Array.isArray(ctx.organizationScope.filterIds)
            ? ctx.organizationScope.filterIds.length
            : null,
        }
      : null
    if (env.NODE_ENV !== 'test') {
      console.warn('[catalog.scope] Forbidden scope mismatch detected', {
        scopeKind: kind,
        expectedId: expected,
        actualId: actual,
        userId: ctx.auth?.sub ?? null,
        actorTenantId: ctx.auth?.tenantId ?? null,
        actorOrganizationId: ctx.auth?.orgId ?? null,
        selectedOrganizationId: ctx.selectedOrganizationId ?? null,
        organizationIdsCount: Array.isArray(ctx.organizationIds) ? ctx.organizationIds.length : null,
        scope,
        request: requestInfo,
      })
    }
  } catch {
    // best-effort logging; ignore secondary failures
  }
}

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    logScopeViolation(ctx, 'tenant', tenantId, currentTenant)
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

export function ensureSameTenant(entity: Pick<{ tenantId: string }, 'tenantId'>, tenantId: string): void {
  if (entity.tenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Cross-tenant relation forbidden' })
  }
}

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (!value) throw new CrudHttpError(404, { error: message })
  return value
}

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
    .replace(/^-+|-+$/g, '')
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

export async function requireProduct(
  em: EntityManager,
  id: string,
  message = 'Catalog product not found'
): Promise<CatalogProduct> {
  const product = await em.findOne(CatalogProduct, { id, deletedAt: null })
  if (!product) throw new CrudHttpError(404, { error: message })
  return product
}

export async function requireVariant(
  em: EntityManager,
  id: string,
  message = 'Catalog variant not found'
): Promise<CatalogProductVariant> {
  const variant = await findOneWithDecryption(
    em,
    CatalogProductVariant,
    { id, deletedAt: null },
    { populate: ['product'] },
  )
  if (!variant) throw new CrudHttpError(404, { error: message })
  return variant
}

export async function requireOffer(
  em: EntityManager,
  id: string,
  message = 'Catalog offer not found'
): Promise<CatalogOffer> {
  const offer = await em.findOne(CatalogOffer, { id })
  if (!offer) throw new CrudHttpError(404, { error: message })
  return offer
}

export async function requirePriceKind(
  em: EntityManager,
  id: string,
  message = 'Catalog price kind not found'
): Promise<CatalogPriceKind> {
  const priceKind = await em.findOne(CatalogPriceKind, { id, deletedAt: null })
  if (!priceKind) throw new CrudHttpError(404, { error: message })
  return priceKind
}

export async function requireOptionSchemaTemplate(
  em: EntityManager,
  id: string,
  message = 'Option schema not found'
): Promise<CatalogOptionSchemaTemplate> {
  const schema = await em.findOne(CatalogOptionSchemaTemplate, { id, deletedAt: null })
  if (!schema) throw new CrudHttpError(404, { error: message })
  return schema
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

  let bus: { emitEvent: (event: string, payload: any, options?: any) => Promise<void> } | null = null
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
  await bus.emitEvent(eventName, payload).catch(() => undefined)
}
