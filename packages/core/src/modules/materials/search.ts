import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'

type SearchContext = SearchBuildContext & {
  tenantId: string
}

function assertTenantContext(ctx: SearchBuildContext): asserts ctx is SearchContext {
  if (typeof ctx.tenantId !== 'string' || ctx.tenantId.length === 0) {
    throw new Error('[search.materials] Missing tenantId in search build context')
  }
}

function pickString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (trimmed.length > 0) return trimmed
  }
  return null
}

function appendLine(lines: string[], label: string, value: unknown): void {
  if (value === null || value === undefined) return
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (!text.trim()) return
  lines.push(`${label}: ${text}`)
}

/**
 * Materials search configuration (Phase 1 Step 12).
 *
 * Phase 1 indexes the master Material entity. Sales-only attributes (`gtin`, `commodity_code`)
 * live on `material_sales_profiles` after the CTI refactor — the spec calls for a LEFT JOIN
 * during indexing so they remain searchable, but the `SearchModuleConfig` shape doesn't
 * expose join hooks today. Until the platform exposes a structured way to declare aux JOINs
 * (or the SearchIndexer learns to resolve them), we accept a small searchability gap for
 * gtin / commodity_code; users can still find sellable materials via code/name/description
 * matches and then drill into the Sales tab. Phase 2 follow-up.
 */
export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: 'materials:material',
      enabled: true,
      priority: 7,
      fieldPolicy: {
        searchable: ['code', 'name', 'description'],
        excluded: ['organization_id', 'tenant_id', 'replacement_material_id'],
      },
      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        assertTenantContext(ctx)
        const record = ctx.record
        const customFields = ctx.customFields ?? {}
        const code = pickString(record.code, record.id) ?? null
        const name = pickString(record.name, record.code) ?? null
        if (!code && !name) return null

        const lines: string[] = []
        appendLine(lines, 'Code', code)
        appendLine(lines, 'Name', name)
        appendLine(lines, 'Kind', record.kind)
        appendLine(lines, 'Lifecycle', record.lifecycle_state ?? record.lifecycleState)
        appendLine(lines, 'Description', record.description)
        // Custom fields are extensible (internal_notes, safety_data_sheet_url, plus tenant-defined).
        for (const [key, value] of Object.entries(customFields)) {
          if (value === null || value === undefined) continue
          appendLine(lines, key.replace(/^cf:/, ''), value)
        }

        return {
          text: lines.join('\n'),
          fields: {
            code,
            name,
            kind: record.kind ?? null,
            lifecycle_state: record.lifecycle_state ?? record.lifecycleState ?? null,
            is_purchasable: record.is_purchasable ?? record.isPurchasable ?? null,
            is_sellable: record.is_sellable ?? record.isSellable ?? null,
            is_stockable: record.is_stockable ?? record.isStockable ?? null,
            is_producible: record.is_producible ?? record.isProducible ?? null,
          },
          presenter: {
            title: code && name ? `${code} — ${name}` : (code ?? name ?? 'Material'),
            subtitle: `${record.kind ?? 'unknown'} · ${record.lifecycle_state ?? record.lifecycleState ?? 'draft'}`,
            icon: 'box',
            badge: 'Material',
          },
          checksumSource: {
            code,
            name,
            kind: record.kind,
            lifecycle: record.lifecycle_state ?? record.lifecycleState,
            description: record.description,
            customFields,
          },
        }
      },
      formatResult: async (ctx: SearchBuildContext): Promise<SearchResultPresenter | null> => {
        const record = ctx.record
        const code = pickString(record.code, record.id)
        const name = pickString(record.name, record.code)
        return {
          title: code && name ? `${code} — ${name}` : (code ?? name ?? 'Material'),
          subtitle: `${record.kind ?? 'unknown'} · ${record.lifecycle_state ?? record.lifecycleState ?? 'draft'}`,
          icon: 'box',
          badge: 'Material',
        }
      },
      resolveUrl: async (ctx: SearchBuildContext): Promise<string | null> => {
        const id = ctx.record.id
        if (!id) return null
        return `/backend/materials/${encodeURIComponent(String(id))}`
      },
    },
  ],
}

export const config = searchConfig
export default searchConfig
