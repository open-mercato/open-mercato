"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FilterBar, type FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Bell, Cog, CreditCard, HardDrive, LayoutGrid, MessageSquare, RefreshCw, Search, Truck, Webhook } from 'lucide-react'
import {
  buildIntegrationMarketplaceFilterDefs,
  getIntegrationMarketplaceCategory,
  getListQueryFromFilterValues,
  INTEGRATION_MARKETPLACE_CATEGORIES,
  normalizeIntegrationMarketplaceFilterValues,
} from './filters'

type IntegrationAnalytics = {
  lastActivityAt: string | null
  totalCount: number
  errorCount: number
  errorRate: number
  dailyCounts: number[]
}

type IntegrationItem = {
  id: string
  title: string
  description?: string
  category?: string
  tags?: string[]
  bundleId?: string
  author?: string
  company?: string
  version?: string
  isEnabled: boolean
  hasCredentials: boolean
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unconfigured'
  analytics: IntegrationAnalytics
}

type BundleItem = {
  id: string
  title: string
  description?: string
  icon?: string
  integrationCount: number
  enabledCount: number
}

type ListResponse = {
  items: IntegrationItem[]
  bundles: BundleItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  all: LayoutGrid,
  payment: CreditCard,
  shipping: Truck,
  data_sync: RefreshCw,
  communication: MessageSquare,
  notification: Bell,
  storage: HardDrive,
  webhook: Webhook,
}

const HEALTH_BADGE_CLASS: Record<string, string> = {
  healthy: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  degraded: 'bg-amber-500/15 text-amber-900 dark:text-amber-300',
  unhealthy: 'bg-destructive/15 text-destructive',
  unconfigured: 'bg-muted text-muted-foreground',
}

