"use client"
import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '../../primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { buildHrefWithReturnTo } from '@open-mercato/shared/lib/navigation/returnTo'
import { dismissPartialIndexWarning, usePartialIndexWarning } from './store'

export function PartialIndexBanner() {
  const t = useT()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const warning = usePartialIndexWarning()

  const returnTo = React.useMemo(() => {
    const query = searchParams?.toString() ?? ''
    if (!pathname) return null
    return query.length ? `${pathname}?${query}` : pathname
  }, [pathname, searchParams])
  const manageIndexesHref = React.useMemo(
    () => buildHrefWithReturnTo('/backend/query-indexes', returnTo),
    [returnTo],
  )

  if (!warning) return null

  const entityLabel = warning.entityLabel || warning.entity
  const base = warning.baseCount
  const indexed = warning.indexedCount
  const hasCounts = typeof base === 'number' && typeof indexed === 'number'
  const hasExcessIndexedRows = hasCounts && indexed > base

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 dark:border-amber-600/60 dark:bg-amber-950/40 dark:text-amber-100 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 font-medium text-amber-950 dark:text-amber-50">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <span>{t('query_index.banner.partial_title')}</span>
        </div>
        <p className="text-amber-900 dark:text-amber-100">
          {t('query_index.banner.partial_description')}
        </p>
        <p className="text-xs text-amber-900/90 dark:text-amber-100/90">
          {t('query_index.banner.partial_entity', { entity: entityLabel })}
        </p>
        {hasCounts && (
          <p className="text-xs text-amber-900/90 dark:text-amber-100/90">
            {hasExcessIndexedRows
              ? t('query_index.banner.partial_counts_excess', { indexed, total: base })
              : t('query_index.banner.partial_counts', { indexed, total: base })}
          </p>
        )}
        {warning.scope === 'global' && (
          <p className="text-xs text-amber-900/80 dark:text-amber-100/75">
            {t('query_index.banner.partial_global_note')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-500/60 dark:text-amber-100 dark:hover:bg-amber-900/60"
        >
          <Link href={manageIndexesHref}>
            {t('query_index.banner.manage_indexes')}
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => dismissPartialIndexWarning()}
          className="text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/60"
          aria-label={t('query_index.banner.dismiss')}
        >
          <X className="mr-1 size-4" aria-hidden="true" />
          {t('query_index.banner.dismiss')}
        </Button>
      </div>
    </div>
  )
}
