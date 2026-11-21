'use client'

import * as React from 'react'
import { z } from 'zod'
import { useLocale } from '@open-mercato/shared/lib/i18n/context'
import {
  ArrowRight,
  Banknote,
  CircleDollarSign,
  CheckCircle2,
  Eye,
  XCircle,
  ClipboardCheck,
  FileText,
  RotateCcw,
  Wallet,
} from 'lucide-react'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@open-mercato/ui/primitives/card'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Input } from '@open-mercato/ui/primitives/input'
import { Progress } from '@open-mercato/ui/primitives/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { FinanceStatusBadge } from './FinanceStatusBadge'
import copyData from '../data/budget-currency-copy.json'

const currencySchema = z.enum(['PLN', 'EUR', 'USD'])
type Currency = z.infer<typeof currencySchema>
type ScenarioCopy = typeof copyData.pl
const invoiceSchema = z.object({
  customer: z.string(),
  currency: currencySchema,
  quantity: z.number().nonnegative(),
  unitPrice: z.number().nonnegative(),
  vatRate: z.number().min(0).max(100),
  invoiceRate: z.number().nonnegative(),
  paymentRate: z.number().nonnegative(),
  paymentAmount: z.number().nonnegative(),
  paid: z.number().nonnegative(),
  fxRealized: z.number(),
  lastFx: z.number(),
  lastPayment: z.number().nonnegative(),
  lastInvoiceRate: z.number().nonnegative(),
  lastPaymentRate: z.number().nonnegative(),
  paymentDraft: z.boolean(),
  status: z.enum(['draft', 'issued', 'part-paid', 'settled']),
})
type InvoiceState = z.infer<typeof invoiceSchema>
const budgetSchema = z.object({
  limit: z.number().nonnegative(),
  actual: z.number().nonnegative(),
  commitments: z.number().nonnegative(),
  requestAmount: z.number().nonnegative(),
  subject: z.string(),
  justification: z.string(),
  requestStatus: z.enum([
    'draft',
    'committed',
    'pending',
    'overridden',
    'rejected',
  ]),
  decisionReason: z.string(),
})
type BudgetState = z.infer<typeof budgetSchema>

const initialInvoice: InvoiceState = {
  customer: copyData.pl.sampleCustomer,
  currency: 'EUR',
  quantity: 10,
  unitPrice: 1200,
  vatRate: 23,
  invoiceRate: 4.28,
  paymentRate: 4.34,
  paymentAmount: 3000,
  paid: 0,
  fxRealized: 0,
  lastFx: 0,
  lastPayment: 0,
  lastInvoiceRate: 4.28,
  lastPaymentRate: 4.34,
  status: 'draft',
  paymentDraft: true,
}

const initialBudget: BudgetState = {
  limit: 480000,
  actual: 362000,
  commitments: 100000,
  requestAmount: 24600,
  subject: copyData.pl.sampleSubject,
  justification: copyData.pl.sampleJustification,
  requestStatus: 'draft',
  decisionReason: '',
}

const invoiceStorageKey = 'finance-preview-currency-v1'
const budgetStorageKey = 'finance-preview-budget-v1'
const invoiceRates: Record<Currency, number> = { PLN: 1, EUR: 4.28, USD: 3.9 }
const paymentRates: Record<Currency, number> = { PLN: 1, EUR: 4.34, USD: 3.95 }

function useSessionScenario<State extends object>(
  key: string,
  initialValue: State,
  schema: z.ZodType<State>,
): [State, React.Dispatch<React.SetStateAction<State>>] {
  const [value, setValue] = React.useState<State>(initialValue)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(key)
      if (saved) {
        const parsed = schema.safeParse(JSON.parse(saved))
        setValue(parsed.success ? parsed.data : initialValue)
      }
    } catch {
      setValue(initialValue)
    }
    setReady(true)
  }, [initialValue, key, schema])

  React.useEffect(() => {
    if (!ready) return
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      return
    }
  }, [key, ready, value])

  return [value, setValue]
}

