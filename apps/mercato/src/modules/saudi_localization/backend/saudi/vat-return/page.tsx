'use client'

/**
 * The ZATCA VAT return, read off the posted ledger for one filing period.
 *
 * The screen is deliberately a **read view with a period picker** and nothing
 * else: a return posts nothing, so the only decision an operator makes here is
 * which period to look at. Two pieces of copy carry the weight —
 *
 * - the reconciliation line, because a period whose VAT was posted without its
 *   taxable base produces figures that look perfectly tidy, and the whole point of
 *   showing the delta is that "tidy" and "correct" are not the same claim;
 * - the seller identity the figures were read against, because a return filed
 *   under the wrong VAT number is filed in the wrong name.
 *
 * This is a read of the ledger, not a filing. Filing is a manual action on the
 * ZATCA portal, and the screen says so rather than implying otherwise.
 */

import * as React from 'react'
import { Download } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const RETURN_API = '/api/saudi_localization/vat-return'

type FilingFrequency = 'monthly' | 'quarterly'

type VatReturnResponse = {
  currencyCode: string
  period: {
    fiscalYear: number
    frequency: FilingFrequency
    periodNumber: number
    label: string
    startDate: string
    endDate: string
  }
  standardRated: { net: string; tax: string }
  zeroRated: { net: string }
  exempt: { net: string }
  outOfScope: { net: string }
  outputVat: string
  inputVat: string
  netPayable: string
  lineCount: number
  reconciliationDelta: string
  generatedAt: string
  settings: {
    sellerName: string
    vatRegistrationNumber: string
    filingFrequency: FilingFrequency
    isComplete: boolean
  }
}

const PERIODS_PER_FREQUENCY: Record<FilingFrequency, number> = { monthly: 12, quarterly: 4 }

function currentYear(): number {
  return new Date().getFullYear()
}

function isZeroAmount(value: string): boolean {
  return Number(value) === 0
}

