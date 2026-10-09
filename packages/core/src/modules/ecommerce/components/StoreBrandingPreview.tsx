'use client'

import * as React from 'react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { buildBrandingPreviewDocument } from './storeBrandingForm'

export const BRANDING_PREVIEW_DEBOUNCE_MS = 250

const SAMPLE_PRODUCT_PRICE = 29

export function formatPreviewPrice(amount: number, currencyCode: string, locale: string): string {
  const code = currencyCode.trim().toUpperCase()
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount)
  } catch {
    const formatted = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
    return code ? `${formatted} ${code}` : formatted
  }
}

type StoreBrandingPreviewProps = {
  values: Record<string, unknown>
  storeName: string
  currencyCode: string
}

function useDebouncedValue<TValue>(value: TValue, delayMs: number): TValue {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(handle)
  }, [value, delayMs])
  return debounced
}

export function StoreBrandingPreview({ values, storeName, currencyCode }: StoreBrandingPreviewProps) {
  const t = useT()
  const locale = useLocale()
  const debouncedValues = useDebouncedValue(values, BRANDING_PREVIEW_DEBOUNCE_MS)
  const document = React.useMemo(
    () =>
      buildBrandingPreviewDocument(debouncedValues, {
        storeName,
        navShop: t('ecommerce.backend.store.branding.preview.navShop', 'Shop'),
        navCategories: t('ecommerce.backend.store.branding.preview.navCategories', 'Categories'),
        navCart: t('ecommerce.backend.store.branding.preview.navCart', 'Cart'),
        heroTitle: t('ecommerce.backend.store.branding.preview.heroTitle', 'New arrivals'),
        heroText: t(
          'ecommerce.backend.store.branding.preview.heroText',
          'A preview of your storefront with the colours, corners and fonts you chose.',
        ),
        heroButton: t('ecommerce.backend.store.branding.preview.heroButton', 'Shop now'),
        productName: t('ecommerce.backend.store.branding.preview.productName', 'Sample product'),
        productPrice: formatPreviewPrice(SAMPLE_PRODUCT_PRICE, currencyCode, locale),
      }),
    [currencyCode, debouncedValues, locale, storeName, t],
  )

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t(
          'ecommerce.backend.store.branding.preview.hint',
          'The preview updates as you edit and is never saved until you save the branding.',
        )}
      </p>
      <iframe
        title={t('ecommerce.backend.store.branding.preview.title', 'Storefront preview')}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={document}
        data-testid="branding-preview-frame"
        className="h-96 w-full rounded-md border border-border bg-background"
      />
    </div>
  )
}
