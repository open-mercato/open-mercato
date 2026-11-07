"use client"

import * as React from 'react'
import { CreditCard, History, Pencil, Plus, Receipt } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge, type StatusBadgeVariant, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { hasFeature } from '@open-mercato/shared/security/features'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'

const CREDIT_PANEL_RESOURCE_KINDS = new Set(['customers.person', 'customers.company'])
const CREDIT_MANAGE_FEATURE = 'customer_groups.credit.manage'
const CREDIT_ADJUST_FEATURE = 'customer_groups.credit.adjust'
const CREDIT_AMOUNT_PATTERN = /^-?\d{1,14}(\.\d{1,2})?$/

type CreditPanelContext = {
  resourceKind: string
  resourceId: string
}

type CreditAccountRow = {
  id: string
  customerId: string
  currencyCode: string
  creditLimit: string
  isOnHold: boolean
  holdReason: string | null
  exposure: string | null
  available: string | null
  updatedAt: string | null
}

type CreditAccountCreateFormValues = {
  currencyCode: string
  creditLimit: number
}

type CreditLedgerEntryRow = {
  id: string
  entryType: string
  amount: string
  balanceAfter: string
  note: string | null
  createdAt: string | null
}

type CreditLedgerPage = {
  items: CreditLedgerEntryRow[]
  page: number
  totalPages: number
}

const LEDGER_PAGE_SIZE = 20
function useLedgerEntryTypeLabel(): (entryType: string) => string {
  const t = useT()
  return React.useCallback(
    (entryType: string) => {
      switch (entryType) {
        case 'reserve':
          return t('customer_groups.groups.creditTab.ledger.type.reserve', 'Reserve')
        case 'release':
          return t('customer_groups.groups.creditTab.ledger.type.release', 'Release')
        case 'settle':
          return t('customer_groups.groups.creditTab.ledger.type.settle', 'Settle')
        case 'adjust':
          return t('customer_groups.groups.creditTab.ledger.type.adjust', 'Adjustment')
        default:
          return entryType
      }
    },
    [t],
  )
}

type CreditAccountFormValues = {
  creditLimit: number
  isOnHold: boolean
  holdReason: string
}

type CreditAdjustFormValues = {
  amount: string
  note: string
}

const HOLD_STATUS_BADGE_VARIANTS: StatusMap<'onHold' | 'active'> = {
  onHold: 'warning',
  active: 'success',
}

function isValidContext(ctx: unknown): ctx is CreditPanelContext {
  if (!ctx || typeof ctx !== 'object') return false
  const candidate = ctx as { resourceKind?: unknown; resourceId?: unknown }
  if (typeof candidate.resourceKind !== 'string' || !CREDIT_PANEL_RESOURCE_KINDS.has(candidate.resourceKind)) return false
  return typeof candidate.resourceId === 'string' && candidate.resourceId.trim().length > 0
}

// The list route returns the query-engine column projection (snake_case keys) plus the
// `exposure`/`available` fields merged in by `credit-accounts/crud.ts`'s `afterList` hook
// — mirrors `person-groups-tab.tsx#readStringField`'s defensive snake/camel acceptance.
function readStringField(record: Record<string, unknown>, camelKey: string, snakeKey: string): string {
  const camel = record[camelKey]
  if (typeof camel === 'string' && camel.length) return camel
  const snake = record[snakeKey]
  if (typeof snake === 'string' && snake.length) return snake
  return ''
}

function readNullableStringField(record: Record<string, unknown>, camelKey: string, snakeKey: string): string | null {
  const camel = record[camelKey]
  if (typeof camel === 'string' && camel.length) return camel
  const snake = record[snakeKey]
  if (typeof snake === 'string' && snake.length) return snake
  return null
}

function readBooleanField(record: Record<string, unknown>, camelKey: string, snakeKey: string): boolean {
  const camel = record[camelKey]
  if (typeof camel === 'boolean') return camel
  const snake = record[snakeKey]
  return typeof snake === 'boolean' ? snake : false
}

