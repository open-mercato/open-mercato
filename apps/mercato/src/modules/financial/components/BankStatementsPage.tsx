'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const IMPORT_API = '/api/financial/bank-statements/import'
const LIST_API = 'financial/bank-statements'
const LINES_API = '/api/financial/bank-statements/lines'
const MATCH_API = '/api/financial/bank-statements/match'

type CashAccount = { id: string; code: string; name: string }
type Statement = {
  id: string
  cash_account_id: string
  file_name?: string | null
  period_start?: string | null
  period_end?: string | null
  status: string
  created_at?: string | null
}
type StatementLine = {
  id: string
  line_number: number
  transaction_date: string
  description: string | null
  reference: string | null
  direction: 'in' | 'out'
  amount: string
  status: string
}

type MutationContext = { formId: string; resourceKind: string; resourceId: string; retryLastMutation: () => Promise<boolean> }

export default function BankStatementsPage() {
  const t = useT()
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: 'financial.bank-statements',
    blockedMessage: t('financial.bankStatements.errors.save', 'The statement action could not be completed.'),
  })
  const [cashAccountId, setCashAccountId] = React.useState('')
  const [file, setFile] = React.useState<File | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [lines, setLines] = React.useState<StatementLine[]>([])
  const [isLoadingLines, setIsLoadingLines] = React.useState(false)
  const [isBusy, setIsBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const accountsQuery = useQuery({
    queryKey: ['financial-cash-accounts-options'],
    queryFn: () => fetchCrudList<CashAccount>('financial/cash-accounts', { pageSize: 100 }),
  })
  const statementsQuery = useQuery({
    queryKey: ['financial-bank-statements'],
    queryFn: () => fetchCrudList<Statement>(LIST_API, { pageSize: 50, sortField: 'createdAt', sortDir: 'desc' }),
  })
  const accounts = accountsQuery.data?.items ?? []
  const statements = statementsQuery.data?.items ?? []

  const loadLines = React.useCallback(async (statementId: string) => {
    setSelected(statementId)
    setIsLoadingLines(true)
    const call = await apiCall<{ items?: StatementLine[] }>(`${LINES_API}?id=${statementId}`)
    setLines(call.ok ? (call.result?.items ?? []) : [])
    setIsLoadingLines(false)
  }, [])

  const handleImport = async () => {
    if (!file || !cashAccountId || isBusy) return
    setIsBusy(true)
    try {
      const form = new FormData()
      form.set('cashAccountId', cashAccountId)
      form.set('file', file)
      const call = await runMutation({
        operation: () => apiCallOrThrow<{ id: string; lineCount: number }>(IMPORT_API, { method: 'POST', body: form }),
        context: {
          formId: 'financial.bank-statements',
          resourceKind: 'financial:bank_statement',
          resourceId: cashAccountId,
          retryLastMutation,
        },
        mutationPayload: { cashAccountId, fileName: file.name },
      })
      if (call.result?.id) {
        flash(t('financial.bankStatements.messages.imported', 'Statement imported.'), 'success')
        await statementsQuery.refetch()
        await loadLines(call.result.id)
      }
    } catch {
      flash(t('financial.bankStatements.errors.import', 'Could not import the statement.'), 'error')
    } finally {
      setIsBusy(false)
    }
  }

  const handleMatch = async () => {
    if (!selected || isBusy) return
    setIsBusy(true)
    try {
      const call = await runMutation({
        operation: () => apiCallOrThrow<{ matched: number; unmatched: number }>(MATCH_API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: selected }),
        }),
        context: {
          formId: 'financial.bank-statements',
          resourceKind: 'financial:gl_bank_statement',
          resourceId: selected,
          retryLastMutation,
        },
        mutationPayload: { id: selected },
      })
      if (call.result) {
        flash(t('financial.bankStatements.messages.matched', 'Matched {matched}; {unmatched} remain.', {
          matched: call.result.matched,
          unmatched: call.result.unmatched,
        }), 'success')
        await loadLines(selected)
        await statementsQuery.refetch()
      }
    } catch {
      flash(t('financial.bankStatements.errors.match', 'Could not match the statement.'), 'error')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={t('financial.bankStatements.pageTitle', 'Bank reconciliation')}
        description={t('financial.bankStatements.pageDescription', 'Import a bank CSV and match its lines to posted cash and bank entries.')}
      />
      <PageBody>
        <Card>
          <CardHeader><CardTitle>{t('financial.bankStatements.import.title', 'Import statement')}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label>{t('financial.bankStatements.import.account', 'Cash or bank account')}</Label>
              <Select value={cashAccountId} onValueChange={setCashAccountId}>
                <SelectTrigger><SelectValue placeholder={t('financial.bankStatements.import.accountPlaceholder', 'Select an account')} /></SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.code} — {account.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bank-file">{t('financial.bankStatements.import.file', 'CSV file')}</Label>
              <Input id="bank-file" type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </div>
            <Button type="button" onClick={() => void handleImport()} disabled={isBusy || !file || !cashAccountId}>
              {t('financial.bankStatements.import.submit', 'Import')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('financial.bankStatements.statements.title', 'Statements')}</CardTitle></CardHeader>
          <CardContent>
            {statements.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('financial.bankStatements.statements.empty', 'No statements imported.')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-start text-xs text-muted-foreground">
                    <th className="py-2 pe-3">{t('financial.bankStatements.statements.file', 'File')}</th>
                    <th className="py-2 pe-3">{t('financial.bankStatements.statements.period', 'Period')}</th>
                    <th className="py-2 pe-3">{t('financial.bankStatements.statements.status', 'Status')}</th>
                    <th className="py-2 text-end">{t('financial.bankStatements.statements.actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {statements.map((statement) => (
                    <tr key={statement.id} className="border-b border-border/60">
                      <td className="py-2 pe-3">{statement.file_name ?? statement.id.slice(0, 8)}</td>
                      <td className="py-2 pe-3">{statement.period_start?.slice(0, 10)} — {statement.period_end?.slice(0, 10)}</td>
                      <td className="py-2 pe-3"><Badge variant={statement.status === 'reconciled' ? 'success' : 'outline'}>{statement.status}</Badge></td>
                      <td className="py-2 text-end">
                        <Button type="button" variant="outline" size="sm" onClick={() => void loadLines(statement.id)}>
                          {t('financial.bankStatements.statements.open', 'Open')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {selected ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('financial.bankStatements.lines.title', 'Statement lines')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button type="button" onClick={() => void handleMatch()} disabled={isBusy}>
                {t('financial.bankStatements.lines.match', 'Auto-match')}
              </Button>
              {isLoadingLines ? <LoadingMessage label={t('financial.bankStatements.lines.loading', 'Loading lines…')} /> : null}
              {error ? <ErrorMessage label={error} /> : null}
              {!isLoadingLines && lines.length === 0 ? <p className="text-sm text-muted-foreground">{t('financial.bankStatements.lines.empty', 'No lines.')}</p> : null}
              {!isLoadingLines && lines.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-start text-xs text-muted-foreground">
                      <th className="py-2 pe-3">{t('financial.bankStatements.lines.date', 'Date')}</th>
                      <th className="py-2 pe-3">{t('financial.bankStatements.lines.description', 'Description')}</th>
                      <th className="py-2 pe-3 text-end">{t('financial.bankStatements.lines.amount', 'Amount')}</th>
                      <th className="py-2 text-end">{t('financial.bankStatements.lines.status', 'Status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id} className="border-b border-border/60">
                        <td className="py-2 pe-3">{line.transaction_date}</td>
                        <td className="py-2 pe-3">{line.description ?? line.reference ?? '—'}</td>
                        <td className="py-2 pe-3 text-end">{line.direction === 'out' ? '-' : ''}{line.amount}</td>
                        <td className="py-2 text-end"><Badge variant={line.status === 'matched' ? 'success' : 'outline'}>{line.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </PageBody>
    </>
  )
}
