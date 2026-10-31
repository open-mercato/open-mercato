'use client'

import * as React from 'react'
import { z } from 'zod'
import { ArrowRight, CheckCircle2, FileText, RotateCcw } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { FinanceStatusBadge } from './FinanceStatusBadge'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from '@open-mercato/ui/primitives/alert'
import { Progress } from '@open-mercato/ui/primitives/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import copy from '../data/bank-close-copy.json'

const journalSchema = z.object({
  date: z.string(),
  source: z.string(),
  description: z.string(),
  debit: z.string(),
  credit: z.string(),
  amount: z.string(),
})
type Journal = z.infer<typeof journalSchema>
const scenarioSchema = z.object({
  version: z.literal(1),
  account: z.string(),
  format: z.string(),
  dateFrom: z.string(),
  dateTo: z.string(),
  sampleSelected: z.boolean(),
  statementImported: z.boolean(),
  feeDeferred: z.boolean(),
  journalDraftSaved: z.boolean(),
  journalPosted: z.boolean(),
  reconciliationChecked: z.boolean(),
  reconciliationApproved: z.boolean(),
  trialChecked: z.boolean(),
  recurringPosted: z.boolean(),
  adjustmentsReviewed: z.boolean(),
  reportsGenerated: z.boolean(),
  reportsApproved: z.boolean(),
  periodLocked: z.boolean(),
  journal: journalSchema,
})
type ScenarioState = z.infer<typeof scenarioSchema>

type Feedback = { kind: 'info' | 'warning' | 'error'; message: string }
type BankRow = {
  id: string
  transaction: string
  date: string
  amount: string
  matched: boolean
}

const storageKey = 'finance-preview-bank-close-v1'
const bankBalance = 824180
const bookBalanceBeforeFee = 824222
const bankFee = 42
const amountFormatter = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const initialState: ScenarioState = {
  version: 1,
  account: 'main',
  format: 'MT940',
  dateFrom: '2026-09-01',
  dateTo: '2026-09-30',
  sampleSelected: false,
  statementImported: false,
  feeDeferred: false,
  journalDraftSaved: false,
  journalPosted: false,
  reconciliationChecked: false,
  reconciliationApproved: false,
  trialChecked: false,
  recurringPosted: false,
  adjustmentsReviewed: false,
  reportsGenerated: false,
  reportsApproved: false,
  periodLocked: false,
  journal: {
    date: '2026-09-24',
    source: '292630102',
    description: copy.journal.defaultDescription,
    debit: '402-01',
    credit: '130-01',
    amount: '42,00',
  },
}

function readStoredState(): ScenarioState {
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    if (!raw) return initialState
    const parsed = scenarioSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : initialState
  } catch {
    return initialState
  }
}

function money(amount: number): string {
  return `${amountFormatter.format(amount)} ${copy.common.pln}`
}

function isJournalValid(journal: Journal): boolean {
  const normalizedAmount = Number(
    journal.amount.replace(/\s/g, '').replace(',', '.'),
  )
  return (
    journal.date >= '2026-09-01' &&
    journal.date <= '2026-09-30' &&
    journal.source.trim() === '292630102' &&
    journal.description.trim().length > 0 &&
    journal.debit === '402-01' &&
    journal.credit === '130-01' &&
    normalizedAmount === bankFee
  )
}

function Status({
  done,
  blocked = false,
}: {
  done: boolean
  blocked?: boolean
}) {
  return (
    <FinanceStatusBadge
      variant={done ? 'success' : blocked ? 'error' : 'warning'}
    >
      {done
        ? copy.common.done
        : blocked
          ? copy.common.blocked
          : copy.common.pending}
    </FinanceStatusBadge>
  )
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {hint}
      </CardContent>
    </Card>
  )
}

function SectionTitle({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="space-y-1">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function AccountSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id="bank-close-account">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="main">{copy.import.accountMain}</SelectItem>
        <SelectItem value="eur">{copy.import.accountEuro}</SelectItem>
      </SelectContent>
    </Select>
  )
}

function JournalAccountSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="402-01">{copy.journal.debitExpense}</SelectItem>
        <SelectItem value="130-01">{copy.journal.creditBank}</SelectItem>
        <SelectItem value="202-01">{copy.journal.otherAccount}</SelectItem>
      </SelectContent>
    </Select>
  )
}

export function BankCloseScenario({
  screenId,
  goTo,
}: {
  screenId: string
  goTo: (screenId: string) => void
}) {
  const [state, setState] = React.useState<ScenarioState>(initialState)
  const [hydrated, setHydrated] = React.useState(false)
  const [feedback, setFeedback] = React.useState<Feedback | null>(null)

  React.useEffect(() => {
    setState(readStoredState())
    setHydrated(true)
  }, [])

  React.useEffect(() => {
    if (!hydrated) return
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(state))
    } catch {
      return
    }
  }, [hydrated, state])

  React.useEffect(() => setFeedback(null), [screenId])

  const change = React.useCallback((patch: Partial<ScenarioState>) => {
    setState((current) => ({ ...current, ...patch }))
  }, [])

  const changeJournal = React.useCallback((patch: Partial<Journal>) => {
    setState((current) => ({
      ...current,
      journal: { ...current.journal, ...patch },
    }))
  }, [])

  const reset = () => {
    setState(initialState)
    setFeedback(null)
    window.sessionStorage.removeItem(storageKey)
    goTo(screenId === 's6' || screenId === 's39' ? 's6' : 's16')
  }

  const importStatement = () => {
    if (state.periodLocked || state.statementImported) return
    if (!state.sampleSelected) {
      setFeedback({ kind: 'warning', message: copy.import.needSample })
      return
    }
    if (
      state.account !== 'main' ||
      !['MT940', 'CAMT.053', 'CSV'].includes(state.format) ||
      !/^2026-09-\d{2}$/.test(state.dateFrom) ||
      !/^2026-09-\d{2}$/.test(state.dateTo) ||
      state.dateFrom < '2026-09-01' ||
      state.dateFrom > '2026-09-23' ||
      state.dateTo < '2026-09-25' ||
      state.dateTo > '2026-09-30'
    ) {
      setFeedback({ kind: 'error', message: copy.import.validation })
      return
    }
    change({
      statementImported: true,
      reconciliationChecked: false,
      reconciliationApproved: false,
    })
    setFeedback({ kind: 'info', message: copy.import.importedDetails })
  }

  const postJournal = () => {
    if (state.journalPosted) return
    if (state.periodLocked) {
      setFeedback({ kind: 'error', message: copy.journal.locked })
      return
    }
    if (!state.statementImported) {
      setFeedback({ kind: 'warning', message: copy.journal.needsImport })
      return
    }
    if (!isJournalValid(state.journal)) {
      setFeedback({ kind: 'error', message: copy.journal.validation })
      return
    }
    change({
      journalPosted: true,
      feeDeferred: false,
      reconciliationChecked: false,
      reconciliationApproved: false,
    })
    setFeedback({ kind: 'info', message: copy.journal.posted })
  }

  const checkReconciliation = () => {
    if (!state.journalPosted) {
      setFeedback({
        kind: 'warning',
        message: copy.reconcile.correctionNeeded,
      })
      return
    }
    change({ reconciliationChecked: true })
    setFeedback({ kind: 'info', message: copy.reconcile.balanced })
  }

  const approveReconciliation = () => {
    if (
      !state.statementImported ||
      !state.journalPosted ||
      !state.reconciliationChecked
    ) {
      setFeedback({ kind: 'warning', message: copy.reconcile.cannotApprove })
      return
    }
    change({ reconciliationApproved: true })
    setFeedback({ kind: 'info', message: copy.reconcile.approved })
  }

  const approveReports = () => {
    if (
      !state.reportsGenerated ||
      !state.adjustmentsReviewed ||
      state.periodLocked
    )
      return
    change({ reportsApproved: true })
    setFeedback({ kind: 'info', message: copy.close.reportsApproved })
  }

  const importLocked = state.statementImported || state.periodLocked
  const bookBalance = bookBalanceBeforeFee - (state.journalPosted ? bankFee : 0)
  const difference = bookBalance - bankBalance
  const closeDone = [
    state.trialChecked,
    state.recurringPosted,
    state.reconciliationApproved,
    state.adjustmentsReviewed,
    state.reportsApproved,
    state.periodLocked,
  ]
  const completedSteps = closeDone.filter(Boolean).length

  const rows: BankRow[] = [
    {
      id: 'transfer',
      transaction: copy.reconcile.transfer,
      date: '25.09.2026',
      amount: copy.reconcile.transferAmount,
      matched: true,
    },
    {
      id: 'fee',
      transaction: copy.reconcile.fee,
      date: '24.09.2026',
      amount: copy.reconcile.feeAmount,
      matched: state.journalPosted,
    },
    {
      id: 'incoming',
      transaction: copy.reconcile.incoming,
      date: '23.09.2026',
      amount: copy.reconcile.incomingAmount,
      matched: true,
    },
  ]
  const columns: ColumnDef<BankRow, unknown>[] = [
    {
      id: 'transaction',
      header: copy.reconcile.transaction,
      accessorKey: 'transaction',
    },
    { id: 'date', header: copy.reconcile.date, accessorKey: 'date' },
    {
      id: 'amount',
      header: copy.reconcile.amount,
      accessorKey: 'amount',
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.amount}</span>
      ),
    },
    {
      id: 'status',
      header: copy.reconcile.status,
      accessorFn: (row) =>
        row.matched ? copy.reconcile.matched : copy.reconcile.unmatched,
      cell: ({ row }) => (
        <FinanceStatusBadge
          variant={row.original.matched ? 'success' : 'warning'}
        >
          {row.original.matched
            ? copy.reconcile.matched
            : copy.reconcile.unmatched}
        </FinanceStatusBadge>
      ),
    },
    {
      id: 'actions',
      header: copy.common.actions,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.id === 'fee' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => goTo(state.journalPosted ? 's3' : 's18')}
          >
            {state.journalPosted
              ? copy.reconcile.viewCorrection
              : copy.reconcile.explain}
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          {copy.common.reset}
        </Button>
      </div>
      {feedback ? (
        <Alert
          status={feedback.kind === 'info' ? 'information' : feedback.kind}
          style="stroke"
          size="sm"
        >
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      ) : null}

      {screenId === 's16' ? (
        <div className="space-y-6">
          <SectionTitle
            title={copy.import.title}
            description={copy.import.description}
          />
          <Card>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bank-close-account">
                  {copy.import.account}
                </Label>
                <AccountSelect
                  value={state.account}
                  onChange={(account) => change({ account })}
                  disabled={importLocked}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-close-format">{copy.import.format}</Label>
                <Select
                  disabled={importLocked}
                  value={state.format}
                  onValueChange={(format) => change({ format })}
                >
                  <SelectTrigger id="bank-close-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MT940">MT940</SelectItem>
                    <SelectItem value="CAMT.053">CAMT.053</SelectItem>
                    <SelectItem value="CSV">CSV</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-close-from">{copy.import.from}</Label>
                <Input
                  id="bank-close-from"
                  disabled={importLocked}
                  type="date"
                  value={state.dateFrom}
                  onChange={(event) => change({ dateFrom: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-close-to">{copy.import.to}</Label>
                <Input
                  id="bank-close-to"
                  disabled={importLocked}
                  type="date"
                  value={state.dateTo}
                  onChange={(event) => change({ dateTo: event.target.value })}
                />
              </div>
            </CardContent>
          </Card>
          <Card className="gap-4">
            <CardHeader>
              <CardTitle>{copy.import.sample}</CardTitle>
              <CardDescription>{copy.import.sampleHint}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => change({ sampleSelected: true })}
                disabled={importLocked}
              >
                <FileText aria-hidden="true" />
                {copy.import.loadSample}
              </Button>
              {state.sampleSelected ? <Status done /> : <Status done={false} />}
            </CardContent>
          </Card>
          {state.statementImported ? (
            <Alert status="information" style="stroke" size="sm">
              <AlertTitle>{copy.import.imported}</AlertTitle>
              <AlertDescription>{copy.import.importedDetails}</AlertDescription>
            </Alert>
          ) : null}
          {state.statementImported ? (
            <p className="text-sm text-muted-foreground">
              {copy.import.duplicates}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="primary-filled"
              onClick={importStatement}
              disabled={importLocked}
            >
              {state.statementImported
                ? copy.import.imported
                : copy.import.import}
            </Button>
            {state.statementImported ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => goTo('s17')}
              >
                {copy.import.openReconciliation}
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {screenId === 's17' ? (
        <div className="space-y-6">
          <SectionTitle
            title={copy.reconcile.title}
            description={copy.reconcile.description}
          />
          {!state.statementImported ? (
            <Alert
              status="warning"
              style="stroke"
              size="sm"
              action={
                <Button
                  type="button"
                  variant="primary-filled"
                  onClick={() => goTo('s16')}
                >
                  {copy.reconcile.openImport}
                  <ArrowRight aria-hidden="true" />
                </Button>
              }
            >
              <AlertDescription>{copy.reconcile.needsImport}</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <Metric
                  label={copy.reconcile.bankBalance}
                  value={money(bankBalance)}
                  hint={copy.reconcile.bankNote}
                />
                <Metric
                  label={copy.reconcile.bookBalance}
                  value={money(bookBalance)}
                  hint={copy.reconcile.bookNote}
                />
                <Metric
                  label={copy.reconcile.difference}
                  value={money(difference)}
                  hint={copy.reconcile.differenceNote}
                />
              </div>
              <DataTable<BankRow>
                emptyState={copy.common.noRows}
                title={copy.reconcile.tableTitle}
                columns={columns}
                data={rows}
                embedded
              />
              <Alert
                status={state.journalPosted ? 'information' : 'warning'}
                style="stroke"
                size="sm"
              >
                <AlertDescription>
                  {state.reconciliationApproved
                    ? copy.reconcile.approved
                    : state.reconciliationChecked
                      ? copy.reconcile.balanced
                      : state.journalPosted
                        ? copy.reconcile.recheckNeeded
                        : copy.reconcile.correctionNeeded}
                </AlertDescription>
              </Alert>
              <div className="flex flex-wrap gap-3">
                {!state.journalPosted ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => goTo('s18')}
                  >
                    {copy.reconcile.openUnmatched}
                    <ArrowRight aria-hidden="true" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={checkReconciliation}
                  disabled={state.reconciliationApproved}
                >
                  {copy.reconcile.recheck}
                </Button>
                <Button
                  type="button"
                  variant="primary-filled"
                  onClick={approveReconciliation}
                  disabled={state.reconciliationApproved}
                >
                  {copy.reconcile.approve}
                </Button>
                {state.reconciliationApproved ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => goTo('s6')}
                  >
                    {copy.reconcile.goToClose}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      {screenId === 's18' ? (
        <div className="space-y-6">
          <SectionTitle
            title={copy.unmatched.title}
            description={copy.unmatched.description}
          />
          {!state.statementImported ? (
            <Alert
              status="information"
              style="stroke"
              size="sm"
              action={
                <Button
                  type="button"
                  variant="primary-filled"
                  onClick={() => goTo('s16')}
                >
                  {copy.reconcile.openImport}
                  <ArrowRight aria-hidden="true" />
                </Button>
              }
            >
              <AlertDescription>{copy.journal.needsImport}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Metric
              label={copy.unmatched.amount}
              value={money(bankFee)}
              hint={copy.reconcile.bankNote}
            />
            <Metric
              label={copy.unmatched.bookEntry}
              value={
                state.journalPosted
                  ? copy.unmatched.posted
                  : copy.unmatched.missing
              }
              hint={copy.reconcile.bookNote}
            />
          </div>
          {state.feeDeferred && !state.journalPosted ? (
            <Alert status="warning" style="stroke" size="sm">
              <AlertDescription>{copy.unmatched.deferred}</AlertDescription>
            </Alert>
          ) : null}
          {!state.journalPosted ? (
            <Card>
              <CardHeader>
                <CardTitle>{copy.unmatched.options}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <p className="font-medium">{copy.unmatched.correction}</p>
                  <p className="text-sm text-muted-foreground">
                    {copy.unmatched.correctionHint}
                  </p>
                  <Button
                    type="button"
                    variant="primary-filled"
                    onClick={() => goTo('s3')}
                    disabled={!state.statementImported || state.periodLocked}
                  >
                    {copy.unmatched.correction}
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </div>
                <div className="space-y-3 rounded-lg border border-border p-4">
                  <p className="font-medium">{copy.unmatched.defer}</p>
                  <p className="text-sm text-muted-foreground">
                    {copy.unmatched.deferHint}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!state.statementImported || state.periodLocked}
                    onClick={() => {
                      change({ feeDeferred: true })
                      setFeedback({
                        kind: 'warning',
                        message: copy.unmatched.deferred,
                      })
                    }}
                  >
                    {copy.unmatched.defer}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Alert status="information" style="stroke" size="sm">
              <AlertDescription>{copy.journal.posted}</AlertDescription>
            </Alert>
          )}
          <Button type="button" variant="outline" onClick={() => goTo('s17')}>
            {copy.unmatched.back}
          </Button>
        </div>
      ) : null}

      {screenId === 's3' ? (
        <div className="space-y-6">
          <SectionTitle
            title={copy.journal.title}
            description={copy.journal.description}
          />
          {!state.statementImported ? (
            <Alert
              status="information"
              style="stroke"
              size="sm"
              action={
                <Button
                  type="button"
                  variant="primary-filled"
                  onClick={() => goTo('s16')}
                >
                  {copy.reconcile.openImport}
                  <ArrowRight aria-hidden="true" />
                </Button>
              }
            >
              <AlertDescription>{copy.journal.needsImport}</AlertDescription>
            </Alert>
          ) : null}
          {state.periodLocked ? (
            <Alert status="warning" style="stroke" size="sm">
              <AlertDescription>{copy.journal.locked}</AlertDescription>
            </Alert>
          ) : null}
          {state.journalPosted ? (
            <Alert status="information" style="stroke" size="sm">
              <AlertDescription>{copy.journal.posted}</AlertDescription>
            </Alert>
          ) : null}
          <Card>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bank-journal-date">{copy.journal.date}</Label>
                <Input
                  id="bank-journal-date"
                  type="date"
                  value={state.journal.date}
                  onChange={(event) =>
                    changeJournal({ date: event.target.value })
                  }
                  disabled={state.periodLocked || state.journalPosted}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-journal-source">
                  {copy.journal.source}
                </Label>
                <Input
                  id="bank-journal-source"
                  value={state.journal.source}
                  onChange={(event) =>
                    changeJournal({ source: event.target.value })
                  }
                  disabled={state.periodLocked || state.journalPosted}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="bank-journal-description">
                  {copy.journal.descriptionLabel}
                </Label>
                <Input
                  id="bank-journal-description"
                  value={state.journal.description}
                  onChange={(event) =>
                    changeJournal({ description: event.target.value })
                  }
                  disabled={state.periodLocked || state.journalPosted}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-journal-debit">{copy.journal.debit}</Label>
                <JournalAccountSelect
                  id="bank-journal-debit"
                  value={state.journal.debit}
                  onChange={(debit) => changeJournal({ debit })}
                  disabled={state.periodLocked || state.journalPosted}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-journal-credit">
                  {copy.journal.credit}
                </Label>
                <JournalAccountSelect
                  id="bank-journal-credit"
                  value={state.journal.credit}
                  onChange={(credit) => changeJournal({ credit })}
                  disabled={state.periodLocked || state.journalPosted}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-journal-amount">
                  {copy.journal.amount}
                </Label>
                <Input
                  id="bank-journal-amount"
                  inputMode="decimal"
                  value={state.journal.amount}
                  onChange={(event) =>
                    changeJournal({ amount: event.target.value })
                  }
                  disabled={state.periodLocked || state.journalPosted}
                />
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric
              label={copy.journal.debitSide}
              value={money(Number(state.journal.amount.replace(',', '.')) || 0)}
              hint={state.journal.debit}
            />
            <Metric
              label={copy.journal.creditSide}
              value={money(Number(state.journal.amount.replace(',', '.')) || 0)}
              hint={state.journal.credit}
            />
            <Metric
              label={copy.journal.difference}
              value={money(0)}
              hint={copy.journal.description}
            />
          </div>
          {state.journalDraftSaved && !state.journalPosted ? (
            <Alert status="information" style="stroke" size="sm">
              <AlertDescription>{copy.journal.draftSaved}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                change({ journalDraftSaved: true })
                setFeedback({ kind: 'info', message: copy.journal.draftSaved })
              }}
              disabled={state.periodLocked || state.journalPosted}
            >
              {copy.journal.saveDraft}
            </Button>
            <Button
              type="button"
              variant="primary-filled"
              onClick={postJournal}
              disabled={state.periodLocked || state.journalPosted}
            >
              {copy.journal.post}
            </Button>
            {!state.journalPosted ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => goTo('s18')}
              >
                {copy.journal.back}
              </Button>
            ) : null}
            {state.journalPosted ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => goTo('s17')}
              >
                {copy.journal.goToReconcile}
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {screenId === 's6' ? (
        <div className="space-y-6">
          <SectionTitle
            title={copy.close.title}
            description={copy.close.description}
          />
          <Card className="gap-3">
            <CardHeader>
              <CardDescription>{copy.close.progress}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {completedSteps} / 6
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Progress
                value={completedSteps}
                max={6}
                label={copy.close.progress}
              />
            </CardContent>
          </Card>
          {state.periodLocked ? (
            <Alert status="information" style="stroke" size="sm">
              <AlertTitle>{copy.close.locked}</AlertTitle>
              <AlertDescription>{copy.close.doneMessage}</AlertDescription>
            </Alert>
          ) : null}
          {[
            {
              title: copy.close.step1,
              details: copy.close.step1Details,
              done: state.trialChecked,
              blocked: false,
              action: copy.close.step1Action,
              onClick: () => change({ trialChecked: true }),
            },
            {
              title: copy.close.step2,
              details: copy.close.step2Details,
              done: state.recurringPosted,
              blocked: !state.trialChecked,
              action: copy.close.step2Action,
              onClick: () => change({ recurringPosted: true }),
            },
            {
              title: copy.close.step3,
              details: copy.close.step3Details,
              done: state.reconciliationApproved,
              blocked: !state.recurringPosted,
              action: copy.close.step3Action,
              onClick: () => goTo(state.statementImported ? 's17' : 's16'),
            },
            {
              title: copy.close.step4,
              details: copy.close.step4Details,
              done: state.adjustmentsReviewed,
              blocked: !state.reconciliationApproved,
              action: copy.close.step4Action,
              onClick: () => change({ adjustmentsReviewed: true }),
            },
          ].map((step) => (
            <Card key={step.title} className="gap-4">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="space-y-2">
                  <CardTitle>{step.title}</CardTitle>
                  <CardDescription>{step.details}</CardDescription>
                </div>
                <Status done={step.done} blocked={step.blocked} />
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  variant={step.done ? 'outline' : 'primary-filled'}
                  onClick={step.onClick}
                  disabled={step.done || step.blocked || state.periodLocked}
                >
                  {step.action}
                </Button>
              </CardContent>
            </Card>
          ))}
          <Card className="gap-4">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="space-y-2">
                <CardTitle>{copy.close.step5}</CardTitle>
                <CardDescription>{copy.close.step5Details}</CardDescription>
              </div>
              <Status
                done={state.reportsApproved}
                blocked={!state.adjustmentsReviewed}
              />
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  change({ reportsGenerated: true })
                  setFeedback({
                    kind: 'info',
                    message: copy.close.reportsGenerated,
                  })
                }}
                disabled={
                  !state.adjustmentsReviewed ||
                  state.reportsGenerated ||
                  state.periodLocked
                }
              >
                {copy.close.step5Generate}
              </Button>
              <Button
                type="button"
                variant="primary-filled"
                onClick={approveReports}
                disabled={
                  !state.reportsGenerated ||
                  state.reportsApproved ||
                  state.periodLocked
                }
              >
                {copy.close.step5Approve}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => goTo('s39')}
                disabled={!state.reportsGenerated}
              >
                {copy.close.reportPreview}
                <ArrowRight aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
          <Card className="gap-4">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="space-y-2">
                <CardTitle>{copy.close.step6}</CardTitle>
                <CardDescription>{copy.close.step6Details}</CardDescription>
              </div>
              <Status
                done={state.periodLocked}
                blocked={!state.reportsApproved}
              />
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                variant="primary-filled"
                onClick={() => {
                  if (closeDone.slice(0, 5).every(Boolean)) {
                    change({ periodLocked: true })
                    setFeedback({
                      kind: 'info',
                      message: copy.close.doneMessage,
                    })
                  } else
                    setFeedback({
                      kind: 'warning',
                      message: copy.close.blockedMessage,
                    })
                }}
                disabled={!state.reportsApproved || state.periodLocked}
              >
                {copy.close.step6Action}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {screenId === 's39' ? (
        <div className="space-y-6">
          <SectionTitle
            title={copy.report.title}
            description={copy.report.description}
          />
          <Alert status="information" style="stroke" size="sm">
            <AlertDescription>
              {state.reportsApproved
                ? copy.report.approved
                : state.reportsGenerated
                  ? copy.report.generated
                  : copy.report.notGenerated}
            </AlertDescription>
          </Alert>
          <div className="grid gap-4 md:grid-cols-3">
            <Metric
              label={copy.close.step5}
              value={state.reportsGenerated ? '3 / 3' : '0 / 3'}
              hint={copy.close.step5Details}
            />
            <Metric
              label={copy.close.step3}
              value={money(state.journalPosted ? 0 : bankFee)}
              hint={copy.reconcile.differenceNote}
            />
            <Metric
              label={copy.close.progress}
              value={`${completedSteps} / 6`}
              hint={copy.close.title}
            />
          </div>
          {state.reportsGenerated ? (
            <Card>
              <CardHeader>
                <CardTitle>{copy.report.incomeStatement}</CardTitle>
                <CardDescription>{copy.report.period}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="divide-y divide-border">
                  {[
                    { label: copy.report.revenue, amount: 2480000 },
                    { label: copy.report.costs, amount: 1990000 },
                    { label: copy.report.profit, amount: 490000 },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between gap-4 py-4"
                    >
                      <dt>{row.label}</dt>
                      <dd className="font-semibold tabular-nums">
                        {money(row.amount)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="pt-3 text-sm text-muted-foreground">
                  {copy.report.reconciliation}
                </p>
              </CardContent>
            </Card>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {state.reportsGenerated && !state.reportsApproved ? (
              <Button
                type="button"
                variant="primary-filled"
                onClick={approveReports}
              >
                {copy.close.step5Approve}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => goTo('s6')}>
              {copy.report.back}
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
