"use client"

import * as React from 'react'
import { CreditCard } from 'lucide-react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { useT } from '@/lib/i18n/context'

export type PaymentTotals = {
  paidTotalAmount?: number | null
  refundedTotalAmount?: number | null
  outstandingAmount?: number | null
}

export type PaymentFormData = {
  id?: string | null
  amount?: number | string | null
  paymentMethodId?: string | null
  paymentReference?: string | null
  receivedAt?: string | null
  currencyCode?: string | null
  statusEntryId?: string | null
  customValues?: Record<string, unknown> | null
  customFieldSetId?: string | null
}

type PaymentMethodOption = {
  id: string
  name: string
  code: string
}

type StatusOption = {
  id: string
  value: string
  label: string
  color: string | null
}

type PaymentDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  payment?: PaymentFormData | null
  currencyCode: string | null | undefined
  orderId: string
  organizationId: string | null
  tenantId: string | null
  onOpenChange: (open: boolean) => void
  onSaved?: (totals?: PaymentTotals | null) => void | Promise<void>
}

const normalizeNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

const normalizeCustomFieldSubmitValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.filter((entry) => entry !== undefined)
  if (value === undefined) return null
  return value
}

const prefixCustomFieldValues = (input?: Record<string, unknown> | null): Record<string, unknown> => {
  if (!input || typeof input !== 'object') return {}
  return Object.entries(input).reduce<Record<string, unknown>>((acc, [key, value]) => {
    const normalized = key.startsWith('cf_') ? key : `cf_${key}`
    acc[normalized] = value
    return acc
  }, {})
}

