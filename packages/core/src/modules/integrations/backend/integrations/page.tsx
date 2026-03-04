"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type IntegrationItem = {
  id: string
  title: string
  description?: string
  category?: string
  icon?: string
  bundleId?: string
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

const CATEGORIES = ['all', 'payment', 'shipping', 'data_sync', 'communication', 'notification', 'storage', 'webhook'] as const

function categoryBadgeVariant(category: string | undefined): 'default' | 'secondary' | 'outline' {
  if (!category) return 'outline'
  return 'secondary'
}

export default function IntegrationsMarketplacePage() {
  const [data, setData] = React.useState<ListResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [category, setCategory] = React.useState<string>('all')
  const [togglingIds, setTogglingIds] = React.useState<Set<string>>(new Set())
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()

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
    if (category !== 'all') {
      items = items.filter((item) => item.category === category)
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
  }, [data, search, category])

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
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t('integrations.marketplace.title')}</h1>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Input
            placeholder={t('integrations.marketplace.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((cat) => (
              <Button
                key={cat}
                type="button"
                variant={category === cat ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCategory(cat)}
              >
                {t(`integrations.marketplace.categories.${cat}`)}
              </Button>
            ))}
          </div>
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
                    <div className="min-w-0">
                      <Link
                        href={`/backend/integrations/${encodeURIComponent(item.id)}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {item.title}
                      </Link>
                      {item.category && (
                        <Badge variant={categoryBadgeVariant(item.category)} className="ml-2 text-xs">
                          {item.category}
                        </Badge>
                      )}
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
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <Switch
                      checked={item.isEnabled}
                      disabled={togglingIds.has(item.id)}
                      onCheckedChange={(checked) => void handleToggle(item.id, checked)}
                    />
                  </div>
                  {item.category && (
                    <Badge variant={categoryBadgeVariant(item.category)} className="w-fit text-xs">
                      {item.category}
                    </Badge>
                  )}
                </CardHeader>
                <CardContent className="flex-1">
                  {item.description && (
                    <p className="text-muted-foreground text-sm">{item.description}</p>
                  )}
                </CardContent>
                <div className="px-6 pb-4">
                  <Button asChild variant="outline" size="sm" className="w-full">
                    <Link href={`/backend/integrations/${encodeURIComponent(item.id)}`}>
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
      </PageBody>
    </Page>
  )
}
