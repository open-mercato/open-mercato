"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  useCustomerOptions,
  useSalesChannelOptions,
  type FreightCustomerSnapshot,
} from './freightOptions'
import type { FreightContractRow } from './FreightContractsTable'
import { LIST_HREF } from './contractListMeta'
import { BILLING_CYCLE_FALLBACKS, BILLING_CYCLE_VALUES } from '../lib/freightEnums'

// Literal on purpose: a client bundle must not import the command module
// (entities, ORM decorators) just to read an entity id.
const ENTITY_ID = 'freight_operations:freight_contract'
const RESOURCE = 'freight_operations/contracts'

export type ContractFormValues = {
  id: string
  customerId: string
  title: string
  validFrom: string
  validTo: string
  billingCycle: string
  paymentTermsDays: string
  currencyCode: string
  vatRate: string
  requiresCustomerApproval: boolean
  salesChannelId: string
  signedAt: string
  notes: string
  updatedAt?: string | null
}

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return ''
  return value.slice(0, 10)
}

export function toContractFormValues(row: FreightContractRow): ContractFormValues {
  return {
    id: row.id,
    customerId: row.customer_id ?? '',
    title: textOf(row.title),
    validFrom: dateOnly(row.valid_from),
    validTo: dateOnly(row.valid_to),
    billingCycle: textOf(row.billing_cycle) || 'monthly',
    paymentTermsDays: textOf(row.payment_terms_days ?? ''),
    currencyCode: textOf(row.currency_code) || 'SAR',
    vatRate: textOf(row.vat_rate) || '15',
    requiresCustomerApproval: Boolean(row.requires_customer_approval),
    salesChannelId: textOf((row as unknown as Record<string, unknown>).sales_channel_id),
    signedAt: dateOnly((row as unknown as Record<string, unknown>).signed_at as string | null),
    notes: textOf(row.notes),
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildContractFormDefaults(id = ''): ContractFormValues {
  const today = new Date()
  const inAYear = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000)
  return {
    id,
    customerId: '',
    title: '',
    validFrom: today.toISOString().slice(0, 10),
    validTo: inAYear.toISOString().slice(0, 10),
    billingCycle: 'monthly',
    paymentTermsDays: '30',
    currencyCode: 'SAR',
    vatRate: '15',
    requiresCustomerApproval: true,
    salesChannelId: '',
    signedAt: '',
    notes: '',
    updatedAt: null,
  }
}

function optional(value: string): string | null {
  return value && value.trim().length ? value.trim() : null
}

/**
 * The API requires the billing party's snapshot alongside its id — the snapshot
 * is what the invoice keeps if the CRM record changes. The picker is the only
 * place that data exists on the client, so a submit without it is refused here
 * with a field-level error rather than a raw validation failure from the server.
 */
export function toContractPayload(
  values: ContractFormValues,
  snapshot: FreightCustomerSnapshot | null,
  t: (key: string, fallback: string) => string,
): Record<string, unknown> {
  if (!snapshot) {
    throw createCrudFormError(t('freight_operations.contracts.form.error.customerMissing', 'Choose a customer from the list.'))
  }
  return {
    customerId: values.customerId,
    customerSnapshot: snapshot,
    title: values.title.trim(),
    validFrom: values.validFrom,
    validTo: values.validTo,
    billingCycle: values.billingCycle || 'monthly',
    paymentTermsDays: optional(values.paymentTermsDays) ?? '30',
    currencyCode: optional(values.currencyCode) ?? 'SAR',
    vatRate: optional(values.vatRate) ?? '15',
    requiresCustomerApproval: values.requiresCustomerApproval,
    salesChannelId: optional(values.salesChannelId),
    signedAt: values.signedAt ? `${values.signedAt}T00:00:00.000Z` : null,
    notes: optional(values.notes),
  }
}

type Translate = ReturnType<typeof useT>

function useContractFields(
  t: Translate,
  customerOptions: Array<{ value: string; label: string }>,
  channelOptions: Array<{ value: string; label: string }>,
): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'customerId',
      label: t('freight_operations.contracts.form.fields.customer', 'Customer'),
      type: 'select',
      required: true,
      options: customerOptions,
    },
    {
      id: 'title',
      label: t('freight_operations.contracts.form.fields.title', 'Title'),
      type: 'text',
      required: true,
    },
    {
      id: 'validFrom',
      label: t('freight_operations.contracts.form.fields.validFrom', 'Valid from'),
      type: 'date',
      required: true,
      layout: 'half',
    },
    {
      id: 'validTo',
      label: t('freight_operations.contracts.form.fields.validTo', 'Valid to'),
      type: 'date',
      required: true,
      layout: 'half',
    },
    {
      id: 'billingCycle',
      label: t('freight_operations.contracts.form.fields.billingCycle', 'Billing cycle'),
      type: 'select',
      layout: 'half',
      options: BILLING_CYCLE_VALUES.map((value) => ({
        value,
        label: t(`freight_operations.contracts.cycle.${value}`, BILLING_CYCLE_FALLBACKS[value] ?? value),
      })),
    },
    {
      id: 'paymentTermsDays',
      label: t('freight_operations.contracts.form.fields.paymentTerms', 'Payment terms (days)'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'currencyCode',
      label: t('freight_operations.contracts.form.fields.currency', 'Currency'),
      type: 'text',
      layout: 'third',
    },
    {
      id: 'vatRate',
      label: t('freight_operations.contracts.form.fields.vatRate', 'VAT rate (%)'),
      type: 'number',
      layout: 'third',
    },
    {
      id: 'signedAt',
      label: t('freight_operations.contracts.form.fields.signedAt', 'Signed on'),
      type: 'date',
      layout: 'third',
    },
    {
      id: 'requiresCustomerApproval',
      label: t('freight_operations.contracts.form.fields.requiresApproval', 'Abstracts need customer approval'),
      type: 'checkbox',
      layout: 'half',
    },
    {
      id: 'salesChannelId',
      label: t('freight_operations.contracts.form.fields.salesChannel', 'Sales channel'),
      type: channelOptions.length ? 'select' : 'text',
      layout: 'half',
      options: channelOptions.length ? channelOptions : undefined,
      placeholder: channelOptions.length ? undefined : t('freight_operations.contracts.form.fields.salesChannelPlaceholder', 'Channel id (optional)'),
    },
    {
      id: 'notes',
      label: t('freight_operations.contracts.form.fields.notes', 'Notes'),
      type: 'textarea',
    },
  ], [channelOptions, customerOptions, t])
}

function useContractGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'customer',
      title: t('freight_operations.contracts.form.groups.customer', 'Customer'),
      column: 1,
      fields: ['customerId', 'title'],
    },
    {
      id: 'validity',
      title: t('freight_operations.contracts.form.groups.validity', 'Validity and billing'),
      column: 2,
      fields: ['validFrom', 'validTo', 'billingCycle', 'paymentTermsDays'],
    },
    {
      id: 'billing',
      title: t('freight_operations.contracts.form.groups.billing', 'Pricing and approvals'),
      column: 1,
      fields: ['currencyCode', 'vatRate', 'signedAt', 'requiresCustomerApproval', 'salesChannelId'],
    },
    {
      id: 'notes',
      title: t('freight_operations.contracts.form.groups.notes', 'Notes'),
      column: 2,
      fields: ['notes'],
    },
  ], [t])
}

export function ContractCreateForm() {
  const t = useT()
  const { options: customerOptions, toSnapshot } = useCustomerOptions()
  const channelOptions = useSalesChannelOptions()
  const fields = useContractFields(t, customerOptions, channelOptions)
  const groups = useContractGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('freight_operations.contracts.form.flash.saved', 'Contract saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<ContractFormValues>
      title={t('freight_operations.contracts.form.create.title', 'New freight contract')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildContractFormDefaults()}
      submitLabel={t('freight_operations.contracts.form.create.submit', 'Create contract')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toContractPayload(values, toSnapshot(values.customerId), t))
      }}
    />
  )
}

export function ContractEditForm({ id }: { id: string }) {
  const t = useT()
  const { options: customerOptions, toSnapshot } = useCustomerOptions()
  const channelOptions = useSalesChannelOptions()
  const fields = useContractFields(t, customerOptions, channelOptions)
  const groups = useContractGroups(t)
  const [initial, setInitial] = React.useState<ContractFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [lockedMessage, setLockedMessage] = React.useState<string | null>(null)
  const [deletable, setDeletable] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await fetchCrudList<FreightContractRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) {
          setDeletable(item.status === 'draft')
          if (item.status === 'terminated') {
            setLockedMessage(t('freight_operations.contracts.form.error.terminated', 'A terminated contract cannot be edited.'))
          }
          setInitial(toContractFormValues(item))
        }
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('freight_operations.contracts.form.error.load', 'Could not load the contract.'))
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
    () => withFlash(LIST_HREF, t('freight_operations.contracts.form.flash.saved', 'Contract saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('freight_operations.contracts.form.flash.deleted', 'Contract deleted.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('freight_operations.contracts.form.error.notFound', 'Contract not found.')}
        backHref={LIST_HREF}
        backLabel={t('freight_operations.contracts.actions.backToList', 'Back to contracts')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  const locked = Boolean(lockedMessage)

  return (
    <CrudForm<ContractFormValues>
      title={t('freight_operations.contracts.form.edit.title', 'Edit freight contract')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildContractFormDefaults(id)}
      submitLabel={t('freight_operations.contracts.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('freight_operations.contracts.form.loading', 'Loading contract…')}
      readOnly={locked}
      readOnlyOverlay={lockedMessage ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">{lockedMessage}</div>
      ) : undefined}
      disableOptimisticLock={locked}
      onSubmit={async (values) => {
        await updateCrud(RESOURCE, { id, ...toContractPayload(values, toSnapshot(values.customerId), t) })
      }}
      onDelete={deletable ? async () => { await deleteCrud(RESOURCE, id) } : undefined}
    />
  )
}
