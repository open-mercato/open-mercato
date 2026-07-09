import { SortDir, type QueryEngine } from '@open-mercato/shared/lib/query/types'
import type {
  SearchBuildContext,
  SearchIndexSource,
  SearchModuleConfig,
  SearchResultLink,
  SearchResultPresenter,
} from '@open-mercato/shared/modules/search'
import { E } from '#generated/entities.ids.generated'

type SearchContext = SearchBuildContext & {
  tenantId: string
  queryEngine?: QueryEngine
}

function assertTenantContext(ctx: SearchBuildContext): asserts ctx is SearchContext {
  if (typeof ctx.tenantId !== 'string' || ctx.tenantId.length === 0) {
    throw new Error('[search.warranty_claims] Missing tenantId in search build context')
  }
}

function readString(record: Record<string, unknown>, snakeKey: string, camelKey?: string): string | null {
  const value = record[snakeKey] ?? (camelKey ? record[camelKey] : undefined)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function appendLine(lines: string[], label: string, value: unknown): void {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  if (!trimmed.length) return
  lines.push(`${label}: ${trimmed}`)
}

function resolveClaimId(record: Record<string, unknown>): string | null {
  return readString(record, 'id', 'id')
}

function resolvePresenter(record: Record<string, unknown>): SearchResultPresenter {
  const claimNumber = readString(record, 'claim_number', 'claimNumber') ?? 'Warranty claim'
  const customerName = readString(record, 'customer_name', 'customerName')
  const claimType = readString(record, 'claim_type', 'claimType')
  const status = readString(record, 'status', 'status')
  const subtitle = [customerName, claimType].filter((value): value is string => Boolean(value)).join(' · ')
  return {
    title: claimNumber,
    subtitle: subtitle || undefined,
    icon: 'shield-check',
    badge: status ?? undefined,
  }
}

async function loadClaimLineRows(ctx: SearchContext, claimId: string): Promise<Array<Record<string, unknown>>> {
  if (!ctx.queryEngine) return []
  try {
    const result = await ctx.queryEngine.query<Record<string, unknown>>(E.warranty_claims.warranty_claim_line, {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId ?? undefined,
      filters: { claim_id: { $eq: claimId } },
      fields: [
        'id',
        'line_no',
        'sku',
        'product_name',
        'serial_number',
        'lot_number',
        'fault_code',
        'warranty_status',
        'disposition',
        'line_status',
      ],
      page: { page: 1, pageSize: 200 },
      sort: [{ field: 'line_no', dir: SortDir.Asc }],
    })
    return result.items
  } catch (err) {
    console.warn('[search.warranty_claims] Failed to load claim lines', {
      claimId,
      error: err instanceof Error ? err.message : err,
    })
    return []
  }
}

function appendLineRows(lines: string[], lineRows: Array<Record<string, unknown>>): void {
  for (const row of lineRows) {
    appendLine(lines, 'Line SKU', readString(row, 'sku', 'sku') ?? '')
    appendLine(lines, 'Line product', readString(row, 'product_name', 'productName') ?? '')
    appendLine(lines, 'Serial number', readString(row, 'serial_number', 'serialNumber') ?? '')
    appendLine(lines, 'Lot number', readString(row, 'lot_number', 'lotNumber') ?? '')
    appendLine(lines, 'Fault code', readString(row, 'fault_code', 'faultCode') ?? '')
    appendLine(lines, 'Warranty status', readString(row, 'warranty_status', 'warrantyStatus') ?? '')
    appendLine(lines, 'Disposition', readString(row, 'disposition', 'disposition') ?? '')
    appendLine(lines, 'Line status', readString(row, 'line_status', 'lineStatus') ?? '')
  }
}

function buildClaimUrl(record: Record<string, unknown>): string | null {
  const claimId = resolveClaimId(record)
  return claimId ? `/backend/warranty_claims/${claimId}` : null
}

export const searchConfig: SearchModuleConfig = {
  entities: [
    {
      entityId: E.warranty_claims.warranty_claim,
      enabled: true,
      priority: 20,

      buildSource: async (ctx: SearchBuildContext): Promise<SearchIndexSource | null> => {
        assertTenantContext(ctx)
        const record = ctx.record
        const lines: string[] = []
        appendLine(lines, 'Claim number', readString(record, 'claim_number', 'claimNumber') ?? '')
        appendLine(lines, 'Customer', readString(record, 'customer_name', 'customerName') ?? '')
        appendLine(lines, 'Order number', readString(record, 'order_number', 'orderNumber') ?? '')
        appendLine(lines, 'Claim type', readString(record, 'claim_type', 'claimType') ?? '')
        appendLine(lines, 'Status', readString(record, 'status', 'status') ?? '')
        appendLine(lines, 'Vendor', readString(record, 'vendor_name', 'vendorName') ?? '')
        appendLine(lines, 'Vendor reference', readString(record, 'vendor_ref', 'vendorRef') ?? '')

        const claimId = resolveClaimId(record)
        const lineRows = claimId ? await loadClaimLineRows(ctx, claimId) : []
        appendLineRows(lines, lineRows)
        if (!lines.length) return null

        const presenter = resolvePresenter(record)
        const url = buildClaimUrl(record)
        const links: SearchResultLink[] = url ? [{ href: url, label: presenter.title, kind: 'primary' }] : []
        return {
          text: lines,
          presenter,
          links,
          checksumSource: {
            record,
            customFields: ctx.customFields,
            lineRows,
          },
        }
      },

      formatResult: (ctx: SearchBuildContext): SearchResultPresenter | null => {
        assertTenantContext(ctx)
        return resolvePresenter(ctx.record)
      },

      resolveUrl: (ctx: SearchBuildContext): string | null => buildClaimUrl(ctx.record),

      resolveLinks: (ctx: SearchBuildContext): SearchResultLink[] | null => {
        const url = buildClaimUrl(ctx.record)
        return url ? [{ href: url, label: 'Open claim', kind: 'secondary' }] : null
      },

      fieldPolicy: {
        searchable: [
          'claim_number',
          'claim_type',
          'status',
          'priority',
          'customer_name',
          'vendor_name',
          'vendor_ref',
        ],
        hashOnly: ['customer_id', 'order_id', 'sales_return_id', 'replacement_order_id', 'source_claim_id'],
        excluded: [
          'tenant_id',
          'organization_id',
          'assignee_user_id',
          'deleted_at',
          'notes',
          'resolution_summary',
          'fault_description',
          'inspection_notes',
          'rejection_reason_code',
        ],
      },
      aclFeatures: ['warranty_claims.claim.view'],
    },
  ],
}

export default searchConfig
