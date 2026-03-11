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
  INTEGRATION_MARKETPLACE_CATEGORIES,
  normalizeIntegrationMarketplaceFilterValues,
} from './filters'

type IntegrationItem = {
  id: string
  title: string
  description?: string
  category?: string
  icon?: string
  bundleId?: string
  author?: string
  company?: string
  version?: string
  isEnabled: boolean
  hasCredentials: boolean
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

export default function IntegrationsMarketplacePage() {
  const [data, setData] = React.useState<ListResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [togglingIds, setTogglingIds] = React.useState<Set<string>>(new Set())
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()

  const categoryFilters = React.useMemo(() => buildIntegrationMarketplaceFilterDefs(t), [t])
  const selectedCategory = React.useMemo(() => getIntegrationMarketplaceCategory(filterValues), [filterValues])

  const load = React.useCallback(async () => {
    setIsLoading(true)
    const fallback: ListResponse = { items: [], bundles: [] }
    const call = await apiCall<ListResponse>('/api/integrations', undefined, { fallback })
    if (!call.ok) {
      flash(t('integrations.marketplace.loadError'), 'error')
      setIsLoading(false)
      return
    }
    setData(call.result ?? fallback)
    setIsLoading(false)
  }, [t])

  React.useEffect(() => { void load() }, [load, scopeVersion])

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

  const filteredItems = React.useMemo(() => {
    if (!data) return { bundles: [], standalone: [] }

    let items = data.items
    if (search) {
      const q = search.toLowerCase()
      items = items.filter((item) => item.title.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q))
    }
    if (selectedCategory !== 'all') {
      items = items.filter((item) => item.category === selectedCategory)
    }

    const bundled = new Map<string, IntegrationItem[]>()
    const standalone: IntegrationItem[] = []
    for (const item of items) {
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
  }, [data, search, selectedCategory])

  const renderCategoryIcon = React.useCallback((category: string | undefined, className: string) => {
    if (!category) return null
    const Icon = CATEGORY_ICONS[category]
    if (!Icon) return null
    return <Icon className={className} />
  }, [])

  if (isLoading) {
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
          <header className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <h2 className="text-lg font-semibold">{t('integrations.marketplace.title')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('integrations.marketplace.description')}
              </p>
            </div>
            <div className="relative w-64 shrink-0 hidden lg:block">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={t('integrations.marketplace.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </header>

          <div className="lg:hidden">
            <FilterBar
              searchValue={search}
              onSearchChange={setSearch}
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

          {filteredItems.bundles.map((bundle) => (
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
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          {renderCategoryIcon(item.category, 'h-4 w-4 text-muted-foreground')}
                          <Link
                            href={`/backend/integrations/${encodeURIComponent(item.id)}`}
                            className="truncate text-sm font-medium hover:underline"
                          >
                            {item.title}
                          </Link>
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
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}

          {filteredItems.standalone.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.standalone.map((item) => (
                <Card key={item.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {renderCategoryIcon(item.category, 'h-4 w-4 text-muted-foreground')}
                        <CardTitle className="text-base">{item.title}</CardTitle>
                      </div>
                      <Switch
                        checked={item.isEnabled}
                        disabled={togglingIds.has(item.id)}
                        onCheckedChange={(checked) => void handleToggle(item.id, checked)}
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

          {filteredItems.bundles.length === 0 && filteredItems.standalone.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              {t('integrations.marketplace.noResults')}
            </div>
          )}
        </section>
      </PageBody>
    </Page>
  )
}
