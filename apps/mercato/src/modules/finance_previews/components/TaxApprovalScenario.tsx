'use client'

import * as React from 'react'
import { z } from 'zod'
import { ArrowRight, RotateCcw } from 'lucide-react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { FinanceStatusBadge } from './FinanceStatusBadge'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@open-mercato/ui/primitives/card'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Alert } from '@open-mercato/ui/primitives/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import copy from '../data/tax-approval-copy.json'

const taxCodeSchema = z.object({
  code: z.string(),
  name: z.string(),
  rate: z.string(),
  account: z.string(),
  isDefault: z.boolean(),
  active: z.boolean(),
})
type TaxCode = z.infer<typeof taxCodeSchema>
const roleSchema = z.enum(['author', 'manager', 'controller', 'cfo'])
type Role = z.infer<typeof roleSchema>
const scenarioSchema = z.object({
  version: z.literal(1),
  codes: z.array(taxCodeSchema),
  jpkVariant: z.string(),
  jpkPeriod: z.string(),
  taxOffice: z.string(),
  nip: z.string(),
  jpkStatus: z.enum(['empty', 'draft', 'validated', 'generated']),
  threshold: z.string(),
  firstRole: roleSchema,
  secondRole: roleSchema,
  segregation: z.boolean(),
  ruleSaved: z.boolean(),
  invoiceAmount: z.string(),
  creatorRole: roleSchema,
  actingRole: roleSchema,
  decision: z.enum(['idle', 'first', 'second', 'approved', 'rejected', 'auto']),
})
type ScenarioState = z.infer<typeof scenarioSchema>

type Feedback = { kind: 'info' | 'warning' | 'error'; message: string }

