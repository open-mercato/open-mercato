import type { InjectionBulkActionWidget } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

import {
  fetchFilteredProductIds,
  readRowId,
  type BulkActionContext,
} from '../../../lib/productListSelection'

async function startDeleteProductsJob(
  ids: string[],
  scope: 'selected' | 'filtered',
  context: BulkActionContext,
): Promise<string> {
  const translate = context.translate ?? ((_: string, fallback: string) => fallback)
  const result = await apiCall<{ ok: boolean; progressJobId: string | null }>(
    '/api/catalog/bulk-delete',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirm: true,
        ids,
        scope,
      }),
    },
  )

  if (!result.ok || !result.result?.progressJobId) {
    throw new Error(translate('catalog.bulkDelete.error', 'Failed to delete products.'))
  }

  return result.result.progressJobId
}

const widget: InjectionBulkActionWidget = {
  metadata: {
    id: 'catalog.injection.product-bulk-delete',
    priority: 40,
  },
  bulkActions: [
    {
      id: 'catalog.products.bulk-delete-selected',
      label: 'catalog.bulkDelete.selected.label',
      icon: 'trash-2',
      onExecute: async (selectedRows, rawContext) => {
        const context = (rawContext ?? {}) as BulkActionContext
        const translate = context.translate ?? ((_: string, fallback: string) => fallback)
        const ids = selectedRows
          .map((row) => readRowId(row))
          .filter((id): id is string => typeof id === 'string' && id.length > 0)

        if (ids.length === 0) {
          return {
            ok: false,
            message: translate('catalog.bulkDelete.noneSelected', 'Select at least one product to delete.'),
          }
        }

        const confirmed = await context.confirm?.({
          title: translate('catalog.bulkDelete.selected.confirmTitle', 'Delete selected products?'),
          text: translate(
            'catalog.bulkDelete.selected.confirmText',
            'Delete {count} selected products? This cannot be undone.',
            { count: ids.length },
          ),
          confirmText: translate('catalog.bulkDelete.confirm', 'Delete'),
          cancelText: translate('common.cancel', 'Cancel'),
          variant: 'destructive',
        })

        if (confirmed === false) {
          return { ok: false, message: undefined }
        }

        return {
          ok: true,
          progressJobId: await startDeleteProductsJob(ids, 'selected', context),
        }
      },
    },
    {
      id: 'catalog.products.bulk-delete-filtered',
      label: 'catalog.bulkDelete.filtered.label',
      icon: 'filter-x',
      requiresSelection: false,
      onExecute: async (_selectedRows, rawContext) => {
        const context = (rawContext ?? {}) as BulkActionContext
        const translate = context.translate ?? ((_: string, fallback: string) => fallback)
        const ids = await fetchFilteredProductIds(context)

        if (ids.length === 0) {
          return {
            ok: false,
            message: translate('catalog.bulkDelete.noneFiltered', 'No products match the current filters.'),
          }
        }

        const confirmed = await context.confirm?.({
          title: translate('catalog.bulkDelete.filtered.confirmTitle', 'Delete filtered products?'),
          text: translate(
            'catalog.bulkDelete.filtered.confirmText',
            'Delete {count} products matching the current filters? This cannot be undone.',
            { count: ids.length },
          ),
          confirmText: translate('catalog.bulkDelete.confirm', 'Delete'),
          cancelText: translate('common.cancel', 'Cancel'),
          variant: 'destructive',
        })

        if (confirmed === false) {
          return { ok: false, message: undefined }
        }

        return {
          ok: true,
          progressJobId: await startDeleteProductsJob(ids, 'filtered', context),
        }
      },
    },
  ],
}

export default widget
