'use client'

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  FilePlus2,
  Landmark,
  RotateCcw,
  ShieldAlert,
  Wallet,
} from 'lucide-react'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { FinanceStatusBadge } from './FinanceStatusBadge'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@open-mercato/ui/primitives/card'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Progress } from '@open-mercato/ui/primitives/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import copy from './payables-receivables-copy.json'
import batchCopy from '../data/payment-batch-copy.json'
import {
  PaymentBatchWorkflow,
  paymentBatchSchema,
  type PaymentBatchState,
} from './PaymentBatchWorkflow'

type InvoiceDecision = 'pending' | 'matched'
type VarianceDecision =
  | 'pending'
  | 'waiting'
  | 'approved'
  | 'rejected'
  | 'matched'
type AllocationStatus = 'draft' | 'confirmed'
type ScenarioState = {
  version: 2
  entry: {
    number: string
    supplier: string
    order: string
    bankAccount?: string
    issueDate: string
    dueDate: string
    quantity: string
    unitPrice: string
    vatRate: string
    saved: boolean
  }
  match: { order: string; receipt: string; decision: InvoiceDecision }
  variance: {
    order: string
    receipt: string
    reason: string
    decision: VarianceDecision
  }
  batch: PaymentBatchState
  allocation: {
    amounts: [string, string]
    status: AllocationStatus
    postedAmounts?: [string, string]
  }
}

const storageKey = 'open-mercato-finance-preview-accountant-scenarios-v2'
const initialState: ScenarioState = {
  version: 2,
  entry: {
    number: 'FZ/09/2026/088',
    supplier: 'TechNova sp. z o.o.',
    order: 'PO-2026-1094',
    bankAccount: 'PL61 1090 1014 0000 0712 1981 2874',
    issueDate: '2026-09-25',
    dueDate: '2026-10-14',
    quantity: '10',
    unitPrice: '1000',
    vatRate: '23',
    saved: false,
  },
  match: { order: '', receipt: '', decision: 'pending' },
  variance: {
    order: 'other',
    receipt: 'correct',
    reason: '',
    decision: 'pending',
  },
  batch: { selected: [], accountsVerified: false, status: 'draft' },
  allocation: { amounts: ['3000', '0'], status: 'draft' },
}

function persistScenario(state: ScenarioState) {
  const { entry } = state
  const storedEntry: ScenarioState['entry'] = {
    number: entry.number,
    supplier: entry.supplier,
    order: entry.order,
    issueDate: entry.issueDate,
    dueDate: entry.dueDate,
    quantity: entry.quantity,
    unitPrice: entry.unitPrice,
    vatRate: entry.vatRate,
    saved: entry.saved,
  }
  try {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({ ...state, entry: storedEntry }),
    )
  } catch {
    return
  }
}

function isScenarioState(value: unknown): value is ScenarioState {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  const entry = data.entry as Record<string, unknown> | undefined
  const match = data.match as Record<string, unknown> | undefined
  const variance = data.variance as Record<string, unknown> | undefined
  const batch = data.batch as Record<string, unknown> | undefined
  const allocation = data.allocation as Record<string, unknown> | undefined
  return (
    data.version === 2 &&
    typeof entry?.number === 'string' &&
    typeof entry.supplier === 'string' &&
    typeof entry.order === 'string' &&
    (entry.bankAccount === undefined ||
      typeof entry.bankAccount === 'string') &&
    typeof entry.issueDate === 'string' &&
    typeof entry.dueDate === 'string' &&
    typeof entry.quantity === 'string' &&
    typeof entry.unitPrice === 'string' &&
    typeof entry.vatRate === 'string' &&
    typeof entry.saved === 'boolean' &&
    typeof match?.order === 'string' &&
    typeof match.receipt === 'string' &&
    ['pending', 'matched'].includes(String(match.decision)) &&
    typeof variance?.order === 'string' &&
    typeof variance.receipt === 'string' &&
    typeof variance.reason === 'string' &&
    ['pending', 'waiting', 'approved', 'rejected', 'matched'].includes(
      String(variance.decision),
    ) &&
    paymentBatchSchema.safeParse(batch).success &&
    Array.isArray(allocation?.amounts) &&
    allocation.amounts.length === 2 &&
    allocation.amounts.every((item: unknown) => typeof item === 'string') &&
    ['draft', 'confirmed'].includes(String(allocation.status)) &&
    (allocation.postedAmounts === undefined ||
      (Array.isArray(allocation.postedAmounts) &&
        allocation.postedAmounts.length === 2 &&
        allocation.postedAmounts.every(
          (item: unknown) => typeof item === 'string',
        )))
  )
}

function useScenarioState() {
  const [state, updateState] = React.useState<ScenarioState>(initialState)
  const stateRef = React.useRef(state)
  const setState = React.useCallback<
    React.Dispatch<React.SetStateAction<ScenarioState>>
  >((action) => {
    const nextState =
      typeof action === 'function' ? action(stateRef.current) : action
    stateRef.current = nextState
    persistScenario(nextState)
    updateState(nextState)
  }, [])
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey)
      if (saved) {
        const parsed: unknown = JSON.parse(saved)
        if (isScenarioState(parsed)) {
          stateRef.current = parsed
          updateState(parsed)
        }
      }
    } catch {
      updateState(initialState)
    }
    setReady(true)
  }, [])

  return [state, setState, ready] as const
}