function useScenarioCopy(): { copy: ScenarioCopy; locale: string } {
  const polish = useLocale() === 'pl'
  return {
    copy: polish ? copyData.pl : copyData.en,
    locale: polish ? 'pl-PL' : 'en-US',
  }
}

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

function safeAmount(amount: number): number {
  return Number.isFinite(amount) ? Math.max(0, amount) : 0
}

function Money({
  amount,
  currency,
  locale,
}: {
  amount: number
  currency: Currency
  locale: string
}) {
  return (
    <span className="tabular-nums">
      {new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
      }).format(roundMoney(amount))}
    </span>
  )
}

function NumericField({
  label,
  value,
  onChange,
  step = '0.01',
  description,
  disabled,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: string
  description?: string
  disabled?: boolean
}) {
  return (
    <FormField label={label} description={description} disabled={disabled}>
      <Input
        type="number"
        inputMode="decimal"
        min="0"
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(safeAmount(Number(event.target.value)))}
      />
    </FormField>
  )
}

function ScenarioMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  icon: typeof Wallet
}) {
  return (
    <Card className="border-b-2 border-b-accent-indigo/40 shadow-sm">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{label}</span>
          <Icon className="size-5 text-accent-indigo" aria-hidden="true" />
        </div>
        <strong className="block text-2xl font-semibold text-foreground">
          {value}
        </strong>
      </CardContent>
    </Card>
  )
}

function ScenarioHeader({
  title,
  description,
  status,
  statusLabel,
  onReset,
  copy,
}: {
  title: string
  description: string
  status: 'success' | 'warning' | 'info' | 'neutral' | 'error'
  statusLabel: string
  onReset: () => void
  copy: ScenarioCopy
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <FinanceStatusBadge
          variant={status}
          icon={status === 'neutral' ? 'draft' : undefined}
        >
          {statusLabel}
        </FinanceStatusBadge>
        <p className="text-sm text-muted-foreground" aria-label={title}>
          {description}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onReset}>
        <RotateCcw aria-hidden="true" />
        {copy.reset}
      </Button>
    </div>
  )
}

