'use client'

/**
 * Opening balances: the position the books are carried in at.
 *
 * The screen exists because adoption is a one-time, consequential act, and it has
 * three jobs the API cannot do on its own:
 *
 * - it shows whether they have **already** been posted, because posting them twice
 *   doubles the carried-in position and the API can only refuse the second attempt;
 * - it lets the operator enter a set and see it balance *before* committing, using
 *   the same line editor a journal entry uses;
 * - it says plainly that they post as one entry of type `opening`, which is what
 *   makes "what were we carried in at" answerable later from the data.
 *
 * It posts into the period the opening date falls in, so a closed period refuses —
 * which is correct, and the server's message says which one.
 */

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import EntryLinesEditor, { emptyEntryLine, type EntryLineValue } from '../../../components/EntryLinesEditor'

const OPENING_BALANCES_API = '/api/financial/opening-balances'
const MUTATION_CONTEXT_ID = 'financial.opening-balances'
const DEFAULT_CURRENCY = 'SAR'

type PostedLine = {
  accountId: string
  accountCode: string
  accountName: string
  debitAmount: string
  creditAmount: string
}

type OpeningBalancesResponse =
  | { posted: false }
  | {
      posted: true
      entry: { id: string; entryNumber: string; postingDate: string; updatedAt: string; total: string }
      lines: PostedLine[]
    }