function mapCreditAccountItem(item: unknown): CreditAccountRow | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const id = readStringField(record, 'id', 'id')
  const customerId = readStringField(record, 'customerId', 'customer_id')
  const currencyCode = readStringField(record, 'currencyCode', 'currency_code')
  if (!id || !customerId || !currencyCode) return null
  return {
    id,
    customerId,
    currencyCode,
    creditLimit: readStringField(record, 'creditLimit', 'credit_limit') || '0.00',
    isOnHold: readBooleanField(record, 'isOnHold', 'is_on_hold'),
    holdReason: readNullableStringField(record, 'holdReason', 'hold_reason'),
    exposure: readNullableStringField(record, 'exposure', 'exposure'),
    available: readNullableStringField(record, 'available', 'available'),
    updatedAt: readNullableStringField(record, 'updatedAt', 'updated_at'),
  }
}

function mapCreditAccountItems(items: unknown): CreditAccountRow[] {
  if (!Array.isArray(items)) return []
  return items.reduce<CreditAccountRow[]>((acc, item) => {
    const row = mapCreditAccountItem(item)
    if (row) acc.push(row)
    return acc
  }, [])
}

function mapLedgerEntry(item: unknown): CreditLedgerEntryRow | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const id = readStringField(record, 'id', 'id')
  if (!id) return null
  return {
    id,
    entryType: readStringField(record, 'entryType', 'entry_type'),
    amount: readStringField(record, 'amount', 'amount') || '0.00',
    balanceAfter: readStringField(record, 'balanceAfter', 'balance_after') || '0.00',
    note: readNullableStringField(record, 'note', 'note'),
    createdAt: readNullableStringField(record, 'createdAt', 'created_at'),
  }
}

