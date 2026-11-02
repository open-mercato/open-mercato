import type { InjectionBulkActionWidget } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import {
  fetchFilteredProductIds,
  readRowId,
  type BulkActionContext,
} from '../../../lib/productListSelection'
import { CATALOG_PRODUCT_AI_CATEGORIZE_MAX_PRODUCTS } from '../../../lib/aiCategorization/bulkLimits'

type Translate = NonNullable<BulkActionContext['translate']>
type BulkScope = 'selected' | 'filtered'

type SettingsResponse = { effective?: boolean }
type BulkResponse = { ok?: boolean; progressJobId?: string | null; message?: string }

const identityTranslate: Translate = (_key, fallback) => fallback

function resolveTranslate(context: BulkActionContext): Translate {
  return context.translate ?? identityTranslate
}

async function isFeatureEffective(): Promise<boolean> {
  const result = await apiCall<SettingsResponse>('/api/catalog/ai-categorization/settings')
  return result.ok && result.result?.effective === true
}

async function startAiCategorizeJob(
  ids: string[],
  scope: BulkScope,
  translate: Translate,
): Promise<{ ok: boolean; message?: string; progressJobId?: string | null }> {
  const result = await apiCall<BulkResponse>('/api/catalog/ai-categorization/bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productIds: ids, scope }),
  })
  if (result.status === 409) {
    return {
      ok: false,
      message: translate(
        'catalog.aiCategorization.bulk.unavailable',
        'AI category suggestions are not available. Check the catalog AI settings.',
      ),
    }
  }
  if (!result.ok || !result.result?.progressJobId) {
    return {
      ok: false,
      message: translate('catalog.aiCategorization.bulk.error', 'Failed to start AI categorization.'),
    }
  }
  return {
    ok: true,
    progressJobId: result.result.progressJobId,
    message: translate(
      'catalog.aiCategorization.bulk.started',
      'AI categorization started. Track progress in the top bar.',
    ),
  }
}

async function confirmAndStart(
  ids: string[],
  scope: BulkScope,
  context: BulkActionContext,
) {
  const translate = resolveTranslate(context)
  const max = CATALOG_PRODUCT_AI_CATEGORIZE_MAX_PRODUCTS

  if (ids.length > max) {
    return {
      ok: false,
      message: translate(
        'catalog.aiCategorization.bulk.tooMany',
        'AI categorization handles at most {max} products per run. Narrow the selection or filters.',
        { max },
      ),
    }
  }

  if (!(await isFeatureEffective())) {
    return {
      ok: false,
      message: translate(
        'catalog.aiCategorization.bulk.unavailable',
        'AI category suggestions are not available. Check the catalog AI settings.',
      ),
    }
  }

  const confirmed = await context.confirm?.({
    title: translate('catalog.aiCategorization.bulk.confirmTitle', 'Suggest categories with AI?'),
    text: translate(
      'catalog.aiCategorization.bulk.confirmText',
      'Suggest categories for {count} products? Product data is sent to the configured AI provider, which needs at least {count} model requests (more for deeper category trees). Suggestions are stored for review and no product changes until you accept them.',
      { count: ids.length },
    ),
    confirmText: translate('catalog.aiCategorization.bulk.confirm', 'Start'),
    cancelText: translate('common.cancel', 'Cancel'),
  })
  if (confirmed === false) {
    return { ok: false, message: undefined }
  }

  return startAiCategorizeJob(ids, scope, translate)
}

const widget: InjectionBulkActionWidget = {
  metadata: {
    id: 'catalog.injection.product-ai-categorize',
    features: ['catalog.ai_categorization.use'],
    priority: 30,
  },
  bulkActions: [
    {
      id: 'catalog.products.ai-categorize-selected',
      label: 'catalog.aiCategorization.bulk.selected.label',
      icon: 'sparkles',
      onExecute: async (selectedRows, rawContext) => {
        const context = (rawContext ?? {}) as BulkActionContext
        const ids = selectedRows
          .map((row) => readRowId(row))
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
        if (ids.length === 0) {
          return {
            ok: false,
            message: resolveTranslate(context)(
              'catalog.aiCategorization.bulk.noneSelected',
              'Select at least one product to categorize.',
            ),
          }
        }
        return confirmAndStart(ids, 'selected', context)
      },
    },
    {
      id: 'catalog.products.ai-categorize-filtered',
      label: 'catalog.aiCategorization.bulk.filtered.label',
      icon: 'sparkles',
      requiresSelection: false,
      onExecute: async (_selectedRows, rawContext) => {
        const context = (rawContext ?? {}) as BulkActionContext
        const ids = await fetchFilteredProductIds(context, {
          stopAfter: CATALOG_PRODUCT_AI_CATEGORIZE_MAX_PRODUCTS,
        })
        if (ids.length === 0) {
          return {
            ok: false,
            message: resolveTranslate(context)(
              'catalog.aiCategorization.bulk.noneFiltered',
              'No products match the current filters.',
            ),
          }
        }
        return confirmAndStart(ids, 'filtered', context)
      },
    },
  ],
}

export default widget
