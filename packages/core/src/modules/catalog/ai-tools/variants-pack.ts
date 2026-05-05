/**
 * `catalog.list_variants` (Phase 1 WS-C, Step 3.10).
 *
 * Enumerate variants for a single product with option values + media refs.
 *
 * Phase 3b of `.ai/specs/2026-04-27-ai-tools-api-backed-dry-refactor.md`:
 * `catalog.list_variants` is now an API-backed wrapper over
 * `GET /api/catalog/variants`. Tool name, schema, requiredFeatures, and
 * output shape are unchanged.
 */
import { z } from 'zod'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import type {
  AiApiOperationRequest,
  AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { assertTenantScope, type CatalogAiToolDefinition, type CatalogToolContext } from './types'

const listVariantsInput = z
  .object({
    productId: z.string().uuid().describe('Parent product id (UUID).'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

type ListVariantsInput = z.infer<typeof listVariantsInput>

type ListVariantsApiItem = {
  id?: string
  product_id?: string | null
  productId?: string | null
  name?: string | null
  sku?: string | null
  barcode?: string | null
  status_entry_id?: string | null
  statusEntryId?: string | null
  option_values?: unknown
  optionValues?: unknown
  default_media_id?: string | null
  defaultMediaId?: string | null
  default_media_url?: string | null
  defaultMediaUrl?: string | null
  weight_value?: string | number | null
  weightValue?: string | number | null
  weight_unit?: string | null
  weightUnit?: string | null
  dimensions?: unknown
  tax_rate?: string | number | null
  taxRate?: string | number | null
  tax_rate_id?: string | null
  taxRateId?: string | null
  is_default?: boolean | null
  isDefault?: boolean | null
  is_active?: boolean | null
  isActive?: boolean | null
  organization_id?: string | null
  organizationId?: string | null
  tenant_id?: string | null
  tenantId?: string | null
  created_at?: string | null
  createdAt?: string | null
}

type ListVariantsApiResponse = {
  items?: ListVariantsApiItem[]
  total?: number
}

type ListVariantsOutput = {
  items: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}

const listVariantsTool = defineApiBackedAiTool<
  ListVariantsInput,
  ListVariantsApiResponse,
  ListVariantsOutput
>({
  name: 'catalog.list_variants',
  displayName: 'List variants',
  description:
    'List the variants of a catalog product (including option values, SKU, barcode, default media ref). Returns { items, total, limit, offset }.',
  inputSchema: listVariantsInput,
  requiredFeatures: ['catalog.products.view'],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx as unknown as CatalogToolContext)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const page = Math.floor(offset / limit) + 1

    const query: Record<string, string | number | boolean | null | undefined> = {
      page,
      pageSize: limit,
      productId: input.productId,
    }

    const operation: AiApiOperationRequest = {
      method: 'GET',
      path: '/catalog/variants',
      query,
    }
    return operation
  },
  mapResponse: (response, input) => {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const data = (response.data ?? {}) as ListVariantsApiResponse
    const rawItems: ListVariantsApiItem[] = Array.isArray(data.items) ? data.items : []
    return {
      items: rawItems.map((row) => {
        const createdAtRaw = row.created_at ?? row.createdAt ?? null
        const createdAt = createdAtRaw ? new Date(String(createdAtRaw)).toISOString() : null
        return {
          id: row.id,
          name: row.name ?? null,
          sku: row.sku ?? null,
          barcode: row.barcode ?? null,
          statusEntryId: row.status_entry_id ?? row.statusEntryId ?? null,
          optionValues: row.option_values ?? row.optionValues ?? null,
          defaultMediaId: row.default_media_id ?? row.defaultMediaId ?? null,
          defaultMediaUrl: row.default_media_url ?? row.defaultMediaUrl ?? null,
          weightValue: row.weight_value ?? row.weightValue ?? null,
          weightUnit: row.weight_unit ?? row.weightUnit ?? null,
          dimensions: row.dimensions ?? null,
          taxRate: row.tax_rate ?? row.taxRate ?? null,
          taxRateId: row.tax_rate_id ?? row.taxRateId ?? null,
          isDefault: !!(row.is_default ?? row.isDefault),
          isActive: !!(row.is_active ?? row.isActive),
          productId: row.product_id ?? row.productId ?? null,
          organizationId: row.organization_id ?? row.organizationId ?? null,
          tenantId: row.tenant_id ?? row.tenantId ?? null,
          createdAt,
        }
      }),
      total: typeof data.total === 'number' ? data.total : 0,
      limit,
      offset,
    }
  },
}) as unknown as CatalogAiToolDefinition

export const variantsAiTools: CatalogAiToolDefinition[] = [listVariantsTool]

export default variantsAiTools