function InvoiceScenario({
  screenId,
  goTo,
  invoice,
  setInvoice,
  copy,
  locale,
}: {
  screenId: string
  goTo: (screenId: string) => void
  invoice: InvoiceState
  setInvoice: React.Dispatch<React.SetStateAction<InvoiceState>>
  copy: ScenarioCopy
  locale: string
}) {
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [showJournal, setShowJournal] = React.useState(false)
  const net = roundMoney(invoice.quantity * invoice.unitPrice)
  const vat = roundMoney((net * invoice.vatRate) / 100)
  const gross = roundMoney(net + vat)
  const outstanding = Math.max(0, roundMoney(gross - invoice.paid))
  const paymentBase = roundMoney(invoice.paymentAmount * invoice.paymentRate)
  const paymentBook = roundMoney(invoice.paymentAmount * invoice.invoiceRate)
  const previewFx = roundMoney(paymentBase - paymentBook)
  const isInvoice = screenId === 's42'
  const statusLabel =
    invoice.status === 'draft'
      ? copy.invoiceDraft
      : invoice.status === 'issued'
        ? copy.invoiceReady
        : invoice.status === 'settled'
          ? copy.invoicePaid
          : copy.invoicePartPaid

  const editInvoice = (patch: Partial<InvoiceState>) => {
    setInvoice((current) => ({
      ...current,
      ...patch,
      paid: 0,
      fxRealized: 0,
      lastFx: 0,
      lastPayment: 0,
      status: 'draft',
    }))
    setMessage(null)
    setError(null)
  }

  const settle = () => {
    setError(null)
    if (!invoice.paymentDraft) return
    if (invoice.status === 'draft') {
      setError(copy.settlementNeedsInvoice)
      return
    }
    if (invoice.paymentAmount <= 0 || invoice.paymentRate <= 0) {
      setError(copy.settlementInvalid)
      return
    }
    if (invoice.paymentAmount > outstanding + 0.001) {
      setError(copy.settlementTooLarge)
      return
    }
    const nextPaid = roundMoney(invoice.paid + invoice.paymentAmount)
    setInvoice((current) => ({
      ...current,
      paid: nextPaid,
      fxRealized: roundMoney(current.fxRealized + previewFx),
      lastFx: previewFx,
      lastPayment: current.paymentAmount,
      lastInvoiceRate: current.invoiceRate,
      lastPaymentRate: current.paymentRate,
      paymentDraft: false,
      status: nextPaid >= gross - 0.001 ? 'settled' : 'part-paid',
    }))
    setMessage(copy.settlementDone)
    setShowJournal(false)
  }

  return (
    <div className="space-y-5">
      <ScenarioHeader
        title={isInvoice ? copy.invoiceTitle : copy.settlementTitle}
        description={
          isInvoice ? copy.invoiceDescription : copy.settlementDescription
        }
        status={
          invoice.status === 'settled'
            ? 'success'
            : invoice.status === 'draft'
              ? 'neutral'
              : 'info'
        }
        statusLabel={statusLabel}
        copy={copy}
        onReset={() => {
          setInvoice(initialInvoice)
          setShowJournal(false)
          setMessage(null)
          setError(null)
        }}
      />

      {message ? (
        <Alert status="success" style="stroke" size="sm">
          {message}
        </Alert>
      ) : null}
      {error ? (
        <Alert status="error" style="stroke" size="sm">
          {error}
        </Alert>
      ) : null}

      {isInvoice ? (
        <Card>
          <CardHeader>
            <CardTitle>{copy.invoiceTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <fieldset
              disabled={invoice.status !== 'draft'}
              className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
            >
              <FormField label={copy.counterparty}>
                <Input
                  value={invoice.customer}
                  onChange={(event) =>
                    editInvoice({ customer: event.target.value })
                  }
                />
              </FormField>
              <FormField
                label={copy.currency}
                id="finance-preview-invoice-currency"
              >
                <Select
                  value={invoice.currency}
                  disabled={invoice.status !== 'draft'}
                  onValueChange={(value) => {
                    const currency = value as Currency
                    editInvoice({
                      currency,
                      invoiceRate: invoiceRates[currency],
                      paymentRate: paymentRates[currency],
                    })
                  }}
                >
                  <SelectTrigger id="finance-preview-invoice-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLN">{copy.pln}</SelectItem>
                    <SelectItem value="EUR">{copy.eur}</SelectItem>
                    <SelectItem value="USD">{copy.usd}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <NumericField
                label={copy.invoiceRate}
                value={invoice.invoiceRate}
                onChange={(value) => editInvoice({ invoiceRate: value })}
                step="0.0001"
                description={copy.rateHint}
                disabled={invoice.currency === 'PLN'}
              />
              <NumericField
                label={copy.quantity}
                value={invoice.quantity}
                onChange={(value) => editInvoice({ quantity: value })}
                step="1"
              />
              <NumericField
                label={copy.unitPrice}
                value={invoice.unitPrice}
                onChange={(value) => editInvoice({ unitPrice: value })}
              />
              <NumericField
                label={copy.vatRate}
                value={invoice.vatRate}
                onChange={(value) =>
                  editInvoice({ vatRate: Math.min(value, 100) })
                }
                step="1"
              />
            </fieldset>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{copy.settlementTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-muted-foreground">
              {invoice.customer} ·{' '}
              <Money
                amount={gross}
                currency={invoice.currency}
                locale={locale}
              />{' '}
              · {copy.invoiceRate}: {invoice.invoiceRate}
            </p>
            {invoice.status === 'draft' ? (
              <p className="text-sm text-muted-foreground">
                {copy.settlementNeedsInvoice}
              </p>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <NumericField
                label={copy.paymentAmount}
                value={invoice.paymentAmount}
                onChange={(paymentAmount) =>
                  setInvoice((current) => ({
                    ...current,
                    paymentAmount,
                    paymentDraft: true,
                  }))
                }
                disabled={!invoice.paymentDraft}
              />
              <NumericField
                label={copy.paymentRate}
                value={invoice.paymentRate}
                onChange={(paymentRate) =>
                  setInvoice((current) => ({
                    ...current,
                    paymentRate,
                    paymentDraft: true,
                  }))
                }
                step="0.0001"
                description={copy.rateHint}
                disabled={invoice.currency === 'PLN' || !invoice.paymentDraft}
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="primary-filled"
                onClick={settle}
                disabled={
                  outstanding <= 0 ||
                  !invoice.paymentDraft ||
                  invoice.status === 'draft'
                }
              >
                <Banknote aria-hidden="true" />
                {copy.settlePayment}
              </Button>
              {invoice.lastPayment > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowJournal((current) => !current)}
                  aria-expanded={showJournal}
                >
                  <Eye aria-hidden="true" />
                  {copy.viewJournal}
                </Button>
              ) : null}
              {!invoice.paymentDraft && outstanding > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setInvoice((current) => ({
                      ...current,
                      paymentAmount: outstanding,
                      paymentDraft: true,
                    }))
                    setMessage(null)
                  }}
                >
                  {copy.nextPayment}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => goTo('s42')}
              >
                {copy.backToInvoice}
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ScenarioMetric
          label={copy.net}
          value={
            <Money amount={net} currency={invoice.currency} locale={locale} />
          }
          icon={FileText}
        />
        <ScenarioMetric
          label={copy.vat}
          value={
            <Money amount={vat} currency={invoice.currency} locale={locale} />
          }
          icon={ClipboardCheck}
        />
        <ScenarioMetric
          label={copy.gross}
          value={
            <Money amount={gross} currency={invoice.currency} locale={locale} />
          }
          icon={Wallet}
        />
        <ScenarioMetric
          label={copy.grossBase}
          value={
            <Money
              amount={gross * invoice.invoiceRate}
              currency="PLN"
              locale={locale}
            />
          }
          icon={CircleDollarSign}
        />
      </div>

      {!isInvoice ? (
        <div className="grid gap-4 md:grid-cols-3">
          <ScenarioMetric
            label={copy.paymentBase}
            value={
              <Money amount={paymentBase} currency="PLN" locale={locale} />
            }
            icon={Banknote}
          />
          <ScenarioMetric
            label={copy.outstanding}
            value={
              <Money
                amount={outstanding}
                currency={invoice.currency}
                locale={locale}
              />
            }
            icon={Wallet}
          />
          <ScenarioMetric
            label={invoice.lastPayment > 0 ? copy.fxTotal : copy.fxDifference}
            value={
              <span className="space-y-1">
                <FinanceStatusBadge variant="info">
                  {(invoice.lastPayment > 0 ? invoice.fxRealized : previewFx) >
                  0
                    ? copy.gain
                    : (invoice.lastPayment > 0
                          ? invoice.fxRealized
                          : previewFx) < 0
                      ? copy.loss
                      : copy.noDifference}
                </FinanceStatusBadge>
                <span className="block">
                  <Money
                    amount={Math.abs(
                      invoice.lastPayment > 0 ? invoice.fxRealized : previewFx,
                    )}
                    currency="PLN"
                    locale={locale}
                  />
                </span>
              </span>
            }
            icon={CircleDollarSign}
          />
        </div>
      ) : null}

      {invoice.lastPayment > 0 && showJournal ? (
        <Card>
          <CardHeader>
            <CardTitle>{copy.journalTitle}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {invoice.customer} ·{' '}
              <Money
                amount={invoice.lastPayment}
                currency={invoice.currency}
                locale={locale}
              />
            </p>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {[
              [copy.journalCash, invoice.lastPayment * invoice.lastPaymentRate],
              [
                copy.journalReceivable,
                invoice.lastPayment * invoice.lastInvoiceRate,
              ],
              [
                invoice.lastFx < 0 ? copy.journalFxDebit : copy.journalFxCredit,
                Math.abs(invoice.lastFx),
              ],
            ].map(([label, amount]) => (
              <div
                key={label}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <span>{label}</span>
                <strong>
                  <Money
                    amount={Number(amount)}
                    currency="PLN"
                    locale={locale}
                  />
                </strong>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {isInvoice ? (
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="primary-filled"
            disabled={
              gross <= 0 ||
              invoice.invoiceRate <= 0 ||
              !invoice.customer.trim() ||
              invoice.status !== 'draft'
            }
            onClick={() => {
              setInvoice((current) => ({ ...current, status: 'issued' }))
              setMessage(copy.invoiceIssued)
            }}
          >
            <FileText aria-hidden="true" />
            {copy.issueInvoice}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={invoice.status === 'draft'}
            onClick={() => goTo('s25')}
          >
            {copy.goToSettlement}
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" onClick={() => goTo('s23')}>
            {copy.currencyLink}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function BudgetScenario({
  screenId,
  goTo,
  budget,
  setBudget,
  copy,
  locale,
}: {
  screenId: string
  goTo: (screenId: string) => void
  budget: BudgetState
  setBudget: React.Dispatch<React.SetStateAction<BudgetState>>
  copy: ScenarioCopy
  locale: string
}) {
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [reviewing, setReviewing] = React.useState(false)
  const isEditor = screenId === 's27'
  const activeRequest =
    budget.requestStatus === 'draft' || budget.requestStatus === 'pending'
  const currentUsage = budget.actual + budget.commitments
  const proposedUsage =
    currentUsage + (activeRequest ? budget.requestAmount : 0)
  const utilization =
    budget.limit > 0 ? (proposedUsage / budget.limit) * 100 : 1000
  const decision =
    utilization > 100 ? 'blocked' : utilization >= 90 ? 'warning' : 'approved'
  const available = budget.limit - currentUsage
  const remaining = budget.limit - proposedUsage
  const statusLabel =
    budget.requestStatus === 'draft'
      ? copy.requestDraft
      : budget.requestStatus === 'pending'
        ? copy.requestPending
        : budget.requestStatus === 'overridden'
          ? copy.requestOverridden
          : budget.requestStatus === 'rejected'
            ? copy.requestRejected
            : copy.requestSubmitted

  const changeRequest = (patch: Partial<BudgetState>) => {
    setBudget((current) => ({ ...current, ...patch, requestStatus: 'draft' }))
    setMessage(null)
    setError(null)
  }

  const submit = () => {
    setError(null)
    if (budget.requestStatus !== 'draft') return
    if (
      budget.requestAmount <= 0 ||
      !budget.subject.trim() ||
      !budget.justification.trim()
    ) {
      setError(copy.requestInvalid)
      return
    }
    if (decision === 'blocked') {
      setBudget((current) => ({ ...current, requestStatus: 'pending' }))
      setMessage(copy.requestAwaiting)
      return
    }
    setBudget((current) => ({
      ...current,
      commitments: current.commitments + current.requestAmount,
      requestStatus: 'committed',
    }))
    setMessage(copy.requestCommitted)
  }

  return (
    <div className="space-y-5">
      <ScenarioHeader
        title={isEditor ? copy.budgetTitle : copy.requestTitle}
        description={
          isEditor ? copy.budgetDescription : copy.requestDescription
        }
        status={
          budget.requestStatus === 'pending'
            ? 'warning'
            : budget.requestStatus === 'rejected'
              ? 'error'
              : budget.requestStatus === 'draft'
                ? 'neutral'
                : 'success'
        }
        statusLabel={statusLabel}
        copy={copy}
        onReset={() => {
          setBudget(initialBudget)
          setReviewing(false)
          setMessage(null)
          setError(null)
        }}
      />

      {message ? (
        <Alert status="success" style="stroke" size="sm">
          {message}
        </Alert>
      ) : null}
      {error ? (
        <Alert status="error" style="stroke" size="sm">
          {error}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            {isEditor ? copy.budgetTitle : copy.requestTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isEditor ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <NumericField
                label={copy.budgetLimit}
                value={budget.limit}
                onChange={(limit) =>
                  setBudget((current) => ({
                    ...current,
                    limit,
                    requestStatus:
                      current.requestStatus === 'pending'
                        ? 'draft'
                        : current.requestStatus,
                  }))
                }
              />
              <NumericField
                label={copy.budgetActual}
                value={budget.actual}
                onChange={(actual) =>
                  setBudget((current) => ({
                    ...current,
                    actual,
                    requestStatus:
                      current.requestStatus === 'pending'
                        ? 'draft'
                        : current.requestStatus,
                  }))
                }
              />
              <NumericField
                label={copy.budgetCommitments}
                value={budget.commitments}
                onChange={(commitments) =>
                  setBudget((current) => ({
                    ...current,
                    commitments,
                    requestStatus:
                      current.requestStatus === 'pending'
                        ? 'draft'
                        : current.requestStatus,
                  }))
                }
              />
              <NumericField
                label={copy.requestAmount}
                value={budget.requestAmount}
                onChange={(requestAmount) => changeRequest({ requestAmount })}
                disabled={budget.requestStatus !== 'draft'}
              />
            </div>
          ) : (
            <fieldset
              disabled={budget.requestStatus !== 'draft'}
              className="grid gap-4 md:grid-cols-2"
            >
              <NumericField
                label={copy.requestAmount}
                value={budget.requestAmount}
                onChange={(requestAmount) => changeRequest({ requestAmount })}
                disabled={budget.requestStatus !== 'draft'}
              />
              <FormField label={copy.requestSubject}>
                <Input
                  value={budget.subject}
                  onChange={(event) =>
                    changeRequest({ subject: event.target.value })
                  }
                />
              </FormField>
              <FormField
                label={copy.requestJustification}
                className="md:col-span-2"
              >
                <Textarea
                  value={budget.justification}
                  onChange={(event) =>
                    changeRequest({ justification: event.target.value })
                  }
                />
              </FormField>
            </fieldset>
          )}
          <div className="flex flex-wrap gap-3">
            {isEditor ? (
              <>
                <Button
                  type="button"
                  variant="primary-filled"
                  onClick={() => setMessage(copy.budgetSaved)}
                >
                  <ClipboardCheck aria-hidden="true" />
                  {copy.budgetSave}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => goTo('s28')}
                >
                  {copy.goToRequest}
                  <ArrowRight aria-hidden="true" />
                </Button>
              </>
            ) : (
              <>
                {budget.requestStatus === 'draft' ? (
                  <Button
                    type="button"
                    variant="primary-filled"
                    onClick={submit}
                  >
                    <FileText aria-hidden="true" />
                    {decision === 'blocked'
                      ? copy.requestSubmit
                      : copy.reserveFunds}
                  </Button>
                ) : null}
                {budget.requestStatus === 'pending' ? (
                  <Button
                    type="button"
                    variant="primary-filled"
                    onClick={() => setReviewing(true)}
                  >
                    <ClipboardCheck aria-hidden="true" />
                    {copy.openDecision}
                  </Button>
                ) : null}
                {budget.requestStatus === 'committed' ||
                budget.requestStatus === 'overridden' ||
                budget.requestStatus === 'rejected' ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      changeRequest({
                        requestAmount: initialBudget.requestAmount,
                        decisionReason: '',
                      })
                    }
                  >
                    {copy.requestNext}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => goTo('s27')}
                >
                  {copy.budgetLink}
                  <ArrowRight aria-hidden="true" />
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {!isEditor && reviewing && budget.requestStatus === 'pending' ? (
        <Card>
          <CardHeader>
            <CardTitle>{copy.directorDecision}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {copy.directorContext}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>
              {budget.subject} ·{' '}
              <Money
                amount={budget.requestAmount}
                currency="PLN"
                locale={locale}
              />
            </p>
            <p className="text-sm text-muted-foreground">
              {budget.justification}
            </p>
            <FormField label={copy.decisionReason}>
              <Textarea
                value={budget.decisionReason}
                onChange={(event) =>
                  setBudget((current) => ({
                    ...current,
                    decisionReason: event.target.value,
                  }))
                }
              />
            </FormField>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="primary-filled"
                onClick={() => {
                  setBudget((current) =>
                    current.requestStatus !== 'pending'
                      ? current
                      : {
                          ...current,
                          commitments: roundMoney(
                            current.commitments + current.requestAmount,
                          ),
                          requestStatus: 'overridden',
                        },
                  )
                  setReviewing(false)
                  setMessage(copy.requestOverrideDone)
                }}
              >
                <CheckCircle2 aria-hidden="true" />
                {copy.requestApproval}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (!budget.decisionReason.trim()) {
                    setError(copy.rejectionReasonRequired)
                    return
                  }
                  setBudget((current) => ({
                    ...current,
                    requestStatus: 'rejected',
                  }))
                  setReviewing(false)
                  setError(null)
                  setMessage(copy.requestRejectedDone)
                }}
              >
                <XCircle aria-hidden="true" />
                {copy.rejectRequest}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ScenarioMetric
          label={copy.budgetLimit}
          value={<Money amount={budget.limit} currency="PLN" locale={locale} />}
          icon={Wallet}
        />
        <ScenarioMetric
          label={copy.budgetActual}
          value={
            <Money amount={budget.actual} currency="PLN" locale={locale} />
          }
          icon={CircleDollarSign}
        />
        <ScenarioMetric
          label={copy.budgetCommitments}
          value={
            <Money amount={budget.commitments} currency="PLN" locale={locale} />
          }
          icon={FileText}
        />
        <ScenarioMetric
          label={copy.budgetAvailable}
          value={<Money amount={available} currency="PLN" locale={locale} />}
          icon={Banknote}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{copy.budgetCheck}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <span className="block text-sm text-muted-foreground">
                {copy.budgetProposed}
              </span>
              <strong className="text-xl">
                <Money amount={proposedUsage} currency="PLN" locale={locale} />
              </strong>
            </div>
            <div className="space-y-1">
              <span className="block text-sm text-muted-foreground">
                {copy.budgetUtilization}
              </span>
              <strong className="text-xl tabular-nums">
                {new Intl.NumberFormat(locale, {
                  maximumFractionDigits: 1,
                }).format(utilization)}
                %
              </strong>
            </div>
            <div className="space-y-1">
              <span className="block text-sm text-muted-foreground">
                {copy.requestAfter}
              </span>
              <strong className="text-xl">
                <Money amount={remaining} currency="PLN" locale={locale} />
              </strong>
            </div>
          </div>
          <Progress
            value={Math.min(utilization, 100)}
            max={100}
            tone="accent"
            label={copy.budgetUtilization}
          />
          <div className="flex items-start gap-2 rounded-md border border-border bg-background p-4 text-sm">
            {budget.requestStatus === 'overridden' ||
            budget.requestStatus === 'committed' ? (
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <ClipboardCheck className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              {budget.requestStatus === 'overridden'
                ? copy.requestOverrideDone
                : budget.requestStatus === 'committed'
                  ? copy.requestCommitted
                  : budget.requestStatus === 'rejected'
                    ? copy.requestRejectedDone
                    : decision === 'blocked'
                      ? copy.budgetBlocked
                      : decision === 'warning'
                        ? copy.budgetWarning
                        : copy.budgetApproved}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function BudgetCurrencyScenario({
  screenId,
  goTo,
}: {
  screenId: string
  goTo: (screenId: string) => void
}) {
  const [invoice, setInvoice] = useSessionScenario(
    invoiceStorageKey,
    initialInvoice,
    invoiceSchema,
  )
  const [budget, setBudget] = useSessionScenario(
    budgetStorageKey,
    initialBudget,
    budgetSchema,
  )
  const { copy, locale } = useScenarioCopy()

  if (screenId === 's42' || screenId === 's25') {
    return (
      <InvoiceScenario
        screenId={screenId}
        goTo={goTo}
        invoice={invoice}
        setInvoice={setInvoice}
        copy={copy}
        locale={locale}
      />
    )
  }
  if (screenId === 's27' || screenId === 's28') {
    return (
      <BudgetScenario
        screenId={screenId}
        goTo={goTo}
        budget={budget}
        setBudget={setBudget}
        copy={copy}
        locale={locale}
      />
    )
  }
  return null
}
