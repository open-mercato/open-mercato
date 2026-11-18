"use client"

import * as React from 'react'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

type CatalogKind = 'categories' | 'products'

function catalogMessage(t: TranslateFn, kind: CatalogKind, forbidden: boolean): string {
  if (kind === 'categories') {
    return forbidden
      ? t('property_management.units.form.categoriesForbidden', 'You do not have permission to view the catalog categories.')
      : t('property_management.units.form.categoriesLoadError', 'Could not load the catalog categories.')
  }
  return forbidden
    ? t('property_management.units.form.productsForbidden', 'You do not have permission to view the catalog products.')
    : t('property_management.units.form.productsLoadError', 'Could not load the catalog products.')
}

export function CatalogLoadError({ status, kind, onRetry }: { status: number | null; kind: CatalogKind; onRetry: () => void }) {
  const t = useT()
  if (status === null) return null
  return (
    <span className="flex flex-wrap items-center gap-2" role="alert" data-testid={`pm-unit-${kind}-error`}>
      <span className="text-sm text-status-error-text">{catalogMessage(t, kind, status === 403)}</span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} data-testid={`pm-unit-${kind}-retry`}>
        {t('property_management.common.retry', 'Try again')}
      </Button>
    </span>
  )
}