// Read-only (§5.5, US-E1): the ledger is append-only, so there is no row action here.
function CreditLedgerList({ accountId }: { accountId: string }) {
  const t = useT()
  const entryTypeLabel = useLedgerEntryTypeLabel()
  const [page, setPage] = React.useState(1)
  const [ledger, setLedger] = React.useState<CreditLedgerPage | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const loadLedger = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await apiCall<{ items?: unknown[]; page?: number; totalPages?: number }>(
          `/api/customer_groups/customer-groups/credit-accounts/${encodeURIComponent(accountId)}/ledger?page=${page}&pageSize=${LEDGER_PAGE_SIZE}`,
        )
        if (!res.ok || !res.result) throw new Error('[internal] credit ledger')
        const items = Array.isArray(res.result.items)
          ? res.result.items.reduce<CreditLedgerEntryRow[]>((acc, item) => {
            const entry = mapLedgerEntry(item)
            if (entry) acc.push(entry)
            return acc
          }, [])
          : []
        if (!cancelled) {
          setLedger({
            items,
            page: typeof res.result.page === 'number' ? res.result.page : page,
            totalPages: typeof res.result.totalPages === 'number' ? res.result.totalPages : 1,
          })
        }
      } catch {
        if (!cancelled) setError(t('customer_groups.groups.creditTab.ledger.errors.load', 'Failed to load the ledger.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadLedger()
    return () => {
      cancelled = true
    }
  }, [accountId, page, t])

  if (loading && !ledger) {
    return <LoadingMessage label={t('customer_groups.groups.creditTab.ledger.loading', 'Loading ledger…')} />
  }
  if (error) return <ErrorMessage label={error} />
  if (!ledger || ledger.items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('customer_groups.groups.creditTab.ledger.empty', 'No ledger entries yet.')}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border text-xs" aria-label={t('customer_groups.groups.creditTab.ledger.title', 'Ledger')}>
        {ledger.items.map((entry) => (
          <li key={entry.id} className="grid grid-cols-4 gap-2 py-1">
            <span className="text-muted-foreground">
              {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '—'}
            </span>
            <span className="text-foreground">
              {entryTypeLabel(entry.entryType)}
            </span>
            <span className="text-foreground">{entry.amount}</span>
            <span className="text-muted-foreground">
              {t('customer_groups.groups.creditTab.ledger.balanceAfter', 'Balance after')}: {entry.balanceAfter}
            </span>
            {entry.note ? <span className="col-span-4 text-muted-foreground">{entry.note}</span> : null}
          </li>
        ))}
      </ul>
      {ledger.totalPages > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || ledger.page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            {t('customer_groups.groups.creditTab.ledger.previous', 'Previous')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || ledger.page >= ledger.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            {t('customer_groups.groups.creditTab.ledger.next', 'Next')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function CreditAccountRowItem({
  row,
  canManage,
  canAdjust,
  onEdit,
  onAdjust,
}: {
  row: CreditAccountRow
  canManage: boolean
  canAdjust: boolean
  onEdit: (row: CreditAccountRow) => void
  onAdjust: (row: CreditAccountRow) => void
}) {
  const t = useT()
  const [ledgerOpen, setLedgerOpen] = React.useState(false)
  const holdStatus: 'onHold' | 'active' = row.isOnHold ? 'onHold' : 'active'
  const holdLabel = t(
    row.isOnHold ? 'customer_groups.groups.creditTab.status.onHold' : 'customer_groups.groups.creditTab.status.active',
    row.isOnHold ? 'On hold' : 'Active',
  )
  const statusVariant: StatusBadgeVariant = HOLD_STATUS_BADGE_VARIANTS[holdStatus]

  return (
    <li className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{row.currencyCode}</span>
            <StatusBadge variant={statusVariant} dot>{holdLabel}</StatusBadge>
          </div>
          <dl className="grid grid-cols-3 gap-x-4 text-xs text-muted-foreground">
            <div>
              <dt>{t('customer_groups.groups.creditTab.field.limit', 'Limit')}</dt>
              <dd className="text-sm text-foreground">{row.creditLimit}</dd>
            </div>
            <div>
              <dt>{t('customer_groups.groups.creditTab.field.exposure', 'Exposure')}</dt>
              <dd className="text-sm text-foreground">{row.exposure ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('customer_groups.groups.creditTab.field.available', 'Available')}</dt>
              <dd className="text-sm text-foreground">{row.available ?? '—'}</dd>
            </div>
          </dl>
          {row.isOnHold && row.holdReason ? (
            <div className="text-xs text-muted-foreground">
              {t('customer_groups.groups.creditTab.field.holdReason', 'Hold reason')}: {row.holdReason}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            type="button"
            variant="ghost"
            size="xs"
            aria-label={t(
              ledgerOpen ? 'customer_groups.groups.creditTab.ledger.hide' : 'customer_groups.groups.creditTab.ledger.show',
              ledgerOpen ? 'Hide ledger' : 'Show ledger',
            )}
            aria-expanded={ledgerOpen}
            onClick={() => setLedgerOpen((current) => !current)}
          >
            <History className="size-4" aria-hidden />
          </IconButton>
          {canAdjust ? (
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t('customer_groups.groups.creditTab.adjust', 'Adjust')}
              onClick={() => onAdjust(row)}
            >
              <Receipt className="size-4" aria-hidden />
            </IconButton>
          ) : null}
          {canManage ? (
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t('customer_groups.groups.creditTab.edit', 'Edit credit account')}
              onClick={() => onEdit(row)}
            >
              <Pencil className="size-4" aria-hidden />
            </IconButton>
          ) : null}
        </div>
      </div>
      {ledgerOpen ? (
        <div className="mt-2 border-t border-border pt-2">
          <CreditLedgerList accountId={row.id} />
        </div>
      ) : null}
    </li>
  )
}

export function CreditPanelWidget({ context }: InjectionWidgetComponentProps<unknown, unknown>) {
  const t = useT()
  const { payload: backendChromePayload, isReady: backendChromeReady } = useBackendChrome()
  const canManage = backendChromeReady && hasFeature(backendChromePayload?.grantedFeatures, CREDIT_MANAGE_FEATURE)
  const canAdjust = backendChromeReady && hasFeature(backendChromePayload?.grantedFeatures, CREDIT_ADJUST_FEATURE)
  const editDialogContentRef = React.useRef<HTMLDivElement | null>(null)
  const createDialogContentRef = React.useRef<HTMLDivElement | null>(null)
  const adjustDialogContentRef = React.useRef<HTMLDivElement | null>(null)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [accounts, setAccounts] = React.useState<CreditAccountRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [editingAccount, setEditingAccount] = React.useState<CreditAccountRow | null>(null)
  const [adjustingAccount, setAdjustingAccount] = React.useState<CreditAccountRow | null>(null)
  const [formInstanceKey, setFormInstanceKey] = React.useState(0)
  const [adjustFormInstanceKey, setAdjustFormInstanceKey] = React.useState(0)

  const customerId = isValidContext(context) ? context.resourceId : null

  const load = React.useCallback(async () => {
    if (!customerId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiCall<{ items?: unknown[] }>(
        `/api/customer_groups/customer-groups/credit-accounts?customerId=${encodeURIComponent(customerId)}&pageSize=20`,
      )
      if (res.ok && res.result) {
        setAccounts(mapCreditAccountItems(res.result.items))
      } else if (res.status === 403) {
        setAccounts([])
      } else {
        throw new Error('[internal] credit accounts')
      }
    } catch {
      setError(t('customer_groups.groups.creditTab.errors.load', 'Failed to load the credit account.'))
    } finally {
      setLoading(false)
    }
  }, [customerId, t])

  React.useEffect(() => {
    load()
  }, [load])

  React.useEffect(() => {
    if (editingAccount) setFormInstanceKey((current) => current + 1)
  }, [editingAccount])

  React.useEffect(() => {
    if (adjustingAccount) setAdjustFormInstanceKey((current) => current + 1)
  }, [adjustingAccount])

  const editFields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'creditLimit',
        label: t('customer_groups.groups.creditTab.field.limit', 'Limit'),
        type: 'number',
      },
      {
        id: 'isOnHold',
        label: t('customer_groups.groups.creditTab.field.onHold', 'On hold'),
        type: 'checkbox',
      },
      {
        id: 'holdReason',
        label: t('customer_groups.groups.creditTab.field.holdReason', 'Hold reason'),
        type: 'textarea',
        rows: 2,
        maxLength: 2000,
        visibleWhen: { field: 'isOnHold', equals: true },
        description: t(
          'customer_groups.groups.creditTab.field.holdReasonHelp',
          'Required while this account is on hold.',
        ),
      },
    ],
    [t],
  )

  const editInitialValues = React.useMemo<Partial<CreditAccountFormValues>>(
    () => ({
      creditLimit: editingAccount ? Number(editingAccount.creditLimit) : 0,
      isOnHold: editingAccount?.isOnHold ?? false,
      holdReason: editingAccount?.holdReason ?? '',
    }),
    [editingAccount],
  )

  const closeEditDialog = React.useCallback(() => setEditingAccount(null), [])

  const handleEditSubmit = React.useCallback(
    async (values: CreditAccountFormValues) => {
      if (!editingAccount) return
      const holdReason = typeof values.holdReason === 'string' && values.holdReason.trim().length
        ? values.holdReason.trim()
        : null
      if (values.isOnHold && !holdReason) {
        const message = t(
          'customer_groups.groups.creditTab.errors.holdReasonRequired',
          'A hold reason is required when placing an account on hold.',
        )
        throw createCrudFormError(message, { holdReason: message })
      }
      await updateCrud(
        'customer_groups/customer-groups/credit-accounts',
        {
          id: editingAccount.id,
          creditLimit: values.creditLimit,
          isOnHold: values.isOnHold,
          holdReason,
        },
        {
          errorMessage: t('customer_groups.groups.creditTab.errors.saveFailed', 'Failed to update the credit account.'),
        },
      )
      setEditingAccount(null)
      flash(t('customer_groups.groups.creditTab.saved', 'Credit account updated.'), 'success')
      await load()
    },
    [editingAccount, load, t],
  )

  const submitEditForm = React.useCallback(
    () => editDialogContentRef.current?.querySelector('form')?.requestSubmit(),
    [],
  )
  const handleEditDialogKeyDown = useDialogKeyHandler({
    onConfirm: submitEditForm,
    onCancel: closeEditDialog,
  })

  // Step 1.12 (D-R5-2/G20, §6.5/§9): the operator-facing half of hybrid settlement — a
  // signed, non-zero correction with a required note, posted through the
  // `customer_groups.credit.adjust` command route rather than `CrudForm`'s usual
  // `createCrud`/`updateCrud` helpers (this is not a CRUD write on the account entity
  // itself, it appends a ledger entry). Gated separately from `canManage` (`credit.adjust`
  // is its own ACL feature, §9.1) — a role can edit limits without being allowed to move
  // the balance, or vice versa.
  const adjustFields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'amount',
        label: t('customer_groups.groups.creditTab.field.amount', 'Amount'),
        type: 'text',
        required: true,
        description: t(
          'customer_groups.groups.creditTab.field.amountHelp',
          'Positive increases exposure, negative lowers it (e.g. a payment received).',
        ),
      },
      {
        id: 'note',
        label: t('customer_groups.groups.creditTab.field.note', 'Note'),
        type: 'textarea',
        rows: 2,
        maxLength: 2000,
        required: true,
      },
    ],
    [t],
  )

  const closeAdjustDialog = React.useCallback(() => setAdjustingAccount(null), [])

  const handleAdjustSubmit = React.useCallback(
    async (values: CreditAdjustFormValues) => {
      if (!adjustingAccount) return
      const amount = typeof values.amount === 'string' ? values.amount.trim() : ''
      if (!CREDIT_AMOUNT_PATTERN.test(amount) || Number(amount) === 0) {
        const message = t(
          'customer_groups.groups.creditTab.errors.amountInvalid',
          'Enter a signed amount with up to 2 decimal places (not zero).',
        )
        throw createCrudFormError(message, { amount: message })
      }
      const note = typeof values.note === 'string' ? values.note.trim() : ''
      if (!note) {
        const message = t('customer_groups.groups.creditTab.errors.noteRequired', 'A note is required for every adjustment.')
        throw createCrudFormError(message, { note: message })
      }
      await apiCallOrThrow(
        `/api/customer_groups/customer-groups/credit-accounts/${encodeURIComponent(adjustingAccount.id)}/adjust`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, note }),
        },
        {
          errorMessage: t('customer_groups.groups.creditTab.errors.adjustFailed', 'Failed to post the adjustment.'),
        },
      )
      setAdjustingAccount(null)
      flash(t('customer_groups.groups.creditTab.adjusted', 'Adjustment posted.'), 'success')
      await load()
    },
    [adjustingAccount, load, t],
  )

  const submitAdjustForm = React.useCallback(
    () => adjustDialogContentRef.current?.querySelector('form')?.requestSubmit(),
    [],
  )
  const handleAdjustDialogKeyDown = useDialogKeyHandler({
    onConfirm: submitAdjustForm,
    onCancel: closeAdjustDialog,
  })

  const createFields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'currencyCode',
        label: t('customer_groups.groups.creditTab.field.currency', 'Currency'),
        type: 'text',
        required: true,
      },
      {
        id: 'creditLimit',
        label: t('customer_groups.groups.creditTab.field.limit', 'Limit'),
        type: 'number',
        required: true,
      },
    ],
    [t],
  )

  const closeCreateDialog = React.useCallback(() => setCreateOpen(false), [])

  const handleCreateSubmit = React.useCallback(
    async (values: CreditAccountCreateFormValues) => {
      if (!customerId) return
      const currencyCode = typeof values.currencyCode === 'string' ? values.currencyCode.trim().toUpperCase() : ''
      if (!/^[A-Z]{3}$/.test(currencyCode)) {
        const message = t('customer_groups.groups.creditTab.errors.currencyInvalid', 'Enter a 3-letter currency code.')
        throw createCrudFormError(message, { currencyCode: message })
      }
      const creditLimit = Number(values.creditLimit)
      if (!Number.isFinite(creditLimit) || creditLimit < 0) {
        const message = t('customer_groups.groups.creditTab.errors.limitInvalid', 'Enter a limit of zero or more.')
        throw createCrudFormError(message, { creditLimit: message })
      }
      await createCrud(
        'customer_groups/customer-groups/credit-accounts',
        { customerId, currencyCode, creditLimit },
        {
          errorMessage: t('customer_groups.groups.creditTab.errors.createFailed', 'Failed to create the credit account.'),
        },
      )
      setCreateOpen(false)
      flash(t('customer_groups.groups.creditTab.created', 'Credit account created.'), 'success')
      await load()
    },
    [customerId, load, t],
  )

  const submitCreateForm = React.useCallback(
    () => createDialogContentRef.current?.querySelector('form')?.requestSubmit(),
    [],
  )
  const handleCreateDialogKeyDown = useDialogKeyHandler({
    onConfirm: submitCreateForm,
    onCancel: closeCreateDialog,
  })

  if (!customerId) return null

  return (
    <div className="space-y-3">
      {canManage ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden />
            {t('customer_groups.groups.creditTab.create', 'Create credit account')}
          </Button>
        </div>
      ) : null}
      {loading ? (
        <LoadingMessage label={t('customer_groups.groups.creditTab.loading', 'Loading credit account…')} />
      ) : error ? (
        <ErrorMessage label={error} />
      ) : accounts.length === 0 ? (
        <EmptyState
          size="sm"
          variant="subtle"
          icon={<CreditCard className="h-5 w-5" aria-hidden />}
          title={t('customer_groups.groups.creditTab.empty.title', 'No credit account')}
          description={t(
            'customer_groups.groups.creditTab.empty.description',
            'This customer has no credit account yet. Credit accounts are created by an operator.',
          )}
          className="border border-dashed border-border"
        />
      ) : (
        <ul className="space-y-2" aria-label={t('customer_groups.groups.creditTab.listLabel', 'Credit accounts')}>
          {accounts.map((row) => (
            <CreditAccountRowItem
              key={row.id}
              row={row}
              canManage={canManage}
              canAdjust={canAdjust}
              onEdit={setEditingAccount}
              onAdjust={setAdjustingAccount}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          if (!next) setCreateOpen(false)
        }}
      >
        <DialogContent ref={createDialogContentRef} onKeyDown={handleCreateDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('customer_groups.groups.creditTab.createDialog.title', 'Create credit account')}</DialogTitle>
          </DialogHeader>
          {createOpen ? (
            <CrudForm<CreditAccountCreateFormValues>
              embedded
              fields={createFields}
              initialValues={{ currencyCode: '', creditLimit: 0 }}
              submitLabel={t('customer_groups.groups.creditTab.createDialog.submit', 'Create')}
              onSubmit={handleCreateSubmit}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingAccount != null}
        onOpenChange={(next) => {
          if (!next) setEditingAccount(null)
        }}
      >
        <DialogContent ref={editDialogContentRef} onKeyDown={handleEditDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('customer_groups.groups.creditTab.editDialog.title', 'Edit credit account')}</DialogTitle>
          </DialogHeader>
          <CrudForm<CreditAccountFormValues>
            key={formInstanceKey}
            embedded
            fields={editFields}
            initialValues={editInitialValues}
            optimisticLockUpdatedAt={editingAccount?.updatedAt ?? null}
            submitLabel={t('customer_groups.groups.creditTab.editDialog.submit', 'Save')}
            onSubmit={handleEditSubmit}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={adjustingAccount != null}
        onOpenChange={(next) => {
          if (!next) setAdjustingAccount(null)
        }}
      >
        <DialogContent ref={adjustDialogContentRef} onKeyDown={handleAdjustDialogKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('customer_groups.groups.creditTab.adjustDialog.title', 'Post credit adjustment')}</DialogTitle>
          </DialogHeader>
          {adjustingAccount ? (
            <CrudForm<CreditAdjustFormValues>
              key={adjustFormInstanceKey}
              embedded
              fields={adjustFields}
              initialValues={{ amount: '', note: '' }}
              submitLabel={t('customer_groups.groups.creditTab.adjustDialog.submit', 'Post adjustment')}
              onSubmit={handleAdjustSubmit}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default CreditPanelWidget
