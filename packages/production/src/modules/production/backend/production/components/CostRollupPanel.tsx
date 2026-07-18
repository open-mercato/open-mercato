'use client'

import * as React from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { useT } from '@open-mercato/shared/lib/i18n/context'

type CostRollupLine = {
  componentKey: string
  qty: number
  bomUom: string
  priceUom: string | null
  unitAmount: number | null
  currency: string | null
  lineCost: number | null
  status: 'ok' | 'missing_price' | 'missing_conversion' | 'mixed_currency'
}

type CostRollupResponse = {
  bomId: string
  quantity: number
  materials: number
  labor: number
  total: number
  perUnit: number
  currency: string | null
  priceBasis: 'catalog_list_price'
  missingPrices: string[]
  missingConversions: string[]
  mixedCurrency: string[]
  missingRouting: boolean
  lines: CostRollupLine[]
}

/**
 * Compact standard-cost rollup panel for the BOM edit page (spec § API
 * Contracts, task 1.4). Calls `GET /api/production/boms/[id]/cost-rollup`
 * on demand (not on page load — the rollup reads catalog prices/routings on
 * every call, so it is opt-in rather than an implicit page cost) and renders
 * the breakdown plus any missing-data gaps explicitly, honoring the
 * quantities-first honesty principle instead of hiding them behind a silent
 * zero.
 */
export function CostRollupPanel({ bomId, t }: { bomId: string; t: ReturnType<typeof useT> }) {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<CostRollupResponse | null>(null)

  const runRollup = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const call = await apiCall<CostRollupResponse>(`/api/production/boms/${bomId}/cost-rollup`)
      if (call.ok && call.result) {
        setResult(call.result)
      } else {
        setError(t('production.boms.cost_rollup.error', 'Failed to compute cost rollup'))
      }
    } catch {
      setError(t('production.boms.cost_rollup.error', 'Failed to compute cost rollup'))
    } finally {
      setLoading(false)
    }
  }, [bomId, t])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('production.boms.cost_rollup.title', 'Cost estimate (catalog list prices)')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="text-xs text-muted-foreground">
          {t(
            'production.boms.cost_rollup.caption',
            'Labor uses work-center rates; materials use catalog list prices, not purchase cost.',
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={runRollup} disabled={loading}>
          {loading
            ? t('production.boms.cost_rollup.loading', 'Calculating...')
            : t('production.boms.cost_rollup.action', 'Calculate cost estimate')}
        </Button>

        {error && <Alert status="error">{error}</Alert>}

        {result && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">{t('production.boms.cost_rollup.materials', 'Materials')}</div>
                <div className="font-semibold">{result.materials.toFixed(2)} {result.currency ?? ''}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('production.boms.cost_rollup.labor', 'Labor')}</div>
                <div className="font-semibold">{result.labor.toFixed(2)} {result.currency ?? ''}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('production.boms.cost_rollup.total', 'Total')}</div>
                <div className="font-semibold">{result.total.toFixed(2)} {result.currency ?? ''}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('production.boms.cost_rollup.per_unit', 'Per unit')}</div>
                <div className="font-semibold">{result.perUnit.toFixed(2)} {result.currency ?? ''}</div>
              </div>
            </div>

            {result.missingRouting && (
              <Alert status="warning">
                {t('production.boms.cost_rollup.missing_routing', 'No matching routing version was found; labor cost is 0.')}
              </Alert>
            )}
            {result.missingPrices.length > 0 && (
              <Alert status="warning">
                {t('production.boms.cost_rollup.missing_prices', 'Missing catalog prices for: {items}', {
                  items: result.missingPrices.join(', '),
                })}
              </Alert>
            )}
            {result.missingConversions.length > 0 && (
              <Alert status="warning">
                {t('production.boms.cost_rollup.missing_conversions', 'Missing UoM conversions for: {items}', {
                  items: result.missingConversions.join(', '),
                })}
              </Alert>
            )}
            {result.mixedCurrency.length > 0 && (
              <Alert status="warning">
                {t('production.boms.cost_rollup.mixed_currency', 'Mixed-currency prices excluded from the total for: {items}', {
                  items: result.mixedCurrency.join(', '),
                })}
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