function buildListQueryString(input: {
  q?: string
  category?: string
  bundleId?: string
  isEnabled?: boolean
  healthStatus?: string
  sort?: string
  order?: string
  page?: number
  pageSize?: number
}): string {
  const params = new URLSearchParams()
  if (input.q) params.set('q', input.q)
  if (input.category) params.set('category', input.category)
  if (input.bundleId) params.set('bundleId', input.bundleId)
  if (input.isEnabled !== undefined) params.set('isEnabled', String(input.isEnabled))
  if (input.healthStatus) params.set('healthStatus', input.healthStatus)
  if (input.sort) params.set('sort', input.sort)
  if (input.order) params.set('order', input.order)
  if (input.page != null && input.page > 1) params.set('page', String(input.page))
  if (input.pageSize != null && input.pageSize !== 100) params.set('pageSize', String(input.pageSize))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

function LogSparkline({ counts, className }: { counts: number[]; className?: string }) {
  const max = Math.max(1, ...counts)
  const w = 72
  const h = 22
  const step = counts.length > 1 ? w / (counts.length - 1) : w
  const points = counts.map((count, index) => {
    const x = index * step
    const y = h - (count / max) * (h - 3) - 1.5
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={w} height={h} className={className} aria-hidden>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
        className="text-muted-foreground/80"
      />
    </svg>
  )
}

export default function IntegrationsMarketplacePage() {
  const [data, setData] = React.useState<ListResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [searchInput, setSearchInput] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sortField, setSortField] = React.useState<'title' | 'category' | 'enabledAt' | 'healthStatus'>('title')
  const [sortOrder, setSortOrder] = React.useState<'asc' | 'desc'>('asc')
  const [page, setPage] = React.useState(1)
  const [togglingIds, setTogglingIds] = React.useState<Set<string>>(new Set())
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const selectedCategory = React.useMemo(() => getIntegrationMarketplaceCategory(filterValues), [filterValues])

  const listQuery = React.useMemo(() => {
    const fromFilters = getListQueryFromFilterValues(filterValues)
    const category = selectedCategory !== 'all' ? selectedCategory : fromFilters.category
    return buildListQueryString({
      q: debouncedSearch || undefined,
      ...(category ? { category } : {}),
      ...(fromFilters.bundleId ? { bundleId: fromFilters.bundleId } : {}),
      ...(fromFilters.isEnabled !== undefined ? { isEnabled: fromFilters.isEnabled } : {}),
      ...(fromFilters.healthStatus ? { healthStatus: fromFilters.healthStatus } : {}),
      sort: sortField,
      order: sortOrder,
      page,
      pageSize: 100,
    })
  }, [debouncedSearch, filterValues, page, selectedCategory, sortField, sortOrder])

  const bundleFilterOptions = React.useMemo(
    () => (data?.bundles ?? []).map((bundle) => ({ id: bundle.id, title: bundle.title })),
    [data?.bundles],
  )

  const categoryFilters = React.useMemo(
    () => buildIntegrationMarketplaceFilterDefs(t, bundleFilterOptions),
    [bundleFilterOptions, t],
  )

  const load = React.useCallback(async () => {
    setIsLoading(true)
    const fallback: ListResponse = { items: [], bundles: [], total: 0, page: 1, pageSize: 100, totalPages: 1 }
    const call = await apiCall<ListResponse>(`/api/integrations${listQuery}`, undefined, { fallback })
    if (!call.ok) {
      flash(t('integrations.marketplace.loadError'), 'error')
      setIsLoading(false)
      return
    }
    setData(call.result ?? fallback)
    setIsLoading(false)
  }, [listQuery, t])

  React.useEffect(() => {
    void load()
  }, [load, scopeVersion])

  React.useEffect(() => {
    setPage(1)
  }, [debouncedSearch, filterValues, selectedCategory, sortField, sortOrder])

  const handleToggle = React.useCallback(async (integrationId: string, enabled: boolean) => {
    setTogglingIds((prev) => new Set(prev).add(integrationId))
    const call = await apiCall(`/api/integrations/${encodeURIComponent(integrationId)}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled: enabled }),
    }, { fallback: null })

    if (!call.ok) {
      flash(t('integrations.detail.stateError'), 'error')
    } else {
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          items: prev.items.map((item) =>
            item.id === integrationId ? { ...item, isEnabled: enabled } : item,
          ),
        }
      })
    }
    setTogglingIds((prev) => { const next = new Set(prev); next.delete(integrationId); return next })
  }, [t])

  const grouped = React.useMemo(() => {
    if (!data) return { bundles: [] as Array<BundleItem & { integrations: IntegrationItem[] }>, standalone: [] as IntegrationItem[] }

    const bundled = new Map<string, IntegrationItem[]>()
    const standalone: IntegrationItem[] = []
    for (const item of data.items) {
      if (item.bundleId) {
        const list = bundled.get(item.bundleId) ?? []
        list.push(item)
        bundled.set(item.bundleId, list)
      } else {
        standalone.push(item)
      }
    }

    const bundles = (data.bundles ?? [])
      .filter((b) => bundled.has(b.id))
      .map((b) => ({ ...b, integrations: bundled.get(b.id) ?? [] }))

    return { bundles, standalone }
  }, [data])

  const renderCategoryIcon = React.useCallback((category: string | undefined, className: string) => {
    if (!category) return null
    const Icon = CATEGORY_ICONS[category]
    if (!Icon) return null
    return <Icon className={className} />
  }, [])

  const renderHealthBadge = React.useCallback((status: IntegrationItem['healthStatus']) => {
    return (
      <span
        className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${HEALTH_BADGE_CLASS[status] ?? HEALTH_BADGE_CLASS.unconfigured}`}
      >
        {t(`integrations.marketplace.health.${status}`, status)}
      </span>
    )
  }, [t])

  if (isLoading && !data) {
    return (
      <Page>
        <PageBody>
          <div className="flex items-center justify-center py-16">
            <Spinner />
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody className="space-y-6">
        <section className="space-y-6 rounded-lg border bg-background p-6">
          <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-0.5">
              <h2 className="text-lg font-semibold">{t('integrations.marketplace.title')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('integrations.marketplace.description')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full min-w-[200px] max-w-xs lg:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder={t('integrations.marketplace.search')}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-8"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="sr-only">{t('integrations.marketplace.sort.label', 'Sort by')}</span>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as typeof sortField)}
                >
                  <option value="title">{t('integrations.marketplace.sort.title', 'Title')}</option>
                  <option value="category">{t('integrations.marketplace.sort.category', 'Category')}</option>
                  <option value="enabledAt">{t('integrations.marketplace.sort.enabledAt', 'Enabled date')}</option>
                  <option value="healthStatus">{t('integrations.marketplace.sort.health', 'Health')}</option>
                </select>
              </label>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
                aria-label={t('integrations.marketplace.sort.order', 'Sort order')}
              >
                <option value="asc">{t('integrations.marketplace.sort.asc', 'Ascending')}</option>
                <option value="desc">{t('integrations.marketplace.sort.desc', 'Descending')}</option>
              </select>
            </div>
          </header>

          <div className="lg:hidden">
            <FilterBar
              searchValue={searchInput}
              onSearchChange={setSearchInput}
              searchPlaceholder={t('integrations.marketplace.search')}
              searchAlign="left"
              filters={categoryFilters}
              values={filterValues}
              onApply={(values) => setFilterValues(normalizeIntegrationMarketplaceFilterValues(values))}
              onClear={() => setFilterValues({})}
            />
          </div>

          <div className="hidden lg:flex flex-wrap gap-1.5">
            {INTEGRATION_MARKETPLACE_CATEGORIES.map((category) => {
              const Icon = CATEGORY_ICONS[category]
              return (
                <Button
                  key={category}
                  type="button"
                  variant={selectedCategory === category ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFilterValues(normalizeIntegrationMarketplaceFilterValues({ category }))}
                >
                  {Icon ? <Icon className="mr-1.5 h-3.5 w-3.5" /> : null}
                  {t(`integrations.marketplace.categories.${category}`)}
                </Button>
              )
            })}
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : null}

          {data && data.totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>
                {data.total === 0
                  ? t('integrations.marketplace.pagination.empty', 'No results')
                  : t('integrations.marketplace.pagination.summary', {
                    from: (data.page - 1) * data.pageSize + 1,
                    to: Math.min(data.page * data.pageSize, data.total),
                    total: data.total,
                  })}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={data.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('integrations.marketplace.pagination.prev', 'Previous')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('integrations.marketplace.pagination.next', 'Next')}
                </Button>
              </div>
            </div>
          ) : null}

          {grouped.bundles.map((bundle) => (
            <Card key={bundle.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{bundle.title}</CardTitle>
                    {bundle.description && (
                      <p className="text-muted-foreground text-sm mt-1">{bundle.description}</p>
                    )}
                    <p className="text-muted-foreground text-xs mt-1">
                      {t('integrations.marketplace.integrations', { count: bundle.integrations.length })}
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/backend/integrations/bundle/${encodeURIComponent(bundle.id)}`}>
                      <Cog className="mr-1.5 h-4 w-4" />
                      {t('integrations.marketplace.configure')}
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {bundle.integrations.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-2 rounded-lg border p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {renderCategoryIcon(item.category, 'h-4 w-4 text-muted-foreground shrink-0')}
                            <Link
                              href={`/backend/integrations/${encodeURIComponent(item.id)}`}
                              className="truncate text-sm font-medium hover:underline"
                            >
                              {item.title}
                            </Link>
                            {renderHealthBadge(item.healthStatus)}
                          </div>
                          {(item.company || item.author || item.version) ? (
                            <p className="text-xs text-muted-foreground">
                              {[item.company || item.author, item.version ? `v${item.version}` : null].filter(Boolean).join(' · ')}
                            </p>
                          ) : null}
                        </div>
                        <Switch
                          checked={item.isEnabled}
                          disabled={togglingIds.has(item.id)}
                          onCheckedChange={(checked) => void handleToggle(item.id, checked)}
                          className="shrink-0"
                        />
                      </div>
                      <div className="flex items-end justify-between gap-2 border-t pt-2">
                        <div className="text-[10px] text-muted-foreground space-y-0.5">
                          <div>
                            {t('integrations.marketplace.analytics.events', { count: item.analytics.totalCount })}
                          </div>
                          <div>
                            {t('integrations.marketplace.analytics.errorRate', {
                              rate: `${Math.round(item.analytics.errorRate * 1000) / 10}%`,
                            })}
                          </div>
                        </div>
                        <LogSparkline counts={item.analytics.dailyCounts} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}

          {grouped.standalone.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {grouped.standalone.map((item) => (
                <Card key={item.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {renderCategoryIcon(item.category, 'h-4 w-4 text-muted-foreground shrink-0')}
                        <CardTitle className="text-base">{item.title}</CardTitle>
                        {renderHealthBadge(item.healthStatus)}
                      </div>
                      <Switch
                        checked={item.isEnabled}
                        disabled={togglingIds.has(item.id)}
                        onCheckedChange={(checked) => void handleToggle(item.id, checked)}
                        className="shrink-0"
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 space-y-2">
                    {item.description && (
                      <p className="text-muted-foreground text-sm">{item.description}</p>
                    )}
                    {(item.company || item.author || item.version) && (
                      <p className="text-muted-foreground text-xs">
                        {[item.company || item.author, item.version ? `v${item.version}` : null].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <div className="flex items-end justify-between gap-2 border-t pt-3">
                      <div className="text-[10px] text-muted-foreground space-y-0.5">
                        <div>
                          {t('integrations.marketplace.analytics.events', { count: item.analytics.totalCount })}
                        </div>
                        <div>
                          {t('integrations.marketplace.analytics.errorRate', {
                            rate: `${Math.round(item.analytics.errorRate * 1000) / 10}%`,
                          })}
                        </div>
                      </div>
                      <LogSparkline counts={item.analytics.dailyCounts} />
                    </div>
                  </CardContent>
                  <div className="px-6 pb-4">
                    <Button asChild variant="outline" size="sm" className="w-full">
                      <Link href={`/backend/integrations/${encodeURIComponent(item.id)}`}>
                        <Cog className="mr-1.5 h-4 w-4" />
                        {t('integrations.marketplace.configure')}
                      </Link>
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {grouped.bundles.length === 0 && grouped.standalone.length === 0 && !isLoading && (
            <div className="text-center py-12 text-muted-foreground">
              {t('integrations.marketplace.noResults')}
            </div>
          )}
        </section>
      </PageBody>
    </Page>
  )
}
