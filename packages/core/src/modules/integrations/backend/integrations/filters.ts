import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export const INTEGRATION_MARKETPLACE_CATEGORIES = [
  'all',
  'payment',
  'shipping',
  'data_sync',
  'communication',
  'notification',
  'storage',
  'webhook',
] as const

export const INTEGRATION_MARKETPLACE_HEALTH_STATUSES = ['healthy', 'degraded', 'unhealthy', 'unconfigured'] as const

export function buildIntegrationMarketplaceFilterDefs(
  t: TranslateFn,
  bundleOptions: { id: string; title: string }[],
): FilterDef[] {
  return [
    {
      id: 'category',
      label: t('integrations.marketplace.filters.category', 'Category'),
      type: 'select',
      options: INTEGRATION_MARKETPLACE_CATEGORIES.map((category) => ({
        value: category,
        label: t(`integrations.marketplace.categories.${category}`),
      })),
      formatValue: (value) => t(`integrations.marketplace.categories.${value}`, String(value)),
    },
    {
      id: 'bundleId',
      label: t('integrations.marketplace.filters.bundle', 'Bundle'),
      type: 'select',
      options: [
        { value: '', label: t('integrations.marketplace.filters.anyBundle', 'Any bundle') },
        ...bundleOptions.map((bundle) => ({ value: bundle.id, label: bundle.title })),
      ],
      formatValue: (value) => bundleOptions.find((b) => b.id === value)?.title ?? String(value),
    },
    {
      id: 'isEnabled',
      label: t('integrations.marketplace.filters.enabledState', 'Enabled'),
      type: 'select',
      options: [
        { value: '', label: t('integrations.marketplace.filters.any', 'Any') },
        { value: 'true', label: t('integrations.marketplace.enabled', 'Enabled') },
        { value: 'false', label: t('integrations.marketplace.disabled', 'Disabled') },
      ],
      formatValue: (value) =>
        value === 'true'
          ? t('integrations.marketplace.enabled', 'Enabled')
          : value === 'false'
            ? t('integrations.marketplace.disabled', 'Disabled')
            : '',
    },
    {
      id: 'healthStatus',
      label: t('integrations.marketplace.filters.health', 'Health'),
      type: 'select',
      options: [
        { value: '', label: t('integrations.marketplace.filters.anyHealth', 'Any health') },
        ...INTEGRATION_MARKETPLACE_HEALTH_STATUSES.map((status) => ({
          value: status,
          label: t(`integrations.marketplace.health.${status}`, status),
        })),
      ],
      formatValue: (value) => t(`integrations.marketplace.health.${value}`, String(value)),
    },
  ]
}

export function normalizeIntegrationMarketplaceFilterValues(values: FilterValues): FilterValues {
  const category = typeof values.category === 'string' ? values.category : ''
  const bundleId = typeof values.bundleId === 'string' ? values.bundleId : ''
  const isEnabled = typeof values.isEnabled === 'string' ? values.isEnabled : ''
  const healthStatus = typeof values.healthStatus === 'string' ? values.healthStatus : ''

  const next: FilterValues = {}
  if (category && category !== 'all') next.category = category
  if (bundleId) next.bundleId = bundleId
  if (isEnabled === 'true' || isEnabled === 'false') next.isEnabled = isEnabled
  if (healthStatus) next.healthStatus = healthStatus
  return next
}

export function getIntegrationMarketplaceCategory(values: FilterValues): string {
  const category = typeof values.category === 'string' ? values.category : ''
  return category || 'all'
}

export function getListQueryFromFilterValues(values: FilterValues): {
  category?: string
  bundleId?: string
  isEnabled?: boolean
  healthStatus?: string
} {
  const normalized = normalizeIntegrationMarketplaceFilterValues(values)
  const category = typeof normalized.category === 'string' ? normalized.category : undefined
  const bundleId = typeof normalized.bundleId === 'string' ? normalized.bundleId : undefined
  const healthStatus = typeof normalized.healthStatus === 'string' ? normalized.healthStatus : undefined
  const rawEnabled = typeof normalized.isEnabled === 'string' ? normalized.isEnabled : ''
  const isEnabled = rawEnabled === 'true' ? true : rawEnabled === 'false' ? false : undefined
  return {
    ...(category ? { category } : {}),
    ...(bundleId ? { bundleId } : {}),
    ...(isEnabled !== undefined ? { isEnabled } : {}),
    ...(healthStatus ? { healthStatus } : {}),
  }
}
