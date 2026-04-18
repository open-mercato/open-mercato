/**
 * Shared helpers for catalog AI tool packs (Phase 1 WS-C, Steps 3.10/3.11).
 *
 * Centralizes the price-kind enumeration query used by both the base tool
 * (`catalog.list_price_kinds_base`, Step 3.10) and the D18 spec-named tool
 * (`catalog.list_price_kinds`, Step 3.11) so the two shipping tools share one
 * tenant-scoped query path instead of duplicating it.
 *
 * Keeping the shared piece tiny and query-shaped (not tool-shaped) means each
 * tool is free to project its own output without leaking concerns between the
 * packs.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CatalogPriceKind } from '../data/entities'
import type { CatalogToolContext } from './types'

export type ListPriceKindsCoreInput = {
  limit?: number
  offset?: number
}

export type ListPriceKindsCoreRow = {
  id: string
  code: string
  title: string
  displayMode: string
  currencyCode: string | null
  isPromotion: boolean
  isActive: boolean
  organizationId: string | null
  tenantId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type ListPriceKindsCoreResult = {
  items: ListPriceKindsCoreRow[]
  total: number
  limit: number
  offset: number
}

function resolveEm(ctx: CatalogToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CatalogToolContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

/**
 * Shared tenant-scoped enumeration of `CatalogPriceKind` rows.
 *
 * Uses `findWithDecryption` + post-filter. Price kinds are tenant-owned and
 * can be either organization-scoped (match `ctx.organizationId`) or
 * null-scoped (shared across the tenant); the `$or` below mirrors the
 * filter the base tool used pre-refactor so behavior stays identical.
 */
export async function listPriceKindsCore(
  ctx: CatalogToolContext,
  input: ListPriceKindsCoreInput,
  tenantId: string,
): Promise<ListPriceKindsCoreResult> {
  const em = resolveEm(ctx)
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0
  const where: Record<string, unknown> = { tenantId, deletedAt: null }
  if (ctx.organizationId) {
    where.$or = [{ organizationId: ctx.organizationId }, { organizationId: null }]
  }
  const [rows, total] = await Promise.all([
    findWithDecryption<CatalogPriceKind>(
      em,
      CatalogPriceKind,
      where as any,
      { limit, offset, orderBy: { code: 'asc' } as any } as any,
      buildScope(ctx, tenantId),
    ),
    em.count(CatalogPriceKind, where as any),
  ])
  const filtered = rows.filter((row) => row.tenantId === tenantId)
  return {
    items: filtered.map((row) => ({
      id: row.id,
      code: row.code,
      title: row.title,
      displayMode: row.displayMode,
      currencyCode: row.currencyCode ?? null,
      isPromotion: !!row.isPromotion,
      isActive: !!row.isActive,
      organizationId: row.organizationId ?? null,
      tenantId: row.tenantId ?? null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    })),
    total,
    limit,
    offset,
  }
}