function formatAmount(amount: number, currency: 'PLN' | 'EUR') {
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(
    amount,
  )
}

function parseAmount(value: string) {
  const normalized = value.replace(/\s/g, '').replace(',', '.')
  if (!normalized || !/^\d+(\.\d{0,2})?$/.test(normalized)) return Number.NaN
  return Number(normalized)
}

function postedAllocation(state: ScenarioState): [number, number] {
  const amounts =
    state.allocation.postedAmounts ??
    (state.allocation.status === 'confirmed'
      ? state.allocation.amounts
      : ['0', '0'])
  return [parseAmount(amounts[0]), parseAmount(amounts[1])]
}

function reviewedInvoiceBatch(state: ScenarioState): ScenarioState {
  const invoiceId = state.entry.saved
    ? state.entry.number
    : copy.match.invoiceId
  if (state.batch.status === 'sent' && state.batch.selected.includes(invoiceId))
    return state
  return {
    ...state,
    batch: {
      ...state.batch,
      selected: [...new Set([...state.batch.selected, invoiceId])],
      accountsVerified: false,
      status: 'draft',
    },
  }
}

function ScenarioHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-accent-indigo/10 text-accent-indigo">
          {icon}
        </span>
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      </div>
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  )
}

function DocumentSelector({
  label,
  value,
  onChange,
  correct,
  alternate,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  correct: string
  alternate: string
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder={copy.common.select} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="correct">{correct}</SelectItem>
          <SelectItem value="other">{alternate}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function Fact({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className="min-w-0 space-y-1 rounded-lg border border-border bg-background p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          emphasis
            ? 'text-lg font-semibold tabular-nums text-accent-indigo'
            : 'text-sm font-semibold tabular-nums text-foreground'
        }
      >
        {value}
      </div>
    </div>
  )
}

function InvoiceEntryScenario({
  state,
  setState,
  goTo,
}: {
  state: ScenarioState
  setState: React.Dispatch<React.SetStateAction<ScenarioState>>
  goTo: (id: string) => void
}) {
  const [showError, setShowError] = React.useState(false)
  const quantity = parseAmount(state.entry.quantity)
  const unitPrice = parseAmount(state.entry.unitPrice)
  const vatRate = Number(state.entry.vatRate)
  const net = quantity * unitPrice
  const vat = (net * vatRate) / 100
  const gross = net + vat
  const bankAccount =
    state.entry.bankAccount ?? initialState.entry.bankAccount ?? ''
  const bankAccountValid = /^PL\d{26}$/.test(
    bankAccount.replace(/\s/g, '').toUpperCase(),
  )
  const valid = Boolean(
    state.entry.number.trim() &&
    state.entry.supplier.trim() &&
    ['PO-2026-1094', 'PO-2026-1081'].includes(state.entry.order.trim()) &&
    bankAccountValid &&
    state.entry.issueDate &&
    state.entry.dueDate &&
    state.entry.dueDate >= state.entry.issueDate &&
    Number.isFinite(quantity) &&
    quantity > 0 &&
    Number.isFinite(unitPrice) &&
    unitPrice > 0 &&
    Number.isFinite(vatRate) &&
    vatRate >= 0,
  )
  const update = (
    key: keyof Omit<ScenarioState['entry'], 'saved'>,
    value: string,
  ) => {
    setShowError(false)
    setState((current) => ({
      ...current,
      entry: { ...current.entry, [key]: value, saved: false },
      match: { ...current.match, decision: 'pending' },
      variance: { ...current.variance, decision: 'pending' },
      batch: { ...initialState.batch },
    }))
  }
  const save = () => {
    if (!valid) {
      setShowError(true)
      return
    }
    const updated: ScenarioState = {
      ...state,
      entry: { ...state.entry, bankAccount: bankAccount.trim(), saved: true },
      batch: { ...initialState.batch },
      match: {
        order:
          state.entry.order.trim() === 'PO-2026-1094' ? 'correct' : 'other',
        receipt: '',
        decision: 'pending',
      },
      variance: {
        order:
          state.entry.order.trim() === 'PO-2026-1094' ? 'correct' : 'other',
        receipt: '',
        reason: '',
        decision: 'pending',
      },
    }
    setState(updated)
    persistScenario(updated)
    goTo('s8')
  }

  return (
    <div className="space-y-6">
      <ScenarioHeader
        icon={<FilePlus2 className="size-5" />}
        title={copy.entry.title}
        description={copy.entry.description}
      />
      <Card>
        <CardHeader>
          <CardTitle>{copy.entry.documentTitle}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          {(
            [
              ['number', copy.entry.number, 'text'],
              ['supplier', copy.entry.supplier, 'text'],
              ['order', copy.entry.order, 'text'],
              ['bankAccount', copy.entry.bankAccount, 'text'],
              ['issueDate', copy.entry.issueDate, 'date'],
              ['dueDate', copy.entry.dueDate, 'date'],
            ] as const
          ).map(([key, label, type]) => (
            <div key={key} className="space-y-2">
              <label
                htmlFor={`invoice-entry-${key}`}
                className="text-sm font-medium text-foreground"
              >
                {label}
              </label>
              {key === 'order' ? (
                <Select
                  value={state.entry.order}
                  onValueChange={(value) => update(key, value)}
                >
                  <SelectTrigger id={`invoice-entry-${key}`} aria-label={label}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PO-2026-1094">
                      {copy.common.correctOrder}
                    </SelectItem>
                    <SelectItem value="PO-2026-1081">
                      {copy.common.incorrectOrder}
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`invoice-entry-${key}`}
                  type={type}
                  value={state.entry[key] ?? ''}
                  onChange={(event) => update(key, event.target.value)}
                />
              )}
              {key === 'order' ? (
                <p className="text-xs text-muted-foreground">
                  {copy.entry.orderHint}
                </p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{copy.entry.lineTitle}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-3">
          <div className="space-y-2">
            <label
              htmlFor="invoice-entry-quantity"
              className="text-sm font-medium text-foreground"
            >
              {copy.entry.quantity}
            </label>
            <Input
              id="invoice-entry-quantity"
              type="text"
              inputMode="decimal"
              value={state.entry.quantity}
              onChange={(event) => update('quantity', event.target.value)}
              aria-invalid={!Number.isFinite(quantity) || quantity <= 0}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="invoice-entry-unit-price"
              className="text-sm font-medium text-foreground"
            >
              {copy.entry.unitPrice}
            </label>
            <Input
              id="invoice-entry-unit-price"
              type="text"
              inputMode="decimal"
              value={state.entry.unitPrice}
              onChange={(event) => update('unitPrice', event.target.value)}
              aria-invalid={!Number.isFinite(unitPrice) || unitPrice <= 0}
            />
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">
              {copy.entry.vatRate}
            </span>
            <Select
              value={state.entry.vatRate}
              onValueChange={(value) => update('vatRate', value)}
            >
              <SelectTrigger aria-label={copy.entry.vatRate}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="23">23%</SelectItem>
                <SelectItem value="8">8%</SelectItem>
                <SelectItem value="5">5%</SelectItem>
                <SelectItem value="0">0%</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{copy.entry.summaryTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Fact
              label={copy.entry.net}
              value={
                Number.isFinite(net)
                  ? formatAmount(net, 'PLN')
                  : copy.common.none
              }
            />
            <Fact
              label={copy.entry.vat}
              value={
                Number.isFinite(vat)
                  ? formatAmount(vat, 'PLN')
                  : copy.common.none
              }
            />
            <Fact
              label={copy.entry.gross}
              value={
                Number.isFinite(gross)
                  ? formatAmount(gross, 'PLN')
                  : copy.common.none
              }
              emphasis
            />
          </div>
          {showError ? (
            <p role="alert" className="text-sm text-status-error-text">
              {copy.entry.invalid}
            </p>
          ) : null}
          {state.entry.saved ? (
            <Alert
              status="feature"
              style="stroke"
              size="sm"
              icon={<CheckCircle2 />}
            >
              {copy.entry.draft}
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">
              {copy.entry.unsaved}
            </p>
          )}
          <div className="flex flex-wrap gap-3 border-t border-border pt-4">
            <Button type="button" variant="primary-filled" onClick={save}>
              {copy.entry.save}
              <ArrowRight className="ml-2 size-4" />
            </Button>
            {state.entry.saved ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => goTo('s8')}
              >
                {copy.entry.review}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function MatchScenario({
  state,
  setState,
  goTo,
}: {
  state: ScenarioState
  setState: React.Dispatch<React.SetStateAction<ScenarioState>>
  goTo: (id: string) => void
}) {
  const invoiceTotal = state.entry.saved
    ? parseAmount(state.entry.quantity) *
      parseAmount(state.entry.unitPrice) *
      (1 + Number(state.entry.vatRate) / 100)
    : 12300
  const invoiceAmount = formatAmount(invoiceTotal, 'PLN')
  const orderAmount = state.match.order === 'correct' ? 12300 : 11300
  const monetaryDifference = invoiceTotal - orderAmount
  const selected = Boolean(state.match.order && state.match.receipt)
  const matched =
    selected &&
    Math.abs(monetaryDifference) < 0.005 &&
    state.match.receipt === 'correct' &&
    (!state.entry.saved || parseAmount(state.entry.quantity) === 10)
  const update = (key: 'order' | 'receipt', value: string) =>
    setState((current) => ({
      ...current,
      match: { ...current.match, [key]: value, decision: 'pending' },
      variance: { ...current.variance, decision: 'pending' },
      batch: { ...initialState.batch },
    }))

  return (
    <div className="space-y-6">
      <ScenarioHeader
        icon={<FileCheck2 className="size-5" />}
        title={copy.match.title}
        description={copy.match.description}
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Fact
          label={copy.common.invoice}
          value={state.entry.saved ? state.entry.number : copy.match.invoiceId}
        />
        <Fact
          label={copy.entry.supplier}
          value={state.entry.saved ? state.entry.supplier : copy.match.supplier}
        />
        <Fact label={copy.common.amount} value={invoiceAmount} emphasis />
        <Fact
          label={copy.match.quantityLabel}
          value={
            state.entry.saved
              ? `${state.entry.quantity} ${copy.entry.quantityUnit}`
              : copy.match.quantity
          }
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{copy.common.source}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <DocumentSelector
            label={copy.common.order}
            value={state.match.order}
            onChange={(value) => update('order', value)}
            correct={copy.common.correctOrder}
            alternate={copy.common.incorrectOrder}
          />
          <DocumentSelector
            label={copy.common.receipt}
            value={state.match.receipt}
            onChange={(value) => update('receipt', value)}
            correct={copy.common.correctReceipt}
            alternate={copy.common.incorrectReceipt}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{copy.common.matchTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Fact label={copy.common.invoice} value={invoiceAmount} />
            <Fact
              label={copy.common.order}
              value={
                selected ? formatAmount(orderAmount, 'PLN') : copy.common.none
              }
            />
            <Fact
              label={copy.common.difference}
              value={
                selected
                  ? formatAmount(monetaryDifference, 'PLN')
                  : copy.common.none
              }
              emphasis
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FinanceStatusBadge
              variant={!selected ? 'neutral' : matched ? 'success' : 'warning'}
            >
              {!selected
                ? copy.common.none
                : matched
                  ? copy.common.matched
                  : copy.common.unmatched}
            </FinanceStatusBadge>
            <span className="text-sm text-muted-foreground">
              {!selected
                ? copy.common.requiredDocuments
                : matched
                  ? copy.match.zeroVariance
                  : copy.match.variance}
            </span>
          </div>
          {state.match.decision === 'matched' ? (
            <Alert
              status="feature"
              style="stroke"
              size="sm"
              icon={<CheckCircle2 />}
            >
              {copy.match.confirmed}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="primary-filled"
              disabled={
                !selected || !matched || state.match.decision === 'matched'
              }
              onClick={() =>
                setState((current) => ({
                  ...current,
                  match: { ...current.match, decision: 'matched' },
                }))
              }
            >
              <CheckCircle2 className="mr-2 size-4" />
              {copy.match.confirm}
            </Button>
            {selected && !matched ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const updated: ScenarioState = {
                    ...state,
                    variance: {
                      order: state.match.order,
                      receipt: state.match.receipt,
                      reason: '',
                      decision: 'pending',
                    },
                  }
                  setState(updated)
                  persistScenario(updated)
                  goTo('s9')
                }}
              >
                {copy.match.escalate}
                <ArrowRight className="ml-2 size-4" />
              </Button>
            ) : null}
            {state.match.decision === 'matched' ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setState(reviewedInvoiceBatch(state))
                  goTo('s10')
                }}
              >
                {copy.match.toBatch}
                <ArrowRight className="ml-2 size-4" />
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function VarianceScenario({
  state,
  setState,
  goTo,
}: {
  state: ScenarioState
  setState: React.Dispatch<React.SetStateAction<ScenarioState>>
  goTo: (id: string) => void
}) {
  const decision = state.variance.decision
  const invoiceTotal = state.entry.saved
    ? parseAmount(state.entry.quantity) *
      parseAmount(state.entry.unitPrice) *
      (1 + Number(state.entry.vatRate) / 100)
    : 12300
  const orderTotal = state.variance.order === 'correct' ? 12300 : 11300
  const difference = invoiceTotal - orderTotal
  const selected = Boolean(state.variance.order && state.variance.receipt)
  const receiptAligned =
    state.variance.receipt === 'correct' &&
    (!state.entry.saved || parseAmount(state.entry.quantity) === 10)
  const documentsAligned =
    selected && Math.abs(difference) < 0.005 && receiptAligned
  const withinTolerance =
    selected &&
    receiptAligned &&
    !documentsAligned &&
    Math.abs(difference) <= 565
  const [error, setError] = React.useState('')
  const update = (key: 'order' | 'receipt', value: string) =>
    setState((current) => ({
      ...current,
      variance: { ...current.variance, [key]: value, decision: 'pending' },
      match: { ...current.match, decision: 'pending' },
      batch: { ...initialState.batch },
    }))
  const submit = () => {
    if (!selected) {
      setError(copy.common.requiredDocuments)
      return
    }
    if (!state.variance.reason.trim()) {
      setError(copy.variance.reasonRequired)
      return
    }
    setError('')
    setState((current) => ({
      ...current,
      variance: { ...current.variance, decision: 'waiting' },
    }))
  }

  return (
    <div className="space-y-6">
      <ScenarioHeader
        icon={<ShieldAlert className="size-5" />}
        title={copy.variance.title}
        description={copy.variance.description}
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Fact
          label={copy.common.invoice}
          value={state.entry.saved ? state.entry.number : copy.match.invoiceId}
        />
        <Fact
          label={copy.common.amount}
          value={formatAmount(invoiceTotal, 'PLN')}
        />
        <Fact
          label={copy.common.order}
          value={selected ? formatAmount(orderTotal, 'PLN') : copy.common.none}
        />
        <Fact
          label={copy.common.difference}
          value={selected ? formatAmount(difference, 'PLN') : copy.common.none}
          emphasis
        />
      </div>
      <Alert status="feature" style="stroke" size="sm" icon={<ShieldAlert />}>
        {!selected
          ? copy.common.requiredDocuments
          : documentsAligned
            ? copy.variance.documentsAligned
            : withinTolerance
              ? copy.variance.withinTolerance
              : !receiptAligned
                ? copy.variance.receiptMismatch
                : copy.variance.tolerance}
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>{copy.common.source}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <DocumentSelector
            label={copy.common.order}
            value={state.variance.order}
            onChange={(value) => update('order', value)}
            correct={copy.common.correctOrder}
            alternate={copy.common.incorrectOrder}
          />
          <DocumentSelector
            label={copy.common.receipt}
            value={state.variance.receipt}
            onChange={(value) => update('receipt', value)}
            correct={copy.common.correctReceipt}
            alternate={copy.common.incorrectReceipt}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 p-5">
          {!documentsAligned && !withinTolerance ? (
            <div className="space-y-2">
              <label
                htmlFor="finance-variance-reason"
                className="text-sm font-medium text-foreground"
              >
                {copy.variance.reason}
              </label>
              <Textarea
                id="finance-variance-reason"
                value={state.variance.reason}
                onChange={(event) => {
                  setError('')
                  setState((current) => ({
                    ...current,
                    variance: {
                      ...current.variance,
                      reason: event.target.value,
                      decision: 'pending',
                    },
                  }))
                }}
                placeholder={copy.variance.reasonHint}
                disabled={decision === 'waiting' || decision === 'approved'}
                aria-invalid={Boolean(error)}
              />
              {error ? (
                <p role="alert" className="text-sm text-status-error-text">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
          {decision === 'pending' && documentsAligned ? (
            <Button
              type="button"
              variant="primary-filled"
              onClick={() =>
                setState((current) => ({
                  ...current,
                  variance: { ...current.variance, decision: 'matched' },
                }))
              }
            >
              {copy.variance.confirmMatch}
              <CheckCircle2 className="ml-2 size-4" />
            </Button>
          ) : null}
          {decision === 'pending' && withinTolerance ? (
            <Button
              type="button"
              variant="primary-filled"
              onClick={() =>
                setState((current) => ({
                  ...current,
                  variance: { ...current.variance, decision: 'matched' },
                }))
              }
            >
              {copy.variance.acceptTolerance}
              <CheckCircle2 className="ml-2 size-4" />
            </Button>
          ) : null}
          {decision === 'pending' && !documentsAligned && !withinTolerance ? (
            <Button type="button" variant="primary-filled" onClick={submit}>
              {copy.variance.send}
              <ArrowRight className="ml-2 size-4" />
            </Button>
          ) : null}
          {decision === 'waiting' && !documentsAligned ? (
            <div className="space-y-4 border-t border-border pt-4">
              <FinanceStatusBadge variant="warning">
                {copy.variance.waiting}
              </FinanceStatusBadge>
              <div>
                <h3 className="font-semibold text-foreground">
                  {copy.variance.managerTitle}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {copy.variance.managerDescription}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="primary-filled"
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      variance: { ...current.variance, decision: 'approved' },
                    }))
                  }
                >
                  {copy.variance.approve}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      variance: { ...current.variance, decision: 'rejected' },
                    }))
                  }
                >
                  {copy.variance.reject}
                </Button>
              </div>
            </div>
          ) : null}
          {decision === 'approved' ? (
            <div className="space-y-3">
              <FinanceStatusBadge variant="success">
                {copy.variance.approvedLabel}
              </FinanceStatusBadge>
              <p className="text-sm text-muted-foreground">
                {copy.variance.approved}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setState(reviewedInvoiceBatch(state))
                  goTo('s10')
                }}
              >
                {copy.variance.toBatch}
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </div>
          ) : null}
          {decision === 'matched' ? (
            <div className="space-y-3">
              <FinanceStatusBadge variant="success">
                {copy.common.matched}
              </FinanceStatusBadge>
              <p className="text-sm text-muted-foreground">
                {copy.variance.matched}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setState(reviewedInvoiceBatch(state))
                  goTo('s10')
                }}
              >
                {copy.variance.toBatch}
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </div>
          ) : null}
          {decision === 'rejected' ? (
            <div className="space-y-3">
              <FinanceStatusBadge variant="error">
                {copy.common.unmatched}
              </FinanceStatusBadge>
              <p className="text-sm text-muted-foreground">
                {copy.variance.rejected}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => goTo('s43')}
              >
                {copy.variance.correctInvoice}
                <ArrowRight className="ml-2 size-4" />
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

const batchInvoices = [
  {
    id: copy.batch.firstId,
    supplier: copy.batch.firstSupplier,
    amount: 18900,
    account: copy.batch.firstAccount,
  },
  {
    id: copy.batch.secondId,
    supplier: copy.batch.secondSupplier,
    amount: 2460,
    account: copy.batch.secondAccount,
  },
]

function BatchScenario({
  state,
  setState,
  goTo,
}: {
  state: ScenarioState
  setState: React.Dispatch<React.SetStateAction<ScenarioState>>
  goTo: (id: string) => void
}) {
  const reviewed =
    state.variance.decision !== 'rejected' &&
    state.variance.decision !== 'waiting' &&
    (state.match.decision === 'matched' ||
      state.variance.decision === 'approved' ||
      state.variance.decision === 'matched')
  const reviewedInvoice = reviewed
    ? {
        id: state.entry.saved ? state.entry.number : copy.match.invoiceId,
        supplier: state.entry.saved
          ? state.entry.supplier
          : copy.match.supplier,
        amount: state.entry.saved
          ? Math.round(
              parseAmount(state.entry.quantity) *
                parseAmount(state.entry.unitPrice) *
                (1 + Number(state.entry.vatRate) / 100) *
                100,
            ) / 100
          : 12300,
        account:
          state.entry.bankAccount ?? initialState.entry.bankAccount ?? '',
        net: state.entry.saved
          ? Math.round(
              parseAmount(state.entry.quantity) *
                parseAmount(state.entry.unitPrice) *
                100,
            ) / 100
          : 10000,
        vat: state.entry.saved
          ? Math.round(
              parseAmount(state.entry.quantity) *
                parseAmount(state.entry.unitPrice) *
                Number(state.entry.vatRate),
            ) / 100
          : 2300,
      }
    : null
  return (
    <PaymentBatchWorkflow
      state={state.batch}
      reviewedInvoice={reviewedInvoice}
      invoices={batchInvoices}
      goTo={goTo}
      onChange={(batch) => setState((current) => ({ ...current, batch }))}
    />
  )
}

const allocationInvoices = [
  { id: copy.allocation.firstId, due: copy.allocation.firstDue, open: 6400 },
  { id: copy.allocation.secondId, due: copy.allocation.secondDue, open: 1250 },
]

function AllocationScenario({
  state,
  setState,
  goTo,
}: {
  state: ScenarioState
  setState: React.Dispatch<React.SetStateAction<ScenarioState>>
  goTo: (id: string) => void
}) {
  const values = state.allocation.amounts.map(parseAmount)
  const validNumbers = values.every(
    (value) => Number.isFinite(value) && value >= 0,
  )
  const assigned = validNumbers
    ? values.reduce((sum, value) => sum + value, 0)
    : Number.NaN
  const remainder = 3000 - assigned
  const tooHigh =
    validNumbers &&
    values.some((value, index) => value > allocationInvoices[index].open)
  const error = !validNumbers
    ? copy.allocation.negative
    : tooHigh
      ? copy.allocation.tooHigh
      : remainder < -0.001
        ? copy.allocation.overpaid
        : remainder > 0.001
          ? copy.allocation.unassignedError
          : ''
  const confirmed = state.allocation.status === 'confirmed'
  const update = (index: number, value: string) =>
    setState((current) => {
      const amounts: [string, string] = [...current.allocation.amounts]
      amounts[index] = value
      return {
        ...current,
        allocation: { ...current.allocation, amounts, status: 'draft' },
      }
    })

  return (
    <div className="space-y-6">
      <ScenarioHeader
        icon={<Wallet className="size-5" />}
        title={copy.allocation.title}
        description={copy.allocation.description}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Fact
          label={copy.allocation.received}
          value={formatAmount(3000, 'EUR')}
        />
        <Fact
          label={copy.allocation.assigned}
          value={
            Number.isFinite(assigned)
              ? formatAmount(assigned, 'EUR')
              : copy.common.none
          }
          emphasis
        />
        <Fact
          label={copy.allocation.unassigned}
          value={
            Number.isFinite(remainder)
              ? formatAmount(Math.max(0, remainder), 'EUR')
              : copy.common.none
          }
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{copy.allocation.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {allocationInvoices.map((invoice, index) => (
            <div
              key={invoice.id}
              className="grid gap-4 border-t border-border py-5 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-3 md:items-center"
            >
              <div className="space-y-1">
                <div className="font-semibold text-foreground">
                  {invoice.id}
                </div>
                <div className="text-sm text-muted-foreground">
                  {invoice.due}
                </div>
                <div className="text-xs text-muted-foreground">
                  {copy.allocation.openAmount}:{' '}
                  {formatAmount(invoice.open, 'EUR')}
                </div>
              </div>
              <div className="space-y-2">
                <label
                  htmlFor={`allocation-${index}`}
                  className="text-sm font-medium text-foreground"
                >
                  {copy.allocation.allocate}
                </label>
                <Input
                  id={`allocation-${index}`}
                  type="text"
                  inputMode="decimal"
                  value={state.allocation.amounts[index]}
                  disabled={confirmed}
                  onChange={(event) => update(index, event.target.value)}
                  aria-invalid={
                    !Number.isFinite(values[index]) ||
                    values[index] > invoice.open
                  }
                />
              </div>
              <Fact
                label={copy.allocation.after}
                value={
                  Number.isFinite(values[index])
                    ? formatAmount(invoice.open - values[index], 'EUR')
                    : copy.common.none
                }
                emphasis
              />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4 p-5">
          {confirmed ? (
            <Alert
              status="feature"
              style="stroke"
              size="sm"
              icon={<CheckCircle2 />}
            >
              {copy.allocation.confirmed}
            </Alert>
          ) : error ? (
            <p role="alert" className="text-sm text-status-error-text">
              {error}
            </p>
          ) : (
            <FinanceStatusBadge variant="success">
              {copy.common.matched}
            </FinanceStatusBadge>
          )}
          <div className="flex flex-wrap gap-3">
            {confirmed ? (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setState((current) => ({
                    ...current,
                    allocation: {
                      ...current.allocation,
                      postedAmounts: current.allocation.postedAmounts ?? [
                        ...current.allocation.amounts,
                      ],
                      status: 'draft',
                    },
                  }))
                }
              >
                {copy.allocation.edit}
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary-filled"
                disabled={Boolean(error)}
                onClick={() =>
                  setState((current) => ({
                    ...current,
                    allocation: {
                      ...current.allocation,
                      status: 'confirmed',
                      postedAmounts: [...current.allocation.amounts],
                    },
                  }))
                }
              >
                {copy.allocation.confirm}
                <CheckCircle2 className="ml-2 size-4" />
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => goTo('s12')}>
              {copy.allocation.toInvoice}
              <ArrowRight className="ml-2 size-4" />
            </Button>
            <Button type="button" variant="ghost" onClick={() => goTo('s14')}>
              {copy.allocation.toMonitoring}
              <ArrowRight className="ml-2 size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ReceivableDetailScenario({
  state,
  goTo,
}: {
  state: ScenarioState
  goTo: (id: string) => void
}) {
  const confirmed = state.allocation.status === 'confirmed'
  const newlyAllocated = postedAllocation(state)[0]
  const totalPaid = 3000 + newlyAllocated
  const remaining = 9400 - totalPaid

  return (
    <div className="space-y-6">
      <ScenarioHeader
        icon={<FileCheck2 className="size-5" />}
        title={copy.receivable.detailTitle}
        description={copy.receivable.detailDescription}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Fact
          label={copy.receivable.invoiceValue}
          value={formatAmount(9400, 'EUR')}
        />
        <Fact
          label={copy.receivable.totalPaid}
          value={formatAmount(totalPaid, 'EUR')}
        />
        <Fact
          label={copy.receivable.remaining}
          value={formatAmount(remaining, 'EUR')}
          emphasis
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{copy.receivable.progress}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Progress
            value={(totalPaid / 9400) * 100}
            tone="accent"
            label={copy.receivable.progress}
            showValue
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Fact
              label={copy.receivable.previousPaid}
              value={formatAmount(3000, 'EUR')}
            />
            <Fact
              label={copy.receivable.newPaid}
              value={formatAmount(newlyAllocated, 'EUR')}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FinanceStatusBadge variant="info">
              {copy.receivable.partiallyPaid}
            </FinanceStatusBadge>
            <p className="text-sm text-muted-foreground">
              {confirmed
                ? copy.receivable.allocationConfirmed
                : copy.receivable.allocationDraft}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="primary-filled"
              onClick={() => goTo('s13')}
            >
              {copy.receivable.goAllocate}
              <ArrowRight className="ml-2 size-4" />
            </Button>
            <Button type="button" variant="outline" onClick={() => goTo('s14')}>
              {copy.receivable.goMonitoring}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

type MonitoringRow = {
  id: string
  customer: string
  due: string
  balance: number
  currency: 'EUR' | 'PLN'
  target: string
}

function ReceivableMonitoringScenario({
  state,
  goTo,
}: {
  state: ScenarioState
  goTo: (id: string) => void
}) {
  const [firstAllocation, secondAllocation] = postedAllocation(state)
  const rows: MonitoringRow[] = [
    {
      id: copy.allocation.firstId,
      customer: copy.receivable.customerName,
      due: copy.allocation.firstDue,
      balance: 6400 - firstAllocation,
      currency: 'EUR',
      target: 's12',
    },
    {
      id: copy.allocation.secondId,
      customer: copy.receivable.customerName,
      due: copy.allocation.secondDue,
      balance: 1250 - secondAllocation,
      currency: 'EUR',
      target: 's13',
    },
    {
      id: copy.receivable.otherCustomer1Invoice,
      customer: copy.receivable.otherCustomer1,
      due: copy.receivable.otherCustomer1Due,
      balance: 10800,
      currency: 'PLN',
      target: 's11',
    },
    {
      id: copy.receivable.otherCustomer2Invoice,
      customer: copy.receivable.otherCustomer2,
      due: copy.receivable.otherCustomer2Due,
      balance: 4600,
      currency: 'PLN',
      target: 's11',
    },
  ]
  const columns = React.useMemo<ColumnDef<MonitoringRow, unknown>[]>(
    () => [
      {
        id: 'customer',
        header: copy.receivable.customer,
        accessorFn: (row) => row.customer,
        cell: ({ row }) => (
          <span className="font-medium text-foreground">
            {row.original.customer}
          </span>
        ),
      },
      {
        id: 'invoice',
        header: copy.receivable.invoice,
        accessorFn: (row) => row.id,
        cell: ({ row }) => (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-0"
            onClick={() => goTo(row.original.target)}
          >
            {row.original.id}
          </Button>
        ),
      },
      {
        id: 'due',
        header: copy.receivable.due,
        accessorFn: (row) => row.due,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.due}</span>
        ),
      },
      {
        id: 'balance',
        header: copy.receivable.balance,
        accessorFn: (row) => row.balance,
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums text-foreground">
            {formatAmount(row.original.balance, row.original.currency)}
          </span>
        ),
      },
      {
        id: 'next',
        header: copy.receivable.nextStep,
        accessorFn: (row) => row.balance,
        cell: ({ row }) =>
          row.original.balance <= 0 ? (
            <FinanceStatusBadge variant="success">
              {copy.receivable.allocated}
            </FinanceStatusBadge>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                goTo(row.original.target === 's11' ? 's11' : 's13')
              }
            >
              {row.original.target === 's11'
                ? copy.receivable.allReceivables
                : copy.receivable.reviewAllocation}
            </Button>
          ),
      },
    ],
    [goTo],
  )
  const totalOutstanding = rows
    .filter((row) => row.currency === 'EUR')
    .reduce((sum, row) => sum + row.balance, 0)

  return (
    <div className="space-y-6">
      <ScenarioHeader
        icon={<Wallet className="size-5" />}
        title={copy.receivable.monitoringTitle}
        description={copy.receivable.monitoringDescription}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Fact label={copy.receivable.customer} value={rows[0].customer} />
        <Fact
          label={copy.receivable.customerBalance}
          value={formatAmount(totalOutstanding, 'EUR')}
          emphasis
        />
        <Fact
          label={copy.receivable.newPaid}
          value={formatAmount(firstAllocation + secondAllocation, 'EUR')}
        />
      </div>
      <DataTable
        emptyState={copy.common.noRows}
        title={copy.receivable.monitoringTitle}
        columns={columns}
        data={rows}
        embedded
      />
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="primary-filled"
          onClick={() => goTo('s13')}
        >
          {copy.receivable.goAllocate}
          <ArrowRight className="ml-2 size-4" />
        </Button>
        <Button type="button" variant="outline" onClick={() => goTo('s11')}>
          {copy.receivable.allReceivables}
        </Button>
      </div>
    </div>
  )
}

export function PayablesReceivablesScenario({
  screenId,
  goTo,
}: {
  screenId: string
  goTo: (id: string) => void
}) {
  const [state, setState, ready] = useScenarioState()
  if (!ready) return null
  const invoiceId = state.entry.saved
    ? state.entry.number
    : copy.match.invoiceId
  const lockedInvoice =
    state.batch.status === 'sent' ||
    state.batch.postedInvoiceIds?.includes(invoiceId) === true

  return (
    <div className="space-y-6">
      {lockedInvoice && ['s43', 's8', 's9'].includes(screenId) ? (
        <Card>
          <CardHeader>
            <CardTitle>{batchCopy.immutableTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {batchCopy.immutableHint}
            </p>
            <p className="font-medium">{state.batch.selected.join(', ')}</p>
            <Button type="button" variant="outline" onClick={() => goTo('s10')}>
              {batchCopy.openBatch}
              <ArrowRight className="size-4" />
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {screenId === 's43' && !lockedInvoice ? (
        <InvoiceEntryScenario state={state} setState={setState} goTo={goTo} />
      ) : null}
      {screenId === 's8' && !lockedInvoice ? (
        <MatchScenario state={state} setState={setState} goTo={goTo} />
      ) : null}
      {screenId === 's9' && !lockedInvoice ? (
        <VarianceScenario state={state} setState={setState} goTo={goTo} />
      ) : null}
      {screenId === 's10' ? (
        <BatchScenario state={state} setState={setState} goTo={goTo} />
      ) : null}
      {screenId === 's13' ? (
        <AllocationScenario state={state} setState={setState} goTo={goTo} />
      ) : null}
      {screenId === 's12' ? (
        <ReceivableDetailScenario state={state} goTo={goTo} />
      ) : null}
      {screenId === 's14' ? (
        <ReceivableMonitoringScenario state={state} goTo={goTo} />
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          persistScenario(initialState)
          setState(initialState)
        }}
      >
        <RotateCcw className="mr-2 size-4" />
        {copy.common.reset}
      </Button>
    </div>
  )
}
