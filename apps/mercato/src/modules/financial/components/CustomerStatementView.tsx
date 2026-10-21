'use client'

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const STATEMENT_API = '/api/financial/receivables/statements'
const LIST_HREF = '/backend/financial/receivables'

type StatementLine = {
  id: string
  kind: 'invoice' | 'payment'
  reference: string | null
  occurredAt: string
  debit: string
  credit: string
}

type StatementResponse = {
  customerId: string
  from: string | null
  to: string | null
  openingBalance: string
  totalDebits: string
  totalCredits: string
  closingBalance: string
  lines: StatementLine[]
}

export default function CustomerStatementView({ customerId }: { customerId: string }) {
  const t = useT()
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [data, setData] = React.useState<StatementResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const params = new URLSearchParams({ customerId })
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const call = await apiCall<StatementResponse>(`${STATEMENT_API}?${params.toString()}`)
    if (!call.ok || !call.result) {
      setData(null)
      setError(t('financial.receivables.statement.error.load', 'Could not read the customer statement.'))
      setIsLoading(false)
      return
    }
    setData(call.result)
    setIsLoading(false)
  }, [customerId, from, to, t])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <PageHeader
        title={t('financial.receivables.statement.title', 'Customer statement')}
        description={customerId}
      />
      <PageBody>
        <Link className="text-sm text-muted-foreground underline" href={LIST_HREF}>
          {t('financial.receivables.statement.back', 'Back to receivables')}
        </Link>

        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="statement-from">{t('financial.receivables.statement.from', 'From')}</Label>
            <Input id="statement-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="statement-to">{t('financial.receivables.statement.to', 'To')}</Label>
            <Input id="statement-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={isLoading}>
            {t('financial.receivables.statement.apply', 'Apply')}
          </Button>
        </div>

        {isLoading ? (
          <LoadingMessage label={t('financial.receivables.statement.loading', 'Reading the statement…')} />
        ) : null}
        {!isLoading && error ? <ErrorMessage label={error} /> : null}

        {!isLoading && !error && data ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('financial.receivables.statement.linesTitle', 'Invoices and payments')}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('financial.receivables.statement.empty', 'No documents in this range.')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-start text-xs text-muted-foreground">
                        <th className="py-2 pe-3">{t('financial.receivables.statement.date', 'Date')}</th>
                        <th className="py-2 pe-3">{t('financial.receivables.statement.kind', 'Type')}</th>
                        <th className="py-2 pe-3">{t('financial.receivables.statement.reference', 'Reference')}</th>
                        <th className="py-2 pe-3 text-end">{t('financial.receivables.statement.debit', 'Debit')}</th>
                        <th className="py-2 text-end">{t('financial.receivables.statement.credit', 'Credit')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.lines.map((line) => (
                        <tr key={`${line.kind}-${line.id}`} className="border-b border-border/60">
                          <td className="py-2 pe-3">{line.occurredAt.slice(0, 10)}</td>
                          <td className="py-2 pe-3">
                            {line.kind === 'invoice'
                              ? t('financial.receivables.statement.invoice', 'Invoice')
                              : t('financial.receivables.statement.payment', 'Payment')}
                          </td>
                          <td className="py-2 pe-3 font-mono text-xs">{line.reference ?? '—'}</td>
                          <td className="py-2 pe-3 text-end">{line.debit}</td>
                          <td className="py-2 text-end">{line.credit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{t('financial.receivables.statement.totalDebits', 'Total debits')}</dt>
                  <dd className="font-semibold">{data.totalDebits}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('financial.receivables.statement.totalCredits', 'Total credits')}</dt>
                  <dd className="font-semibold">{data.totalCredits}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('financial.receivables.statement.closing', 'Closing balance')}</dt>
                  <dd className="font-semibold">{data.closingBalance}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        ) : null}
      </PageBody>
    </>
  )
}
