"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  PAYMENT_METHOD_KIND_FALLBACKS,
  PAYMENT_METHOD_KINDS,
  loadAssetAccountOptions,
  resolveAccountLabel,
  type PaymentMethodKind,
  type PaymentMethodRow,
} from './PaymentMethodsTable'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'financial:gl_payment_method'
const LIST_HREF = '/backend/financial/payment-methods'
const RESOURCE = 'financial/payment-methods'

export type PaymentMethodFormValues = {
  id: string
  code: string
  name: string
  kind: PaymentMethodKind
  accountId: string
  requiresReference: boolean
  isDefault: boolean
  isActive: boolean
  sortOrder: number
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version header
  // from `initialValues.updatedAt` for update.
  updatedAt?: string | null
}

export function toPaymentMethodFormValues(row: PaymentMethodRow): PaymentMethodFormValues {
  return {
    id: row.id,
    code: row.code ?? '',
    name: row.name ?? '',
    kind: row.kind ?? 'other',
    accountId: row.account_id ?? '',
    requiresReference: row.requires_reference === true,
    isDefault: row.is_default === true,
    isActive: row.is_active !== false,
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildPaymentMethodFormDefaults(id = ''): PaymentMethodFormValues {
  return {
    id,
    code: '',
    name: '',
    kind: 'other',
    accountId: '',
    requiresReference: false,
    isDefault: false,
    isActive: true,
    sortOrder: 0,
    updatedAt: null,
  }
}

export function toPaymentMethodPayload(values: PaymentMethodFormValues): Record<string, unknown> {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    kind: values.kind ? values.kind : 'other',
    accountId: values.accountId.trim(),
    requiresReference: values.requiresReference === true,
    isDefault: values.isDefault === true,
    isActive: values.isActive !== false,
    sortOrder: typeof values.sortOrder === 'number' && Number.isFinite(values.sortOrder) ? values.sortOrder : 0,
  }
}

type Translate = ReturnType<typeof useT>

function usePaymentMethodFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'code', label: t('financial.paymentMethods.form.fields.code', 'Code'), type: 'text', required: true, layout: 'half' },
    { id: 'name', label: t('financial.paymentMethods.form.fields.name', 'Name'), type: 'text', required: true, layout: 'half' },
    {
      id: 'kind',
      label: t('financial.paymentMethods.form.fields.kind', 'Kind'),
      type: 'select',
      layout: 'half',
      options: PAYMENT_METHOD_KINDS.map((value) => ({
        value,
        label: t(`financial.paymentMethods.kind.${value}`, PAYMENT_METHOD_KIND_FALLBACKS[value]),
      })),
    },
    {
      id: 'accountId',
      label: t('financial.paymentMethods.form.fields.account', 'GL account'),
      type: 'combobox',
      required: true,
      layout: 'half',
      placeholder: t('financial.paymentMethods.form.fields.accountPlaceholder', 'Search asset accounts'),
      description: t('financial.paymentMethods.form.fields.accountHint', 'Payments made this way post their cash side to this asset account.'),
      loadOptions: loadAssetAccountOptions,
      resolveLabel: resolveAccountLabel,
      allowCustomValues: false,
    },
    { id: 'sortOrder', label: t('financial.paymentMethods.form.fields.sortOrder', 'Sort order'), type: 'number', layout: 'half' },
    {
      id: 'requiresReference',
      label: t('financial.paymentMethods.form.fields.requiresReference', 'Requires a reference'),
      type: 'checkbox',
      description: t('financial.paymentMethods.form.fields.requiresReferenceHint', 'A cheque or a transfer carries a reference; cash does not.'),
    },
    { id: 'isDefault', label: t('financial.paymentMethods.form.fields.isDefault', 'Default method'), type: 'checkbox' },
    { id: 'isActive', label: t('financial.paymentMethods.form.fields.isActive', 'Active'), type: 'checkbox' },
  ], [t])
}

function usePaymentMethodGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'identification',
      title: t('financial.paymentMethods.form.groups.identification', 'Identification'),
      column: 1,
      fields: ['code', 'name', 'kind'],
    },
    {
      id: 'posting',
      title: t('financial.paymentMethods.form.groups.posting', 'Posting and behaviour'),
      column: 1,
      fields: ['accountId', 'sortOrder', 'requiresReference', 'isDefault', 'isActive'],
    },
  ], [t])
}

export function PaymentMethodCreateForm() {
  const t = useT()
  const fields = usePaymentMethodFields(t)
  const groups = usePaymentMethodGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('financial.paymentMethods.form.flash.created', 'Payment method created.'), 'success'),
    [t],
  )

  return (
    <CrudForm<PaymentMethodFormValues>
      title={t('financial.paymentMethods.form.create.title', 'New payment method')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildPaymentMethodFormDefaults()}
      submitLabel={t('financial.paymentMethods.form.create.submit', 'Create payment method')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toPaymentMethodPayload(values))
      }}
    />
  )
}

export function PaymentMethodEditForm({ id }: { id: string }) {
  const t = useT()
  const fields = usePaymentMethodFields(t)
  const groups = usePaymentMethodGroups(t)
  const [initial, setInitial] = React.useState<PaymentMethodFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await fetchCrudList<PaymentMethodRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toPaymentMethodFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('financial.paymentMethods.form.error.load', 'Could not load the payment method.'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('financial.paymentMethods.form.flash.saved', 'Payment method saved.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('financial.paymentMethods.form.error.notFound', 'Payment method not found.')}
        backHref={LIST_HREF}
        backLabel={t('financial.paymentMethods.actions.backToList', 'Back to payment methods')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<PaymentMethodFormValues>
      title={t('financial.paymentMethods.form.edit.title', 'Edit payment method')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildPaymentMethodFormDefaults(id)}
      submitLabel={t('financial.paymentMethods.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      loadingMessage={t('financial.paymentMethods.form.loading', 'Loading payment method…')}
      onSubmit={async (values) => {
        // `id` belongs in the body: the route has no id segment and the update schema requires it.
        await updateCrud(RESOURCE, { id, ...toPaymentMethodPayload(values) })
      }}
    />
  )
}
