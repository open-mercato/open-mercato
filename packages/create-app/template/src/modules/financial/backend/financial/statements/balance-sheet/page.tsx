'use client'

/**
 * The balance sheet as of a date, read from the posted ledger.
 *
 * The screen's job beyond printing the numbers is the **balance check**. When the
 * two totals disagree the statement says so, prominently, instead of looking like
 * every other report: a sheet that does not balance means a posting is wrong, and
 * hiding it behind a plug or a quiet rounding is how a real error survives to the
 * year end. The figures are shown either way — the difference is the finding.
 *
 * Retained earnings for the period are already folded into equity by the read
 * model, so the sheet balances on books that have traded without a closing entry.
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

const STATEMENT_API = '/api/financial/statements/balance-sheet'

type BalanceSheetResponse = {
  asOf: string
  currencyCode: string | null
  assets: StatementSectionData
  liabilities: StatementSectionData
  equity: StatementSectionData
  totalAssets: string
  totalLiabilitiesAndEquity: string
  balanced: boolean
  netIncome: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function BalanceSheetPage() {
  const t = useT()
  const [asOf, setAsOf] = React.useState(today())
  const [data, setData] = React.useState<BalanceSheetResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    const call = await apiCall<BalanceSheetResponse>(`${STATEMENT_API}?asOf=${encodeURIComponent(asOf)}`)
    if (!call.ok || !call.result) {
      setData(null)
      setError(t('financial.statements.error.load', 'Unable to build the statement.'))
      setIsLoading(false)
      return
    }
    setData(call.result)
    setIsLoading(false)
  }, [asOf, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const currency = data?.currencyCode ?? null

  return (
    <Page>
      <PageHeader
        title={t('financial.statements.balanceSheet.title', 'Balance sheet')}
        description={t(
          'financial.statements.balanceSheet.description',
          'What the organization owns and owes, read from the posted ledger as of a date.',
        )}
      />
      <PageBody>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-2">
            <Label htmlFor="balance-sheet-as-of">{t('financial.statements.fields.asOf', 'As of')}</Label>
            <Input
              id="balance-sheet-as-of"
              type="date"
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
            />
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
            {!data.balanced ? (
              <Alert variant="warning">
                <AlertTitle>
                  {t('financial.statements.balanceSheet.unbalanced.title', 'The sheet does not balance')}
                </AlertTitle>
                <AlertDescription>
                  {t(
                    'financial.statements.balanceSheet.unbalanced.body',
                    'Total assets differ from total liabilities and equity. This is not a rounding difference — a posted entry is wrong. The figures below are reported as they are.',
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

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
              title={t('financial.statements.balanceSheet.assets', 'Assets')}
              section={data.assets}
              currencyCode={currency}
              emptyLabel={t('financial.statements.section.empty', 'No accounts with a balance on this side.')}
            />
            <StatementSectionTable
              title={t('financial.statements.balanceSheet.liabilities', 'Liabilities')}
              section={data.liabilities}
              currencyCode={currency}
              emptyLabel={t('financial.statements.section.empty', 'No accounts with a balance on this side.')}
            />
            <StatementSectionTable
              title={t('financial.statements.balanceSheet.equity', 'Equity')}
              section={data.equity}
              currencyCode={currency}
              emptyLabel={t('financial.statements.section.empty', 'No accounts with a balance on this side.')}
            />

            <Card>
              <CardContent className="grid gap-2 pt-6 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t('financial.statements.balanceSheet.totalAssets', 'Total assets')}
                  </span>
                  <span className="tabular-nums">{data.totalAssets}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t('financial.statements.balanceSheet.netIncome', 'Result for the period (in equity)')}
                  </span>
                  <span className="tabular-nums">{data.netIncome}</span>
                </div>
                <div className="flex justify-between border-t border-border pt-2 font-medium">
                  <span>
                    {t(
                      'financial.statements.balanceSheet.totalLiabilitiesAndEquity',
                      'Total liabilities and equity',
                    )}
                  </span>
                  <span className="tabular-nums">
                    {data.totalLiabilitiesAndEquity}
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