export function PaymentDialog({
  open,
  mode,
  payment,
  currencyCode,
  orderId,
  organizationId,
  tenantId,
  onOpenChange,
  onSaved,
}: PaymentDialogProps) {
  const t = useT()
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)
  const [formResetKey, setFormResetKey] = React.useState(0)
  const [paymentMethods, setPaymentMethods] = React.useState<PaymentMethodOption[]>([])
  const [methodsLoading, setMethodsLoading] = React.useState(false)
  const [paymentStatuses, setPaymentStatuses] = React.useState<StatusOption[]>([])
  const [paymentStatusLoading, setPaymentStatusLoading] = React.useState(false)
  const [documentStatuses, setDocumentStatuses] = React.useState<StatusOption[]>([])
  const [documentStatusLoading, setDocumentStatusLoading] = React.useState(false)

  const currencyLabel = React.useMemo(() => {
    const code = currencyCode ? currencyCode.toUpperCase() : ''
    if (!code) return t('sales.documents.detail.empty', 'Not set')
    return code
  }, [currencyCode, t])

  const initialValues = React.useMemo(
    () => ({
      amount: payment?.amount ?? '',
      paymentMethodId: payment?.paymentMethodId ?? '',
      paymentReference: payment?.paymentReference ?? '',
      receivedAt: payment?.receivedAt ? payment.receivedAt.slice(0, 10) : '',
      statusEntryId: payment?.statusEntryId ?? '',
      documentStatusEntryId: '',
      ...prefixCustomFieldValues(payment?.customValues ?? null),
    }),
    [
      payment?.amount,
      payment?.customValues,
      payment?.paymentMethodId,
      payment?.paymentReference,
      payment?.receivedAt,
      payment?.statusEntryId,
    ],
  )

  const loadPaymentMethods = React.useCallback(
    async (query?: string): Promise<PaymentMethodOption[]> => {
      setMethodsLoading(true)
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '100', isActive: 'true' })
        if (query && query.trim().length) params.set('search', query.trim())
        const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/sales/payment-methods?${params.toString()}`,
          undefined,
          { fallback: { items: [] } }
        )
        if (response.ok && Array.isArray(response.result?.items)) {
          const options = response.result.items
            .map((item) => {
              const id = typeof item.id === 'string' ? item.id : null
              if (!id) return null
              const name = typeof item.name === 'string' ? item.name : null
              const code = typeof item.code === 'string' ? item.code : null
              return {
                id,
                name: name ?? code ?? id,
                code: code ?? id,
              }
            })
            .filter((entry): entry is PaymentMethodOption => !!entry)
          if (!query) setPaymentMethods(options)
          return options
        }
        if (!query) setPaymentMethods([])
        return []
      } catch (err) {
        console.error('sales.payments.methods.load', err)
        return []
      } finally {
        setMethodsLoading(false)
      }
    },
    []
  )

  const fetchPaymentMethodItems = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      const options =
        paymentMethods.length && !query
          ? paymentMethods
          : await loadPaymentMethods(query)
      const term = query?.trim().toLowerCase() ?? ''
      return options
        .filter(
          (option) =>
            !term.length ||
            option.name.toLowerCase().includes(term) ||
            option.code.toLowerCase().includes(term)
        )
        .map<LookupSelectItem>((option) => ({
          id: option.id,
          title: option.name,
          subtitle: option.code,
          icon: <CreditCard className="h-4 w-4 text-muted-foreground" />,
        }))
    },
    [loadPaymentMethods, paymentMethods]
  )

  const shortcutLabel = t('sales.documents.payments.saveShortcut', 'Save ⌘⏎ / Ctrl+Enter')
  const renderStatusIcon = React.useCallback(
    (color?: string | null) => (
      <span
        className="h-2.5 w-2.5 rounded-full border border-border/70"
        style={color ? { backgroundColor: color, borderColor: color } : undefined}
      />
    ),
    [],
  )

  const loadDocumentStatuses = React.useCallback(async (): Promise<StatusOption[]> => {
    setDocumentStatusLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/order-statuses?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      const mapped = items
        .map((entry) => {
          const id = typeof entry.id === 'string' ? entry.id : null
          const value = typeof entry.value === 'string' ? entry.value : null
          if (!id || !value) return null
          const label =
            typeof entry.label === 'string' && entry.label.trim().length
              ? entry.label
              : value
          const color =
            typeof entry.color === 'string' && entry.color.trim().length ? entry.color : null
          return { id, value, label, color }
        })
        .filter((entry): entry is StatusOption => Boolean(entry))
      setDocumentStatuses(mapped)
      return mapped
    } catch (err) {
      console.error('sales.payments.statuses.load', err)
      setDocumentStatuses([])
      return []
    } finally {
      setDocumentStatusLoading(false)
    }
  }, [])

  const loadPaymentStatuses = React.useCallback(async (): Promise<StatusOption[]> => {
    setPaymentStatusLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/payment-statuses?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      const mapped = items
        .map((entry) => {
          const id = typeof entry.id === 'string' ? entry.id : null
          const value = typeof entry.value === 'string' ? entry.value : null
          if (!id || !value) return null
          const label =
            typeof entry.label === 'string' && entry.label.trim().length
              ? entry.label
              : value
          const color =
            typeof entry.color === 'string' && entry.color.trim().length ? entry.color : null
          return { id, value, label, color }
        })
        .filter((entry): entry is StatusOption => Boolean(entry))
      setPaymentStatuses(mapped)
      return mapped
    } catch (err) {
      console.error('sales.payments.statuses.load', err)
      setPaymentStatuses([])
      return []
    } finally {
      setPaymentStatusLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    setFormResetKey((prev) => prev + 1)
    if (!paymentMethods.length) {
      void loadPaymentMethods()
    }
    if (!paymentStatuses.length) {
      void loadPaymentStatuses()
    }
    if (mode === 'create') {
      if (!documentStatuses.length) {
        void loadDocumentStatuses()
      }
    }
  }, [
    documentStatuses.length,
    loadDocumentStatuses,
    loadPaymentStatuses,
    loadPaymentMethods,
    mode,
    open,
    payment?.id,
    paymentStatuses.length,
    paymentMethods.length,
  ])

  const fetchDocumentStatusItems = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      const options =
        documentStatuses.length && !query ? documentStatuses : await loadDocumentStatuses()
      const term = query?.trim().toLowerCase() ?? ''
      return options
        .filter(
          (option) =>
            !term.length ||
            option.label.toLowerCase().includes(term) ||
            option.value.toLowerCase().includes(term),
        )
        .map<LookupSelectItem>((option) => ({
          id: option.id,
          title: option.label,
          subtitle: option.value,
          icon: renderStatusIcon(option.color),
        }))
    },
    [documentStatuses, loadDocumentStatuses, renderStatusIcon],
  )

  const fetchPaymentStatusItems = React.useCallback(
    async (query?: string): Promise<LookupSelectItem[]> => {
      const options =
        paymentStatuses.length && !query ? paymentStatuses : await loadPaymentStatuses()
      const term = query?.trim().toLowerCase() ?? ''
      return options
        .filter(
          (option) =>
            !term.length ||
            option.label.toLowerCase().includes(term) ||
            option.value.toLowerCase().includes(term),
        )
        .map<LookupSelectItem>((option) => ({
          id: option.id,
          title: option.label,
          subtitle: option.value,
          icon: renderStatusIcon(option.color),
        }))
    },
    [loadPaymentStatuses, paymentStatuses, renderStatusIcon],
  )

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'amount',
        label: t('sales.documents.payments.amount', 'Amount'),
        type: 'custom',
        required: true,
        component: ({ value, setValue }) => {
          const normalized = typeof value === 'number' ? value : typeof value === 'string' ? value : ''
          return (
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={normalized as string | number}
                onChange={(event) => setValue(event.target.value)}
                placeholder="0.00"
              />
              <span className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs font-semibold uppercase text-foreground">
                {currencyLabel}
              </span>
            </div>
          )
        },
      },
      {
        id: 'paymentMethodId',
        label: t('sales.documents.payments.method', 'Method'),
        type: 'custom',
        component: ({ value, setValue }) => {
          const currentValue = typeof value === 'string' && value.length ? value : null
          return (
            <LookupSelect
              value={currentValue}
              onChange={(next) => setValue(next ?? '')}
              fetchItems={fetchPaymentMethodItems}
              searchPlaceholder={t('sales.documents.payments.methodPlaceholder', 'Search payment method')}
              emptyLabel={t('sales.documents.payments.methodsEmpty', 'No payment methods')}
              loadingLabel={t('sales.documents.payments.loadingMethods', 'Loading payment methods…')}
              selectedHintLabel={(id) =>
                t('sales.documents.payments.methodSelected', 'Selected method: {{id}}', { id })
              }
              minQuery={0}
            />
          )
        },
      },
      {
        id: 'statusEntryId',
        label: t('sales.documents.payments.status', 'Status'),
        type: 'custom',
        component: ({ value, setValue }) => {
          const currentValue = typeof value === 'string' && value.length ? value : null
          return (
            <LookupSelect
              value={currentValue}
              onChange={(next) => setValue(next ?? '')}
              fetchItems={fetchPaymentStatusItems}
              placeholder={t('sales.documents.payments.statusPlaceholder', 'Select status')}
              loading={paymentStatusLoading}
              minQuery={0}
            />
          )
        },
      },
      ...(mode === 'create'
        ? ([
            {
              id: 'documentStatusEntryId',
              label: t('sales.documents.status.changeDocument', 'Change order/quote status'),
              type: 'custom',
              component: ({ value, setValue }) => {
                const currentValue = typeof value === 'string' && value.length ? value : null
                return (
                  <LookupSelect
                    value={currentValue}
                    onChange={(next) => setValue(next ?? '')}
                    fetchItems={fetchDocumentStatusItems}
                    placeholder={t(
                      'sales.documents.status.documentPlaceholder',
                      'Select new order/quote status',
                    )}
                    loading={documentStatusLoading}
                    minQuery={0}
                  />
                )
              },
            },
          ] as CrudField[])
        : []),
      {
        id: 'paymentReference',
        label: t('sales.documents.payments.reference', 'Reference'),
        type: 'text',
        placeholder: t('sales.documents.payments.referencePlaceholder', 'External reference or note'),
      },
      {
        id: 'receivedAt',
        label: t('sales.documents.payments.receivedAt', 'Received at'),
        type: 'date',
      },
    ],
    [
      currencyLabel,
      documentStatusLoading,
      fetchPaymentStatusItems,
      fetchDocumentStatusItems,
      fetchPaymentMethodItems,
      paymentStatusLoading,
      mode,
      t,
    ],
  )

  const groups = React.useMemo<CrudFormGroup[]>(
    () => {
      const base: CrudFormGroup[] = [
        {
          id: 'paymentDetails',
          title: t('sales.documents.payments.form.title', 'Payment details'),
          column: 1,
          fields: ['amount', 'paymentMethodId', 'statusEntryId', 'paymentReference', 'receivedAt'],
        },
      ]
      if (mode === 'create') {
        base.push({
          id: 'statusChanges',
          title: t('sales.documents.status.sectionTitle', 'Status changes'),
          column: 1,
          fields: ['documentStatusEntryId'],
        })
      }
      base.push({
        id: 'paymentCustomFields',
        title: t('entities.customFields.title', 'Custom fields'),
        column: 2,
        kind: 'customFields',
      })
      return base
    },
    [mode, t],
  )

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      const resolvedCurrency = currencyCode ? currencyCode.toUpperCase() : ''
      const amountValue = normalizeNumber(values.amount)
      if (!resolvedCurrency.trim()) {
        throw createCrudFormError(t('sales.documents.payments.currencyRequired', 'Currency is required.'))
      }
      if (amountValue <= 0) {
        throw createCrudFormError(t('sales.documents.payments.amountRequired', 'Enter a positive amount.'), {
          amount: t('sales.documents.payments.amountRequired', 'Enter a positive amount.'),
        })
      }

      const payload: Record<string, unknown> = {
        orderId,
        amount: amountValue,
        currencyCode: resolvedCurrency,
        paymentReference:
          typeof values.paymentReference === 'string' && values.paymentReference.trim().length
            ? values.paymentReference.trim()
            : undefined,
        paymentMethodId:
          typeof values.paymentMethodId === 'string' && values.paymentMethodId.trim().length
            ? values.paymentMethodId
            : undefined,
        statusEntryId:
          typeof values.statusEntryId === 'string' && values.statusEntryId.trim().length
            ? values.statusEntryId
            : undefined,
        organizationId: organizationId ?? undefined,
        tenantId: tenantId ?? undefined,
      }
      const documentStatusEntryId =
        typeof values.documentStatusEntryId === 'string' && values.documentStatusEntryId.trim().length
          ? values.documentStatusEntryId
          : null
      if (documentStatusEntryId) {
        payload.documentStatusEntryId = documentStatusEntryId
      }
      if (typeof values.receivedAt === 'string' && values.receivedAt.trim().length) {
        payload.receivedAt = new Date(values.receivedAt)
      }
      const customFields = collectCustomFieldValues(values, {
        transform: normalizeCustomFieldSubmitValue,
      })
      if (Object.keys(customFields).length) payload.customFields = customFields

      const action = payment?.id ? updateCrud : createCrud
      const result = await action(
        'sales/payments',
        payment?.id ? { id: payment.id, ...payload } : payload,
        {
          errorMessage: t('sales.documents.payments.errorSave', 'Failed to save payment.'),
        }
      )
      if (result.ok) {
        const totals = (result.result as any)?.orderTotals as PaymentTotals | undefined
        if (onSaved) {
          await onSaved(totals ?? null)
        }
        setFormResetKey((prev) => prev + 1)
        onOpenChange(false)
      }
    },
    [currencyCode, mode, onOpenChange, onSaved, orderId, organizationId, payment?.id, t, tenantId]
  )

  const handleShortcutSubmit = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        const form = dialogContentRef.current?.querySelector('form')
        form?.requestSubmit()
      }
    },
    []
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={dialogContentRef}
        className="sm:max-w-5xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onOpenChange(false)
          }
          handleShortcutSubmit(event)
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit'
              ? t('sales.documents.payments.edit', 'Edit payment')
              : t('sales.documents.payments.add', 'Add payment')}
          </DialogTitle>
        </DialogHeader>
        <CrudForm
          key={formResetKey}
          embedded
          entityId={E.sales.sales_payment}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={shortcutLabel}
          onSubmit={handleSubmit}
          loadingMessage={t('sales.documents.payments.loading', 'Loading payments…')}
          customFieldsLoadingMessage={t('ui.forms.loading', 'Loading data...')}
          contentHeader={
            methodsLoading ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner className="h-3.5 w-3.5 animate-spin" />
                {t('sales.documents.payments.loadingMethods', 'Loading payment methods…')}
              </p>
            ) : null
          }
        />
      </DialogContent>
    </Dialog>
  )
}
