"use client"
import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, X } from 'lucide-react'
import { Button } from '../../primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { dismissPartialIndexWarning, usePartialIndexWarning } from './store'

export function PartialIndexBanner() {
  const t = useT()
  const warning = usePartialIndexWarning()

  if (!warning) return null

  const base = warning.baseCount
  const indexed = warning.indexedCount
  const hasCounts = typeof base === 'number' && typeof indexed === 'number'

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 font-medium text-amber-950">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <span>{t('query_index.banner.partial_title')}</span>
        </div>
        <p className="text-amber-900">
          {t('query_index.banner.partial_description')}
        </p>
        {hasCounts && (
          <p className="text-xs text-amber-900/90">
            {t('query_index.banner.partial_counts', { indexed, total: base })}
          </p>
        )}
        {warning.scope === 'global' && (
          <p className="text-xs text-amber-900/80">
            {t('query_index.banner.partial_global_note')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="border-amber-300 text-amber-900 hover:bg-amber-100"
        >
          <Link href="/backend/query-indexes">
            {t('query_index.banner.manage_indexes')}
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dismissPartialIndexWarning()}
          className="text-amber-900 hover:bg-amber-100"
          aria-label={t('query_index.banner.dismiss')}
        >
          <X className="mr-1 size-4" aria-hidden="true" />
          {t('query_index.banner.dismiss')}
        </Button>
      </div>
    </div>
  )
}
