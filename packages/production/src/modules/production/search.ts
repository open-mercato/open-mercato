/**
 * Search indexing for the production module (task 6.2 — final sweep).
 *
 * Only `ProductionOrder` and `ProductionBom` are indexed (spec §
 * Migration & Backward Compatibility: "stock movements and reports are not
 * search-indexed; orders/BOMs are... tenant-scoped indexing only"). Stock
 * movements, production reports, material reservations, and MRP runs/
 * suggestions are intentionally excluded from search — they are
 * append-only/high-volume operational records, not the kind of entity users
 * search for by name via Cmd+K.
 */
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import type {
  SearchModuleConfig,
  SearchBuildContext,
  SearchResultPresenter,
  SearchResultLink,
  SearchIndexSource,
} from '@open-mercato/shared/modules/search'

type SearchContext = SearchBuildContext & {
  tenantId: string
  queryEngine?: QueryEngine
}

function assertTenantContext(ctx: SearchBuildContext): asserts ctx is SearchContext {
  if (typeof ctx.tenantId !== 'string' || ctx.tenantId.length === 0) {
    throw new Error('[search.production] Missing tenantId in search build context')
  }
}

function appendLine(lines: string[], label: string, value: unknown) {
  if (value === null || value === undefined) return
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

async function loadProductName(ctx: SearchContext, productId: unknown): Promise<string | null> {
  const id = typeof productId === 'string' && productId.length ? productId : null
  if (!id || !ctx.queryEngine) return null
  try {
    const result = await ctx.queryEngine.query('catalog:product', {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? undefined,
      filters: { id },
      fields: ['id', 'name'],
      page: { page: 1, pageSize: 1 },
    })
    const row = result.items[0] as Record<string, unknown> | undefined
    const name = row?.name
    return typeof name === 'string' && name.length ? name : null
  } catch {
    return null
  }
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    // =========================================================================
    // Production Order
    // =========================================================================
    {
      entityId: 'production:production_order',
      enabled: true,
      priority: 8,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        assertTenantContext(ctx)
        const record = ctx.record
        const productName = await loadProductName(ctx, record.product_id ?? record.productId)
        const lines: string[] = []
        appendLine(lines, 'Order number', record.number)
        appendLine(lines, 'Status', record.status)
        appendLine(lines, 'Product', productName ?? (record.product_id ?? record.productId))
        appendLine(lines, 'Source', record.source_type ?? record.sourceType)
        if (!lines.length) return null

        const title = `Order #${record.number ?? record.id}`
        const subtitleParts: string[] = []
        if (productName) subtitleParts.push(productName)
        if (record.status) subtitleParts.push(String(record.status))

        return {
          text: lines,
          presenter: {
            title,
            subtitle: subtitleParts.length ? subtitlePartsJoin(subtitleParts) : undefined,
            icon: 'factory',
            badge: 'Production Order',
          },
          links: [
            {
              href: `/backend/production/orders/${encodeURIComponent(String(record.id))}`,
              label: title,
              kind: 'primary',
            },
          ],
          checksumSource: {
            number: record.number,
            status: record.status,
            productId: record.product_id ?? record.productId,
            productName,
            updatedAt: record.updated_at ?? record.updatedAt ?? null,
          },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        assertTenantContext(ctx)
        const record = ctx.record
        const productName = await loadProductName(ctx, record.product_id ?? record.productId)
        const subtitleParts: string[] = []
        if (productName) subtitleParts.push(productName)
        if (record.status) subtitleParts.push(String(record.status))
        return {
          title: `Order #${record.number ?? record.id}`,
          subtitle: subtitleParts.length ? subtitlePartsJoin(subtitleParts) : undefined,
          icon: 'factory',
          badge: 'Production Order',
        }
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const id = ctx.record.id
        if (!id) return null
        return `/backend/production/orders/${encodeURIComponent(String(id))}`
      },

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const id = ctx.record.id
        if (!id) return null
        return [
          {
            href: `/backend/production/orders/${encodeURIComponent(String(id))}`,
            label: 'View',
            kind: 'primary',
          },
        ]
      },

      fieldPolicy: {
        searchable: ['number', 'status'],
        hashOnly: [],
        excluded: [],
      },
      aclFeatures: ['production.orders.view'],
    },

    // =========================================================================
    // Production BOM
    // =========================================================================
    {
      entityId: 'production:production_bom',
      enabled: true,
      priority: 8,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        assertTenantContext(ctx)
        const record = ctx.record
        const productName = await loadProductName(ctx, record.product_id ?? record.productId)
        const lines: string[] = []
        appendLine(lines, 'Name', record.name)
        appendLine(lines, 'Version', record.version)
        appendLine(lines, 'Status', record.status)
        appendLine(lines, 'Product', productName ?? (record.product_id ?? record.productId))
        if (!lines.length) return null

        const title = String(record.name ?? `BOM v${record.version ?? ''}`)
        const subtitleParts: string[] = []
        if (productName) subtitleParts.push(productName)
        if (record.version != null) subtitleParts.push(`v${record.version}`)
        if (record.status) subtitleParts.push(String(record.status))

        return {
          text: lines,
          presenter: {
            title,
            subtitle: subtitleParts.length ? subtitlePartsJoin(subtitleParts) : undefined,
            icon: 'list-tree',
            badge: 'BOM',
          },
          links: [
            {
              href: `/backend/production/boms/${encodeURIComponent(String(record.id))}`,
              label: title,
              kind: 'primary',
            },
          ],
          checksumSource: {
            name: record.name,
            version: record.version,
            status: record.status,
            productId: record.product_id ?? record.productId,
            productName,
            updatedAt: record.updated_at ?? record.updatedAt ?? null,
          },
        }
      },

      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        assertTenantContext(ctx)
        const record = ctx.record
        const productName = await loadProductName(ctx, record.product_id ?? record.productId)
        const subtitleParts: string[] = []
        if (productName) subtitleParts.push(productName)
        if (record.version != null) subtitleParts.push(`v${record.version}`)
        if (record.status) subtitleParts.push(String(record.status))
        return {
          title: String(record.name ?? `BOM v${record.version ?? ''}`),
          subtitle: subtitleParts.length ? subtitlePartsJoin(subtitleParts) : undefined,
          icon: 'list-tree',
          badge: 'BOM',
        }
      },

      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const id = ctx.record.id
        if (!id) return null
        return `/backend/production/boms/${encodeURIComponent(String(id))}`
      },

      resolveLinks: async (ctx: SearchBuildContext): Promise<SearchResultLink[] | null> => {
        const id = ctx.record.id
        if (!id) return null
        return [
          {
            href: `/backend/production/boms/${encodeURIComponent(String(id))}`,
            label: 'View',
            kind: 'primary',
          },
        ]
      },

      fieldPolicy: {
        searchable: ['name', 'status'],
        hashOnly: [],
        excluded: [],
      },
      aclFeatures: ['production.technology.view'],
    },
  ],
}

function subtitlePartsJoin(parts: string[]): string {
  return parts.join(' · ')
}

export default searchConfig
export const config = searchConfig