export default function SaudiVatReturnPage() {
  const t = useT()
  const [fiscalYear, setFiscalYear] = React.useState(String(currentYear()))
  const [frequency, setFrequency] = React.useState<FilingFrequency>('quarterly')
  const [periodNumber, setPeriodNumber] = React.useState('1')
  const [data, setData] = React.useState<VatReturnResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const params = new URLSearchParams({ fiscalYear, frequency, periodNumber })
    const call = await apiCall<VatReturnResponse>(`${RETURN_API}?${params.toString()}`)
    if (!call.ok || !call.result) {
      setData(null)
      setError(t('saudi_localization.vat_return.errors.load_failed', 'Unable to build the VAT return.'))
      setIsLoading(false)
      return
    }
    setData(call.result)
    setIsLoading(false)
  }, [fiscalYear, frequency, periodNumber, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const periodOptions = React.useMemo(
    () => Array.from({ length: PERIODS_PER_FREQUENCY[frequency] }, (_, index) => index + 1),
    [frequency],
  )

  const handleFrequencyChange = (value: string) => {
    const next = value as FilingFrequency
    setFrequency(next)
    // A quarter number is meaningless at a monthly frequency and vice versa, so
    // the selection resets rather than asking the API for period 4 of 12.
    setPeriodNumber('1')
  }

  const rows = data
    ? [
        {
          key: 'standardRated',
          label: t('saudi_localization.vat_return.rows.standard_rated', 'Standard-rated sales (15%)'),
          net: data.standardRated.net,
          tax: data.standardRated.tax,
          category: 'S',
        },
        {
          key: 'zeroRated',
          label: t('saudi_localization.vat_return.rows.zero_rated', 'Zero-rated sales (0%)'),
          net: data.zeroRated.net,
          tax: null,
          category: 'Z',
        },
        {
          key: 'exempt',
          label: t('saudi_localization.vat_return.rows.exempt', 'Exempt sales'),
          net: data.exempt.net,
          tax: null,
          category: 'E',
        },
        {
          key: 'outOfScope',
          label: t('saudi_localization.vat_return.rows.out_of_scope', 'Out of scope'),
          net: data.outOfScope.net,
          tax: null,
          category: 'O',
        },
      ]
    : []

  const deltaIsNonZero = data ? !isZeroAmount(data.reconciliationDelta) : false

  return (
    <Page>
      <PageHeader
        title={t('saudi_localization.vat_return.page_title', 'VAT return')}
        description={t(
          'saudi_localization.vat_return.page_description',
          'The ZATCA return for one filing period, read from the posted ledger. This screen files nothing.',
        )}
      />
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>{t('saudi_localization.vat_return.period.title', 'Filing period')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="vat-return-year">
                {t('saudi_localization.vat_return.period.year', 'Year')}
              </Label>
              <Select value={fiscalYear} onValueChange={setFiscalYear}>
                <SelectTrigger id="vat-return-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[currentYear() - 2, currentYear() - 1, currentYear(), currentYear() + 1].map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="vat-return-frequency">
                {t('saudi_localization.vat_return.period.frequency', 'Filing frequency')}
              </Label>
              <Select value={frequency} onValueChange={handleFrequencyChange}>
                <SelectTrigger id="vat-return-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">
                    {t('saudi_localization.vat_settings.filing_frequency.monthly', 'Monthly')}
                  </SelectItem>
                  <SelectItem value="quarterly">
                    {t('saudi_localization.vat_settings.filing_frequency.quarterly', 'Quarterly')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="vat-return-period">
                {t('saudi_localization.vat_return.period.number', 'Period')}
              </Label>
              <Select value={periodNumber} onValueChange={setPeriodNumber}>
                <SelectTrigger id="vat-return-period">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {periodOptions.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <LoadingMessage label={t('saudi_localization.vat_return.loading', 'Building the return...')} />
        ) : null}

        {!isLoading && error ? (
          <ErrorMessage
            label={error}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                {t('saudi_localization.vat_settings.actions.retry', 'Retry')}
              </Button>
            }
          />
        ) : null}

        {!isLoading && !error && data ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {t('saudi_localization.vat_return.period.range', 'Return period')}:{' '}
                <span className="font-medium text-foreground">{data.period.label}</span> ({data.period.startDate} —{' '}
                {data.period.endDate})
              </p>
              <p className="text-sm text-muted-foreground">
                {t('saudi_localization.vat_return.seller', 'Seller')}:{' '}
                <span className="font-medium text-foreground">
                  {data.settings.sellerName || t('saudi_localization.vat_return.seller_missing', 'not configured')}
                </span>{' '}
                · {data.settings.vatRegistrationNumber || '—'}
              </p>
            </div>

            {!data.settings.isComplete ? (
              <Alert variant="warning">
                <AlertTitle>
                  {t('saudi_localization.vat_return.settings_incomplete.title', 'VAT settings are incomplete')}
                </AlertTitle>
                <AlertDescription>
                  {t(
                    'saudi_localization.vat_return.settings_incomplete.body',
                    'The seller name and VAT registration number identify who this return belongs to. Save them before filing.',
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            {deltaIsNonZero ? (
              <Alert variant="warning">
                <AlertTitle>
                  {t('saudi_localization.vat_return.delta.title', 'The return does not reconcile to the ledger')}
                </AlertTitle>
                <AlertDescription>
                  {t(
                    'saudi_localization.vat_return.delta.body',
                    'Posted output VAT differs from the tax the standard-rated base implies. That usually means a posting is missing its VAT counterpart — check the entries for this period before filing.',
                  )}{' '}
                  <span className="font-medium">{data.reconciliationDelta}</span> {data.currencyCode}
                </AlertDescription>
              </Alert>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>{t('saudi_localization.vat_return.sales.title', 'Sales by ZATCA category')}</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-start text-muted-foreground">
                      <th className="pb-2 text-start font-medium">
                        {t('saudi_localization.vat_return.columns.category', 'Category')}
                      </th>
                      <th className="pb-2 text-start font-medium">
                        {t('saudi_localization.vat_return.columns.code', 'Code')}
                      </th>
                      <th className="pb-2 text-end font-medium">
                        {t('saudi_localization.vat_return.columns.net', 'Taxable base')}
                      </th>
                      <th className="pb-2 text-end font-medium">
                        {t('saudi_localization.vat_return.columns.tax', 'VAT')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key} className="border-t border-border">
                        <td className="py-2">{row.label}</td>
                        <td className="py-2 text-muted-foreground">{row.category}</td>
                        <td className="py-2 text-end tabular-nums">{row.net}</td>
                        <td className="py-2 text-end tabular-nums">{row.tax ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('saudi_localization.vat_return.totals.title', 'VAT due')}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t('saudi_localization.vat_return.totals.output', 'Output VAT (sales)')}
                  </span>
                  <span className="tabular-nums">{data.outputVat}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t('saudi_localization.vat_return.totals.input', 'Input VAT (purchases)')}
                  </span>
                  <span className="tabular-nums">{data.inputVat}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-2 font-medium">
                  <span>{t('saudi_localization.vat_return.totals.net', 'Net payable')}</span>
                  <span className="tabular-nums">
                    {data.netPayable} {data.currencyCode}
                  </span>
                </div>
                <p className="pt-2 text-xs text-muted-foreground">
                  {t(
                    'saudi_localization.vat_return.totals.lines',
                    '{{count}} posted tax lines in this period. Generated {{generatedAt}}.',
                    { count: String(data.lineCount), generatedAt: data.generatedAt },
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'saudi_localization.vat_return.totals.filing_note',
                    'Filing is a manual action on the ZATCA portal. This screen only reads the ledger.',
                  )}
                </p>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const payload = JSON.stringify(data, null, 2)
                  const blob = new Blob([payload], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = url
                  link.download = `saudi-vat-return-${data.period.label}.json`
                  link.click()
                  URL.revokeObjectURL(url)
                }}
              >
                <Download className="size-4 me-2" />
                {t('saudi_localization.vat_return.actions.export', 'Download JSON')}
              </Button>
            </div>
          </>
        ) : null}
      </PageBody>
    </Page>
  )
}
