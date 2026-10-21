'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const AGING_API = '/api/financial/ap/aging'
type Bucket = 'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'days90plus'
const BUCKETS: Bucket[] = ['current', 'days1to30', 'days31to60', 'days61to90', 'days90plus']

type AgingResponse = {
  asOf: string
  buckets: Record<Bucket, { count: number; amount: string }>
  totalOutstanding: string
  ledgerBalance: string
  reconciliationDelta: string
  invoices: Array<{
    id: string
    internalNumber: string
    vendorName: string | null
    dueDate: string | null
    outstandingAmount: string
    bucket: Bucket
  }>
}

export default function PayablesAging() {
  const t = useT()
  const [asOf, setAsOf] = React.useState(new Date().toISOString().slice(0, 10))
  const [data, setData] = React.useState<AgingResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const call = await apiCall<AgingResponse>(`${AGING_API}?asOf=${encodeURIComponent(asOf)}`)
    if (!call.ok || !call.result) {
      setData(null)
      setError(t('financial.ap.aging.error.load', 'Could not read the payables aging.'))
      setIsLoading(false)
      return
    }
    setData(call.result)
    setIsLoading(false)
  }, [asOf, t])

  React.useEffect(() => { void load() }, [load])
  const deltaIsZero = data ? Number(data.reconciliationDelta) === 0 : true

  return (
    <>
      <PageHeader
        title={t('financial.ap.aging.pageTitle', 'Payables')}
        description={t('financial.ap.aging.pageDescription', 'Open vendor invoices by days past due, reconciled against the posted payable account.')}
      />
      <PageBody>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ap-as-of">{t('financial.ap.aging.asOf', 'As of')}</Label>
            <Input id="ap-as-of" type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          </div>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={isLoading}>
            {t('financial.ap.aging.refresh', 'Refresh')}
          </Button>
        </div>
        {isLoading ? <LoadingMessage label={t('financial.ap.aging.loading', 'Reading payables…')} /> : null}
        {!isLoading && error ? <ErrorMessage label={error} /> : null}
        {!isLoading && !error && data ? (
          <>
            {!deltaIsZero ? (
              <Alert variant="warning">
                <AlertTitle>{t('financial.ap.aging.warning.title', 'Payables do not reconcile')}</AlertTitle>
                <AlertDescription>
                  {t('financial.ap.aging.warning.body', 'The open vendor invoices and the posted payable balance differ. A journal entry or a payment may have bypassed the AP flow.')}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {BUCKETS.map((bucket) => (
                <Card key={bucket}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">{t(`financial.ap.aging.buckets.${bucket}`, bucket)}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-semibold">{data.buckets[bucket].amount}</p>
                    <p className="text-xs text-muted-foreground">{t('financial.ap.aging.count', '{count} invoices', { count: data.buckets[bucket].count })}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Summary label={t('financial.ap.aging.totalOutstanding', 'Open invoices')} value={data.totalOutstanding} />
              <Summary label={t('financial.ap.aging.ledgerBalance', 'Ledger payable balance')} value={data.ledgerBalance} />
              <Summary label={t('financial.ap.aging.delta', 'Difference')} value={data.reconciliationDelta} />
            </div>
            <Card>
              <CardHeader><CardTitle>{t('financial.ap.aging.invoices', 'Open vendor invoices')}</CardTitle></CardHeader>
              <CardContent>
                {data.invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('financial.ap.aging.empty', 'No open vendor invoices.')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-start text-xs text-muted-foreground">
                          <th className="py-2 pe-3">{t('financial.ap.aging.columns.invoice', 'Invoice')}</th>
                          <th className="py-2 pe-3">{t('financial.ap.aging.columns.vendor', 'Vendor')}</th>
                          <th className="py-2 pe-3">{t('financial.ap.aging.columns.due', 'Due')}</th>
                          <th className="py-2 pe-3 text-end">{t('financial.ap.aging.columns.outstanding', 'Outstanding')}</th>
                          <th className="py-2 text-end">{t('financial.ap.aging.columns.bucket', 'Bucket')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.invoices.map((invoice) => (
                          <tr key={invoice.id} className="border-b border-border/60">
                            <td className="py-2 pe-3">
                              <Link className="font-mono text-xs underline" href={`/backend/financial/payables/invoices/${invoice.id}`}>
                                {invoice.internalNumber}
                              </Link>
                            </td>
                            <td className="py-2 pe-3">{invoice.vendorName ?? '—'}</td>
                            <td className="py-2 pe-3">{invoice.dueDate ?? '—'}</td>
                            <td className="py-2 pe-3 text-end">{invoice.outstandingAmount}</td>
                            <td className="py-2 text-end">{t(`financial.ap.aging.buckets.${invoice.bucket}`, invoice.bucket)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </PageBody>
    </>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}