type OpeningBalancesFormValues = {
  openingDate: string
  description: string
  currencyCode: string
  lines: EntryLineValue[]
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function useOpeningBalanceFields(t: TranslateFn) {
  return React.useMemo(
    () => [
      {
        id: 'openingDate',
        label: t('financial.openingBalances.fields.openingDate', 'Books open at'),
        type: 'date' as const,
        required: true,
      },
      {
        id: 'description',
        label: t('financial.openingBalances.fields.description', 'Description'),
        type: 'text' as const,
        required: true,
      },
      {
        id: 'currencyCode',
        label: t('financial.openingBalances.fields.currencyCode', 'Currency (ISO 4217)'),
        type: 'text' as const,
        required: true,
      },
      {
        id: 'lines',
        label: t('financial.openingBalances.fields.lines', 'Balances'),
        type: 'custom' as const,
        component: EntryLinesEditor,
        rendersOwnError: true,
      },
    ],
    [t],
  )
}

function useOpeningBalanceGroups(t: TranslateFn): CrudFormGroup[] {
  return React.useMemo(
    () => [
      {
        id: 'header',
        title: t('financial.openingBalances.groups.header', 'Opening position'),
        column: 1,
        fields: ['openingDate', 'description', 'currencyCode'],
      },
      {
        id: 'lines',
        title: t('financial.openingBalances.groups.lines', 'Account balances'),
        column: 1,
        fields: ['lines'],
      },
    ],
    [t],
  )
}

export default function OpeningBalancesPage() {
  const t = useT()
  const fields = useOpeningBalanceFields(t)
  const groups = useOpeningBalanceGroups(t)
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: MUTATION_CONTEXT_ID,
  })

  const [state, setState] = React.useState<OpeningBalancesResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    const call = await apiCall<OpeningBalancesResponse>(OPENING_BALANCES_API)
    if (!call.ok || !call.result) {
      setState(null)
      setLoadError(t('financial.openingBalances.error.load', 'Unable to read the opening balances.'))
      setIsLoading(false)
      return
    }
    setState(call.result)
    setIsLoading(false)
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const handleSubmit = React.useCallback(
    async (values: OpeningBalancesFormValues) => {
      const body = {
        openingDate: values.openingDate,
        description: values.description,
        currencyCode: (values.currencyCode || DEFAULT_CURRENCY).toUpperCase(),
        lines: (values.lines ?? []).map((line) => ({
          accountId: line.accountId,
          debitAmount: line.debitAmount,
          creditAmount: line.creditAmount,
        })),
      }
      const call = await runMutation({
        operation: () =>
          apiCall<{ id: string }>(OPENING_BALANCES_API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        context: {
          formId: MUTATION_CONTEXT_ID,
          resourceKind: 'financial:gl_journal_entry',
          resourceId: 'opening-balances',
          retryLastMutation,
        },
        mutationPayload: body,
      })
      if (!call.ok) {
        // The server's refusal is the message the operator needs — an unbalanced
        // set, an already-posted one, a closed period — so it is surfaced rather
        // than replaced with a generic failure.
        flash(
          (call.result as { error?: string } | null)?.error ??
            t('financial.openingBalances.error.post', 'Unable to post the opening balances.'),
          'error',
        )
        return
      }
      flash(t('financial.openingBalances.flash.posted', 'Opening balances posted.'), 'success')
      await load()
    },
    [load, retryLastMutation, runMutation, t],
  )

  const alreadyPosted = state?.posted === true

  return (
    <Page>
      <PageHeader
        title={t('financial.openingBalances.title', 'Opening balances')}
        description={t(
          'financial.openingBalances.description',
          'The position the books are carried in at, posted as one journal entry of type "opening".',
        )}
      />
      <PageBody>
        {isLoading ? (
          <LoadingMessage label={t('financial.openingBalances.loading', 'Reading the ledger...')} />
        ) : null}

        {!isLoading && loadError ? (
          <ErrorMessage
            label={loadError}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
                {t('financial.accounts.actions.retry', 'Retry')}
              </Button>
            }
          />
        ) : null}

        {!isLoading && !loadError && alreadyPosted && state?.posted ? (
          <>
            <Alert variant="info">
              <AlertTitle>
                {t('financial.openingBalances.alreadyPosted.title', 'Opening balances are posted')}
              </AlertTitle>
              <AlertDescription>
                {t(
                  'financial.openingBalances.alreadyPosted.body',
                  'They are part of the ledger as entry {{entryNumber}}. A posted entry cannot be changed, so a correction is a reversing entry — the journal below is where you make it.',
                  { entryNumber: state.entry.entryNumber },
                )}
              </AlertDescription>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle>
                  {t('financial.openingBalances.posted.title', 'Carried in')} · {state.entry.entryNumber} ·{' '}
                  {state.entry.postingDate}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="pb-2 text-start font-medium">
                        {t('financial.entries.columns.number', 'Number')}
                      </th>
                      <th className="pb-2 text-start font-medium">
                        {t('financial.accounts.columns.name', 'Account')}
                      </th>
                      <th className="pb-2 text-end font-medium">
                        {t('financial.journal.columns.debit', 'Debit')}
                      </th>
                      <th className="pb-2 text-end font-medium">
                        {t('financial.journal.columns.credit', 'Credit')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.lines.map((line, index) => (
                      <tr key={`${line.accountId}-${index}`} className="border-t border-border">
                        <td className="py-1.5 font-mono text-xs">{line.accountCode}</td>
                        <td className="py-1.5">{line.accountName}</td>
                        <td className="py-1.5 text-end tabular-nums">{line.debitAmount}</td>
                        <td className="py-1.5 text-end tabular-nums">{line.creditAmount}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border font-medium">
                      <td className="py-2" colSpan={2}>
                        {t('financial.openingBalances.posted.total', 'Total')}
                      </td>
                      <td className="py-2 text-end tabular-nums" colSpan={2}>
                        {state.entry.total}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <p className="pt-3 text-xs text-muted-foreground">
                  {t('financial.openingBalances.alreadyPosted.journalLink', 'See it in the')}{' '}
                  <Link className="underline" href="/backend/financial/journal-entries">
                    {t('financial.journal.page.title', 'Journal entries')}
                  </Link>
                  .
                </p>
              </CardContent>
            </Card>
          </>
        ) : null}

        {!isLoading && !loadError && !alreadyPosted ? (
          <>
            <Alert variant="warning">
              <AlertTitle>
                {t('financial.openingBalances.once.title', 'Opening balances are posted once')}
              </AlertTitle>
              <AlertDescription>
                {t(
                  'financial.openingBalances.once.body',
                  'They must net to zero, and they are posted as a single entry that cannot be edited afterwards. Check the totals before you post.',
                )}
              </AlertDescription>
            </Alert>

            <CrudForm<OpeningBalancesFormValues>
              title={t('financial.openingBalances.form.title', 'Enter the opening position')}
              fields={fields}
              groups={groups}
              initialValues={{
                openingDate: today(),
                description: '',
                currencyCode: DEFAULT_CURRENCY,
                lines: [emptyEntryLine(), emptyEntryLine()],
              }}
              submitLabel={t('financial.openingBalances.form.submit', 'Post opening balances')}
              onSubmit={handleSubmit}
              entityId="financial:gl_journal_entry"
            />
          </>
        ) : null}
      </PageBody>
    </Page>
  )
}
