'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StoreStatusBadge } from './StoreStatusBadge'
import { STORE_LIST_HREF, STORES_API_URL, formatPrimaryDomain, type StoreAdminRecord, type StoreListResponse } from './storeAdmin'
import {
  STORE_EDIT_TABS,
  STORE_TAB_QUERY_PARAM,
  buildStoreEditHref,
  isStoreEditTabId,
  resolveActiveStoreTab,
  type StoreEditTabDefinition,
} from './storeEditTabs'

type StoreEditPageProps = {
  storeId: string | null | undefined
  tabs?: readonly StoreEditTabDefinition[]
}

type StoreLoadResult = { store: StoreAdminRecord | null }

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  )
}

export function StoreEditPage({ storeId, tabs = STORE_EDIT_TABS }: StoreEditPageProps) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const queryKey = React.useMemo(() => ['ecommerce', 'stores', 'detail', storeId ?? ''], [storeId])

  const storeQuery = useQuery({
    queryKey,
    enabled: Boolean(storeId),
    queryFn: async (): Promise<StoreLoadResult> => {
      const params = new URLSearchParams({ id: storeId ?? '', page: '1', pageSize: '1' })
      const call = await apiCall<StoreListResponse>(`${STORES_API_URL}?${params.toString()}`, { cache: 'no-store' })
      if (!call.ok) {
        await raiseCrudError(call.response, t('ecommerce.backend.store.errors.load', 'Failed to load the store.'))
      }
      return { store: call.result?.items?.[0] ?? null }
    },
  })

  const reload = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const requestedTab = searchParams?.get(STORE_TAB_QUERY_PARAM)
  const activeTab = resolveActiveStoreTab(isStoreEditTabId(requestedTab) ? requestedTab : null, tabs)

  const handleTabChange = React.useCallback(
    (next: string) => {
      if (!isStoreEditTabId(next) || !storeId) return
      router.replace(pathname ? `${pathname}?${STORE_TAB_QUERY_PARAM}=${next}` : buildStoreEditHref(storeId, next))
    },
    [pathname, router, storeId],
  )

  const backLabel = t('ecommerce.backend.store.backToList', 'Back to stores')

  if (!storeId || (!storeQuery.isLoading && !storeQuery.isError && !storeQuery.data?.store)) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('ecommerce.backend.store.notFound.label', 'Store not found')}
            description={t(
              'ecommerce.backend.store.notFound.description',
              'This store does not exist in the selected organization, or it was deleted.',
            )}
            backHref={STORE_LIST_HREF}
            backLabel={backLabel}
          />
        </PageBody>
      </Page>
    )
  }

  if (storeQuery.isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('ecommerce.backend.store.loading', 'Loading store...')} />
        </PageBody>
      </Page>
    )
  }

  const store = storeQuery.data?.store
  if (storeQuery.isError || !store) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t('ecommerce.backend.store.errors.load', 'Failed to load the store.')}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => void storeQuery.refetch()}>
                {t('common.retry', 'Retry')}
              </Button>
            }
          />
        </PageBody>
      </Page>
    )
  }

  const summary = store._ecommerce
  const noValue = '—'

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <FormHeader
            mode="detail"
            backHref={STORE_LIST_HREF}
            backLabel={backLabel}
            entityTypeLabel={t('ecommerce.backend.store.entityType', 'Store')}
            title={store.name}
            subtitle={`${store.code} — /${store.slug}`}
            statusBadge={<StoreStatusBadge status={store.status} />}
          />
          <Card>
            <CardHeader>
              <CardTitle>{t('ecommerce.backend.store.summary.title', 'Store summary')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <SummaryItem label={t('ecommerce.backend.store.summary.code', 'Code')} value={store.code} />
                <SummaryItem label={t('ecommerce.backend.store.summary.slug', 'Slug')} value={store.slug} />
                <SummaryItem
                  label={t('ecommerce.backend.store.summary.defaultLocale', 'Default language')}
                  value={store.defaultLocale}
                />
                <SummaryItem
                  label={t('ecommerce.backend.store.summary.supportedLocales', 'Supported languages')}
                  value={store.supportedLocales.join(', ') || noValue}
                />
                <SummaryItem
                  label={t('ecommerce.backend.store.summary.currency', 'Currency')}
                  value={store.defaultCurrencyCode}
                />
                <SummaryItem
                  label={t('ecommerce.backend.store.summary.primaryDomain', 'Primary domain')}
                  value={formatPrimaryDomain(summary) ?? noValue}
                />
                <SummaryItem
                  label={t('ecommerce.backend.store.summary.defaultChannel', 'Default channel')}
                  value={summary?.defaultChannel?.name ?? noValue}
                />
              </dl>
            </CardContent>
          </Card>
          {activeTab ? (
            <Tabs value={activeTab} onValueChange={handleTabChange} variant="underline">
              <TabsList aria-label={t('ecommerce.backend.store.tabs.ariaLabel', 'Store sections')}>
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id}>
                    {t(tab.labelKey, tab.fallbackLabel)}
                  </TabsTrigger>
                ))}
              </TabsList>
              {tabs.map((tab) => (
                <TabsContent key={tab.id} value={tab.id}>
                  {tab.render({ store, reload })}
                </TabsContent>
              ))}
            </Tabs>
          ) : null}
        </div>
      </PageBody>
    </Page>
  )
}
