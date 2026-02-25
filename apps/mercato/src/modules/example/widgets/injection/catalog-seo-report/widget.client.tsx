"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ProductSummary = {
  id: string
  title?: string | null
  description?: string | null
  handle?: string | null
}

type ProductSeoIssue = {
  id: string
  title: string
  issue: string
}

async function fetchProductsNeedingSeo(): Promise<ProductSeoIssue[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: '25',
    sortField: 'updated_at',
    sortDir: 'desc',
  })
  const call = await apiCall<{ items?: ProductSummary[] }>(`/api/catalog/products?${params.toString()}`, undefined, {
    fallback: { items: [] },
  })
  const items = Array.isArray(call.result?.items) ? call.result!.items! : []
  const issues: ProductSeoIssue[] = []
  for (const item of items) {
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const description = typeof item.description === 'string' ? item.description.trim() : ''
    if (!title) continue
    if (title.length < 10) {
      issues.push({ id: String(item.id), title, issue: 'Title is too short (< 10 chars)' })
      continue
    }
    if (title.length > 60) {
      issues.push({ id: String(item.id), title, issue: 'Title is too long (> 60 chars)' })
      continue
    }
    if (!description || description.length < 50) {
      issues.push({ id: String(item.id), title, issue: 'Description missing or too short (< 50 chars)' })
    }
  }
  return issues.slice(0, 5)
}

export default function CatalogSeoReportWidget({ }: InjectionWidgetComponentProps) {
  const t = useT()
  const [issues, setIssues] = React.useState<ProductSeoIssue[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchProductsNeedingSeo()
      setIssues(data)
    } catch (err) {
      console.error('example.catalogSeoReport.load', err)
      setError(t('example.widgets.catalogSeoReport.error', 'Unable to load SEO hints.'))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">
            {t('example.widgets.catalogSeoReport.title', 'SEO to-dos')}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('example.widgets.catalogSeoReport.subtitle', 'Quick report of products that need SEO attention.')}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
          {loading ? t('common.loading', 'Loading…') : t('common.refresh', 'Refresh')}
        </Button>
      </div>

      {error ? (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      ) : loading ? (
        <p className="mt-2 text-xs text-muted-foreground">{t('common.loading', 'Loading…')}</p>
      ) : issues.length === 0 ? (
        <p className="mt-2 text-xs text-emerald-700">{t('example.widgets.catalogSeoReport.healthy', 'All reviewed items look good!')}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {issues.map((issue) => (
            <li key={issue.id} className="rounded border border-amber-200 dark:border-amber-900/70 bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground dark:text-amber-50">{issue.title}</div>
                  <div className="text-[11px] text-amber-800 dark:text-amber-300">{issue.issue}</div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <a href={`/backend/catalog/products/${issue.id}`} className="text-xs">
                    {t('example.widgets.catalogSeoReport.edit', 'Fix')}
                  </a>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Alert className="mt-3">
        <AlertTitle>{t('example.widgets.catalogSeoReport.example', 'Example injection widget')}</AlertTitle>
        <AlertDescription className="text-xs">
          {t(
            'example.widgets.catalogSeoReport.docs',
            'This widget is injected into the products table via the injection system.',
          )}{' '}
          <a className="text-primary underline" href="/docs/framework/admin-ui/widget-injection" target="_blank" rel="noreferrer">
            {t('example.widgets.catalogSeoReport.learnMore', 'Learn more')}
          </a>
        </AlertDescription>
      </Alert>
    </div>
  )
}
