'use client'

/**
 * The income statement for a range.
 *
 * A read of the posted ledger and nothing more. The one thing the screen adds over
 * the raw figures is that a **loss reads as a loss**: `netIncome` is signed, so a
 * negative figure is labelled rather than left for the operator to interpret from
 * the direction of two totals.
 */

import * as React from 'react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import StatementSectionTable, {
  type StatementSectionData,
} from '../../../../components/StatementSectionTable'

const STATEMENT_API = '/api/financial/statements/income-statement'

type IncomeStatementResponse = {
  from: string
  to: string
  currencyCode: string | null
  revenue: StatementSectionData
  expenses: StatementSectionData
  totalRevenue: string
  totalExpenses: string
  netIncome: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function startOfYear(): string {
  return `${new Date().getUTCFullYear()}-01-01`
}

function isNegative(value: string): boolean {
  return value.trim().startsWith('-')
}

export default function IncomeStatementPage() {
  const t = useT()
  const [from, setFrom] = React.useState(startOfYear())
  const [to, setTo] = React.useState(today())
  const [data, setData] = React.useState<IncomeStatementResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const params = new URLSearchParams({ from, to })
    const call = await apiCall<IncomeStatementResponse>(`${STATEMENT_API}?${params.toString()}`)
    if (!call.ok || !call.result) {
      setData(null)
      setError(t('financial.statements.error.load', 'Unable to build the statement.'))
      setIsLoading(false)
      return
    }
    setData(call.result)
    setIsLoading(false)
  }, [from, to, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const currency = data?.currencyCode ?? null
  const loss = data ? isNegative(data.netIncome) : false

  return (
    <Page>
      <PageHeader
        title={t('financial.statements.incomeStatement.title', 'Income statement')}
        description={t(
          'financial.statements.incomeStatement.description',
          'Revenue and expenses for a range, read from the posted ledger.',
        )}
      />
      <PageBody>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="income-statement-from">{t('financial.statements.fields.from', 'From')}</Label>
            <Input
              id="income-statement-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="income-statement-to">{t('financial.statements.fields.to', 'To')}</Label>
            <Input id="income-statement-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <Button type="button" variant="outline" onClick={() => void load()} disabled={isLoading}>
            {t('financial.statements.actions.refresh', 'Refresh')}
          </Button>
        </div>

        {isLoading ? (
          <LoadingMessage label={t('financial.statements.loading', 'Reading the ledger...')} />
        ) : null}

        {!isLoading && error ? <ErrorMessage label={error} /> : null}

        {!isLoading && !error && data ? (
          <>
            {!currency ? (
              <Alert variant="info">
                <AlertTitle>{t('financial.statements.noPostings.title', 'Nothing has been posted')}</AlertTitle>
                <AlertDescription>
                  {t(
                    'financial.statements.noPostings.body',
                    'There are no posted entries up to this date, so the statement has nothing to report and no currency to report it in.',
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <StatementSectionTable
              title={t('financial.statements.incomeStatement.revenue', 'Revenue')}
              section={data.revenue}
              currencyCode={currency}
              emptyLabel={t('financial.statements.section.empty', 'No accounts with a balance on this side.')}
            />
            <StatementSectionTable
              title={t('financial.statements.incomeStatement.expenses', 'Expenses')}
              section={data.expenses}
              currencyCode={currency}
              emptyLabel={t('financial.statements.section.empty', 'No accounts with a balance on this side.')}
            />

            <Card>
              <CardContent className="grid gap-2 pt-6 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t('financial.statements.incomeStatement.totalRevenue', 'Total revenue')}
                  </span>
                  <span className="tabular-nums">{data.totalRevenue}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t('financial.statements.incomeStatement.totalExpenses', 'Total expenses')}
                  </span>
                  <span className="tabular-nums">{data.totalExpenses}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-2 font-medium">
                  <span>
                    {loss
                      ? t('financial.statements.incomeStatement.netLoss', 'Net loss')
                      : t('financial.statements.incomeStatement.netIncome', 'Net income')}
                  </span>
                  <span className="tabular-nums">
                    {data.netIncome}
                    {currency ? ` ${currency}` : ''}
                  </span>
                </div>
              </CardContent>
            </Card>
          </>
        ) : null}
      </PageBody>
    </Page>
  )
}