const storageKey = 'finance-preview-tax-approval-v1'
const initialState: ScenarioState = {
  version: 1,
  codes: [
    {
      code: 'VAT23',
      name: copy.tax.name23,
      rate: '23',
      account: '221-01',
      isDefault: true,
      active: true,
    },
    {
      code: 'VAT8',
      name: copy.tax.name8,
      rate: '8',
      account: '221-01',
      isDefault: false,
      active: true,
    },
    {
      code: 'VAT5',
      name: copy.tax.name5,
      rate: '5',
      account: '221-01',
      isDefault: false,
      active: true,
    },
    {
      code: 'VAT0',
      name: copy.tax.name0,
      rate: '0',
      account: '221-01',
      isDefault: false,
      active: true,
    },
    {
      code: 'VATZW',
      name: copy.tax.nameExempt,
      rate: '0',
      account: '221-01',
      isDefault: false,
      active: true,
    },
  ],
  jpkVariant: 'JPK_V7M',
  jpkPeriod: '09/2026',
  taxOffice: '0000',
  nip: '5250001003',
  jpkStatus: 'empty',
  threshold: '10000',
  firstRole: 'manager',
  secondRole: 'controller',
  segregation: true,
  ruleSaved: true,
  invoiceAmount: '12300',
  creatorRole: 'author',
  actingRole: 'manager',
  decision: 'idle',
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

function parseAmount(value: string): number {
  return Number(value.replace(/\s/g, '').replace(',', '.'))
}

function validNip(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
  const control =
    weights.reduce(
      (sum, weight, index) => sum + weight * Number(value[index]),
      0,
    ) % 11
  return control !== 10 && control === Number(value[9])
}

function roleLabel(role: Role): string {
  return role === 'author'
    ? copy.approval.roleAuthor
    : role === 'manager'
      ? copy.approval.roleManager
      : role === 'controller'
        ? copy.approval.roleController
        : copy.approval.roleCfo
}

function RoleSelect({
  id,
  value,
  onChange,
  includeAuthor = false,
}: {
  id: string
  value: Role
  onChange: (role: Role) => void
  includeAuthor?: boolean
}) {
  return (
    <Select value={value} onValueChange={(role) => onChange(role as Role)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {includeAuthor ? (
          <SelectItem value="author">{copy.approval.roleAuthor}</SelectItem>
        ) : null}
        <SelectItem value="manager">{copy.approval.roleManager}</SelectItem>
        <SelectItem value="controller">
          {copy.approval.roleController}
        </SelectItem>
        <SelectItem value="cfo">{copy.approval.roleCfo}</SelectItem>
      </SelectContent>
    </Select>
  )
}

function Heading({
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

function Field({
  id,
  label,
  value,
  onChange,
  inputMode,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  inputMode?: 'numeric' | 'decimal'
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
      />
    </div>
  )
}

export function TaxApprovalScenario({
  screenId,
  goTo,
}: {
  screenId: string
  goTo: (screenId: string) => void
}) {
  const [state, setState] = React.useState<ScenarioState>(initialState)
  const [hydrated, setHydrated] = React.useState(false)
  const [feedback, setFeedback] = React.useState<Feedback | null>(null)
  const [editingCode, setEditingCode] = React.useState<string | null>(null)
  const [draftCode, setDraftCode] = React.useState<TaxCode>({
    code: '',
    name: '',
    rate: '',
    account: '',
    isDefault: false,
    active: true,
  })

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

  const change = React.useCallback(
    (patch: Partial<ScenarioState>) =>
      setState((current) => ({ ...current, ...patch })),
    [],
  )
  const changeJpk = React.useCallback(
    (patch: Partial<ScenarioState>) =>
      setState((current) => ({ ...current, ...patch, jpkStatus: 'draft' })),
    [],
  )
  const changeRule = React.useCallback(
    (patch: Partial<ScenarioState>) =>
      setState((current) => ({
        ...current,
        ...patch,
        ruleSaved: false,
        decision: 'idle',
      })),
    [],
  )

  const reset = () => {
    setState(initialState)
    setFeedback(null)
    setEditingCode(null)
    window.sessionStorage.removeItem(storageKey)
  }

  const beginEdit = (code?: TaxCode) => {
    setEditingCode(code?.code ?? 'new')
    setDraftCode(
      code
        ? { ...code }
        : {
            code: '',
            name: '',
            rate: '',
            account: '',
            isDefault: false,
            active: true,
          },
    )
    setFeedback(null)
  }

  const saveCode = () => {
    const normalizedCode = draftCode.code.trim().toUpperCase()
    const rate = parseAmount(draftCode.rate)
    const duplicate = state.codes.some(
      (item) => item.code === normalizedCode && item.code !== editingCode,
    )
    if (
      !normalizedCode ||
      !draftCode.name.trim() ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 100 ||
      !/^\d{3}-\d{2}$/.test(draftCode.account.trim()) ||
      duplicate ||
      (draftCode.isDefault && !draftCode.active)
    ) {
      setFeedback({ kind: 'error', message: copy.tax.validation })
      return
    }
    const nextCode = {
      ...draftCode,
      code: normalizedCode,
      rate: String(rate),
      account: draftCode.account.trim(),
      name: draftCode.name.trim(),
    }
    const others = state.codes
      .filter((item) => item.code !== editingCode)
      .map((item) =>
        nextCode.isDefault ? { ...item, isDefault: false } : item,
      )
    const next = [...others, nextCode]
    if (!next.some((item) => item.isDefault && item.active)) {
      setFeedback({ kind: 'error', message: copy.tax.validation })
      return
    }
    change({ codes: next, jpkStatus: 'draft' })
    setEditingCode(null)
    setFeedback({ kind: 'info', message: copy.tax.saved })
  }

  const validateJpk = () => {
    if (
      !['JPK_V7M', 'JPK_V7K'].includes(state.jpkVariant) ||
      state.jpkPeriod !== '09/2026' ||
      !/^\d{4}$/.test(state.taxOffice) ||
      !validNip(state.nip)
    ) {
      setFeedback({ kind: 'error', message: copy.jpk.validationError })
      return
    }
    const activeCodes = state.codes.filter((item) => item.active)
    if (
      !activeCodes.length ||
      !activeCodes.some((item) => item.isDefault) ||
      !activeCodes.every(
        (item) =>
          Number.isFinite(parseAmount(item.rate)) &&
          parseAmount(item.rate) >= 0 &&
          parseAmount(item.rate) <= 100 &&
          /^\d{3}-\d{2}$/.test(item.account),
      )
    ) {
      setFeedback({ kind: 'error', message: copy.jpk.taxCodeError })
      return
    }
    change({ jpkStatus: 'validated' })
    setFeedback({ kind: 'info', message: copy.jpk.validated })
  }

  const generateJpk = () => {
    if (state.jpkStatus !== 'validated') {
      setFeedback({ kind: 'warning', message: copy.jpk.needsValidation })
      return
    }
    change({ jpkStatus: 'generated' })
    setFeedback({ kind: 'info', message: copy.jpk.generated })
  }

  const saveRule = () => {
    const threshold = parseAmount(state.threshold)
    if (
      !Number.isFinite(threshold) ||
      threshold <= 0 ||
      state.firstRole === state.secondRole ||
      (state.segregation &&
        (state.firstRole === 'author' || state.secondRole === 'author'))
    ) {
      setFeedback({ kind: 'error', message: copy.approval.ruleValidation })
      return
    }
    change({ ruleSaved: true })
    setFeedback({ kind: 'info', message: copy.approval.ruleSaved })
  }

  const startDecision = () => {
    if (!state.ruleSaved) {
      setFeedback({ kind: 'warning', message: copy.approval.unsaved })
      return
    }
    const amount = parseAmount(state.invoiceAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setFeedback({ kind: 'error', message: copy.approval.amountValidation })
      return
    }
    if (amount <= parseAmount(state.threshold)) {
      change({ decision: 'auto' })
      setFeedback({ kind: 'info', message: copy.approval.autoApproved })
      return
    }
    if (
      state.segregation &&
      (state.creatorRole === state.firstRole ||
        state.creatorRole === state.secondRole)
    ) {
      setFeedback({ kind: 'error', message: copy.approval.selfApproval })
      return
    }
    change({ decision: 'first', actingRole: state.firstRole })
    setFeedback({ kind: 'info', message: copy.approval.pendingFirst })
  }

  const actOnDecision = (approve: boolean) => {
    if (state.decision !== 'first' && state.decision !== 'second') return
    const requiredRole =
      state.decision === 'first' ? state.firstRole : state.secondRole
    if (state.actingRole !== requiredRole) {
      setFeedback({ kind: 'error', message: copy.approval.wrongRole })
      return
    }
    if (state.segregation && state.actingRole === state.creatorRole) {
      setFeedback({ kind: 'error', message: copy.approval.selfApproval })
      return
    }
    if (!approve) {
      change({ decision: 'rejected' })
      setFeedback({ kind: 'warning', message: copy.approval.rejected })
    } else if (state.decision === 'first') {
      change({ decision: 'second', actingRole: state.secondRole })
      setFeedback({ kind: 'info', message: copy.approval.pendingSecond })
    } else {
      change({ decision: 'approved' })
      setFeedback({ kind: 'info', message: copy.approval.approved })
    }
  }

  const taxColumns: ColumnDef<TaxCode, unknown>[] = [
    { id: 'code', header: copy.tax.code, accessorKey: 'code' },
    { id: 'name', header: copy.tax.name, accessorKey: 'name' },
    {
      id: 'rate',
      header: copy.tax.rate,
      accessorFn: (row) => row.rate,
      cell: ({ row }) => `${row.original.rate}%`,
    },
    { id: 'account', header: copy.tax.account, accessorKey: 'account' },
    {
      id: 'default',
      header: copy.tax.default,
      accessorFn: (row) => (row.isDefault ? copy.tax.yes : copy.tax.no),
      cell: ({ row }) =>
        row.original.isDefault ? (
          <FinanceStatusBadge variant="success">
            {copy.tax.yes}
          </FinanceStatusBadge>
        ) : (
          copy.tax.no
        ),
    },
    {
      id: 'status',
      header: copy.tax.status,
      accessorFn: (row) =>
        row.active ? copy.common.active : copy.common.inactive,
      cell: ({ row }) => (
        <FinanceStatusBadge
          variant={row.original.active ? 'success' : 'neutral'}
        >
          {row.original.active ? copy.common.active : copy.common.inactive}
        </FinanceStatusBadge>
      ),
    },
    {
      id: 'actions',
      header: copy.tax.actions,
      cell: ({ row }) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => beginEdit(row.original)}
        >
          {copy.common.edit}
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="outline" onClick={reset}>
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
          {feedback.message}
        </Alert>
      ) : null}

      {screenId === 's36' ? (
        <div className="space-y-6">
          <Heading title={copy.tax.title} description={copy.tax.description} />
          <DataTable<TaxCode>
            emptyState={copy.common.noRows}
            title={copy.tax.codesTitle}
            columns={taxColumns}
            data={state.codes}
            actions={
              <Button
                type="button"
                variant="primary-filled"
                onClick={() => beginEdit()}
              >
                {copy.tax.new}
              </Button>
            }
            embedded
          />
          {editingCode ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {editingCode === 'new'
                    ? copy.tax.newTitle
                    : copy.tax.editTitle}
                </CardTitle>
                <CardDescription>{copy.tax.defaultHint}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    id="tax-code"
                    label={copy.tax.code}
                    value={draftCode.code}
                    onChange={(code) =>
                      setDraftCode((current) => ({ ...current, code }))
                    }
                  />
                  <Field
                    id="tax-name"
                    label={copy.tax.name}
                    value={draftCode.name}
                    onChange={(name) =>
                      setDraftCode((current) => ({ ...current, name }))
                    }
                  />
                  <Field
                    id="tax-rate"
                    label={copy.tax.rate}
                    value={draftCode.rate}
                    onChange={(rate) =>
                      setDraftCode((current) => ({ ...current, rate }))
                    }
                    inputMode="decimal"
                  />
                  <Field
                    id="tax-account"
                    label={copy.tax.account}
                    value={draftCode.account}
                    onChange={(account) =>
                      setDraftCode((current) => ({ ...current, account }))
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-5">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="tax-default"
                      checked={draftCode.isDefault}
                      onCheckedChange={(checked) =>
                        setDraftCode((current) => ({
                          ...current,
                          isDefault: checked === true,
                        }))
                      }
                    />
                    <Label htmlFor="tax-default">{copy.tax.default}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="tax-active"
                      checked={draftCode.active}
                      onCheckedChange={(checked) =>
                        setDraftCode((current) => ({
                          ...current,
                          active: checked === true,
                        }))
                      }
                    />
                    <Label htmlFor="tax-active">{copy.common.active}</Label>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="primary-filled"
                    onClick={saveCode}
                  >
                    {copy.common.save}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditingCode(null)}
                  >
                    {copy.common.cancel}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{copy.tax.registryTitle}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <p>{copy.tax.sales}</p>
              <p>{copy.tax.purchases}</p>
              <p>{copy.tax.taxDue}</p>
              <p>{copy.tax.taxDeductible}</p>
              <p className="font-semibold md:col-span-2">{copy.tax.balance}</p>
              <Button
                type="button"
                variant="primary-filled"
                onClick={() => goTo('s37')}
              >
                {copy.tax.goToJpk}
                <ArrowRight aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {screenId === 's37' ? (
        <div className="space-y-6">
          <Heading title={copy.jpk.title} description={copy.jpk.description} />
          <Card>
            <CardHeader>
              <CardTitle>{copy.jpk.previewTitle}</CardTitle>
              <CardDescription>{copy.jpk.description}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="jpk-variant">{copy.jpk.variant}</Label>
                <Select
                  value={state.jpkVariant}
                  onValueChange={(jpkVariant) => changeJpk({ jpkVariant })}
                >
                  <SelectTrigger id="jpk-variant">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="JPK_V7M">JPK_V7M</SelectItem>
                    <SelectItem value="JPK_V7K">JPK_V7K</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Field
                id="jpk-period"
                label={copy.jpk.period}
                value={state.jpkPeriod}
                onChange={(jpkPeriod) => changeJpk({ jpkPeriod })}
              />
              <Field
                id="jpk-tax-office"
                label={copy.jpk.taxOffice}
                value={state.taxOffice}
                onChange={(taxOffice) => changeJpk({ taxOffice })}
                inputMode="numeric"
              />
              <Field
                id="jpk-nip"
                label={copy.jpk.nip}
                value={state.nip}
                onChange={(nip) => changeJpk({ nip })}
                inputMode="numeric"
              />
            </CardContent>
          </Card>
          <div className="flex flex-wrap items-center gap-3">
            <FinanceStatusBadge
              variant={
                state.jpkStatus === 'generated'
                  ? 'success'
                  : state.jpkStatus === 'validated'
                    ? 'info'
                    : 'neutral'
              }
              icon={state.jpkStatus === 'draft' ? 'draft' : undefined}
            >
              {state.jpkStatus === 'generated'
                ? copy.jpk.generatedStatus
                : state.jpkStatus === 'validated'
                  ? copy.common.ready
                  : copy.common.draft}
            </FinanceStatusBadge>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                change({ jpkStatus: 'draft' })
                setFeedback({ kind: 'info', message: copy.jpk.draftSaved })
              }}
            >
              {copy.jpk.draft}
            </Button>
            <Button type="button" variant="outline" onClick={validateJpk}>
              {copy.jpk.validate}
            </Button>
            <Button
              type="button"
              variant="primary-filled"
              onClick={generateJpk}
              disabled={state.jpkStatus !== 'validated'}
            >
              {copy.jpk.generate}
            </Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{copy.jpk.previewTitle}</CardTitle>
              <CardDescription>{copy.jpk.noSend}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">
                  {copy.jpk.salesNet}
                </p>
                <p className="text-xl font-semibold tabular-nums">
                  {copy.jpk.salesNetValue}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {copy.jpk.salesVat}
                </p>
                <p className="text-xl font-semibold tabular-nums">
                  {copy.jpk.salesVatValue}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {copy.jpk.purchaseVat}
                </p>
                <p className="text-xl font-semibold tabular-nums">
                  {copy.jpk.purchaseVatValue}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {copy.jpk.payable}
                </p>
                <p className="text-xl font-semibold tabular-nums">
                  {copy.jpk.payableValue}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {copy.jpk.documents}
                </p>
                <p className="text-xl font-semibold tabular-nums">
                  {copy.jpk.documentsValue}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {copy.jpk.warnings}
                </p>
                <p className="text-xl font-semibold tabular-nums">
                  {copy.jpk.warningsValue}
                </p>
              </div>
            </CardContent>
          </Card>
          <Alert status="warning" style="stroke" size="sm">
            {copy.jpk.warningText}
          </Alert>
          <Button type="button" variant="outline" onClick={() => goTo('s36')}>
            {copy.jpk.goToTax}
          </Button>
        </div>
      ) : null}

      {screenId === 's40' ? (
        <div className="space-y-6">
          <Heading
            title={copy.approval.title}
            description={copy.approval.description}
          />
          <Card>
            <CardHeader>
              <CardTitle>{copy.approval.ruleTitle}</CardTitle>
              <CardDescription>{copy.approval.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                <Field
                  id="approval-threshold"
                  label={copy.approval.threshold}
                  value={state.threshold}
                  onChange={(threshold) => changeRule({ threshold })}
                  inputMode="decimal"
                />
                <div className="space-y-2">
                  <Label htmlFor="approval-first">
                    {copy.approval.firstRole}
                  </Label>
                  <RoleSelect
                    id="approval-first"
                    value={state.firstRole}
                    onChange={(firstRole) => changeRule({ firstRole })}
                    includeAuthor
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="approval-second">
                    {copy.approval.secondRole}
                  </Label>
                  <RoleSelect
                    id="approval-second"
                    value={state.secondRole}
                    onChange={(secondRole) => changeRule({ secondRole })}
                    includeAuthor
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="approval-segregation"
                  checked={state.segregation}
                  onCheckedChange={(checked) =>
                    changeRule({ segregation: checked === true })
                  }
                />
                <Label htmlFor="approval-segregation">
                  {copy.approval.segregation}
                </Label>
              </div>
              <Button type="button" variant="primary-filled" onClick={saveRule}>
                {copy.common.save}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{copy.approval.pathTitle}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
              {[
                copy.approval.step1,
                roleLabel(state.firstRole),
                roleLabel(state.secondRole),
                copy.approval.step4,
              ].map((step, index) => (
                <div
                  key={`${index}-${step}`}
                  className="rounded-lg border border-border p-4"
                >
                  <Badge tone="neutral" appearance="stroke" size={20}>
                    {String(index + 1).padStart(2, '0')}
                  </Badge>
                  <p className="mt-3 font-medium">{step}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{copy.approval.simulationTitle}</CardTitle>
              <CardDescription>{copy.approval.ruleTitle}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                <Field
                  id="approval-invoice-amount"
                  label={copy.approval.invoiceAmount}
                  value={state.invoiceAmount}
                  onChange={(invoiceAmount) =>
                    change({ invoiceAmount, decision: 'idle' })
                  }
                  inputMode="decimal"
                />
                <div className="space-y-2">
                  <Label htmlFor="approval-creator">
                    {copy.approval.creatorRole}
                  </Label>
                  <RoleSelect
                    id="approval-creator"
                    value={state.creatorRole}
                    onChange={(creatorRole) =>
                      change({ creatorRole, decision: 'idle' })
                    }
                    includeAuthor
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="approval-acting">
                    {copy.approval.actingRole}
                  </Label>
                  <RoleSelect
                    id="approval-acting"
                    value={state.actingRole}
                    onChange={(actingRole) => change({ actingRole })}
                    includeAuthor
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="primary-filled"
                  onClick={startDecision}
                >
                  {copy.approval.start}
                </Button>
                {state.decision === 'first' || state.decision === 'second' ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => actOnDecision(true)}
                    >
                      {copy.approval.approve}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => actOnDecision(false)}
                    >
                      {copy.approval.reject}
                    </Button>
                  </>
                ) : null}
                {state.decision !== 'idle' ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => change({ decision: 'idle' })}
                  >
                    {copy.approval.resetDecision}
                  </Button>
                ) : null}
              </div>
              <FinanceStatusBadge
                variant={
                  state.decision === 'approved'
                    ? 'success'
                    : state.decision === 'rejected'
                      ? 'error'
                      : 'warning'
                }
              >
                {state.decision === 'first'
                  ? copy.approval.pendingFirst
                  : state.decision === 'second'
                    ? copy.approval.pendingSecond
                    : state.decision === 'approved'
                      ? copy.approval.approved
                      : state.decision === 'rejected'
                        ? copy.approval.rejected
                        : state.decision === 'auto'
                          ? copy.approval.autoApproved
                          : copy.common.draft}
              </FinanceStatusBadge>
            </CardContent>
          </Card>
          <Button type="button" variant="outline" onClick={() => goTo('s28')}>
            {copy.approval.related}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
