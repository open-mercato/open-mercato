"use client"

import * as React from 'react'
import Link from 'next/link'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

type DocumentKind = 'quote' | 'order'

type AddressDraft = {
  name?: string
  companyName?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
}

type CustomerOption = {
  id: string
  label: string
  subtitle?: string | null
}

type ChannelOption = { id: string; label: string }

type AddressOption = { id: string; label: string }

export type SalesDocumentFormValues = {
  documentKind: DocumentKind
  currencyCode: string
  channelId?: string | null
  customerEntityId?: string | null
  customerEmail?: string | null
  shippingAddressId?: string | null
  billingAddressId?: string | null
  useCustomShipping?: boolean
  useCustomBilling?: boolean
  saveShippingAddress?: boolean
  saveBillingAddress?: boolean
  shippingAddressDraft?: AddressDraft
  billingAddressDraft?: AddressDraft
  comments?: string | null
} & Record<string, unknown>

type SalesDocumentFormProps = {
  onCreated: (params: { id: string; kind: DocumentKind }) => void
  isSubmitting?: boolean
}

function parseCustomerOptions(items: unknown[], kind: 'person' | 'company'): CustomerOption[] {
  return items
    .map((item) => {
      if (typeof item !== 'object' || item === null) return null
      const record = item as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id : null
      if (!id) return null
      const displayName =
        typeof record.display_name === 'string'
          ? record.display_name
          : typeof record.name === 'string'
            ? record.name
            : null
      const email = typeof record.primary_email === 'string' ? record.primary_email : null
      const domain = typeof record.primary_domain === 'string' ? record.primary_domain : null
      const label = displayName ?? (email ?? domain ?? id)
      const subtitle = kind === 'person' ? email : domain ?? email
      return { id, label: `${label}`, subtitle }
    })
    .filter((entry): entry is CustomerOption => !!entry?.id)
}

function normalizeAddressDraft(draft?: AddressDraft | null): Record<string, unknown> | null {
  if (!draft) return null
  const normalized: Record<string, unknown> = {}
  const assign = (key: keyof AddressDraft, target: string) => {
    const value = draft[key]
    if (typeof value === 'string' && value.trim().length) normalized[target] = value.trim()
  }
  assign('name', 'name')
  assign('companyName', 'companyName')
  assign('addressLine1', 'addressLine1')
  assign('addressLine2', 'addressLine2')
  assign('city', 'city')
  assign('region', 'region')
  assign('postalCode', 'postalCode')
  assign('country', 'country')
  return Object.keys(normalized).length ? normalized : null
}

export function SalesDocumentForm({ onCreated, isSubmitting = false }: SalesDocumentFormProps) {
  const t = useT()
  const [customers, setCustomers] = React.useState<CustomerOption[]>([])
  const [customerLoading, setCustomerLoading] = React.useState(false)
  const [channels, setChannels] = React.useState<ChannelOption[]>([])
  const [channelLoading, setChannelLoading] = React.useState(false)
  const [addressOptions, setAddressOptions] = React.useState<AddressOption[]>([])
  const [addressesLoading, setAddressesLoading] = React.useState(false)

  const loadCustomers = React.useCallback(async (query?: string) => {
    setCustomerLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '20' })
      if (query && query.trim().length) params.set('search', query.trim())
      const [people, companies] = await Promise.all([
        apiCall<{ items?: unknown[] }>(`/api/customers/people?${params.toString()}`),
        apiCall<{ items?: unknown[] }>(`/api/customers/companies?${params.toString()}`),
      ])
      const peopleItems = Array.isArray(people.result?.items) ? people.result?.items ?? [] : []
      const companyItems = Array.isArray(companies.result?.items) ? companies.result?.items ?? [] : []
      const merged = [...parseCustomerOptions(peopleItems, 'person'), ...parseCustomerOptions(companyItems, 'company')]
      setCustomers(merged)
    } catch (err) {
      console.error('sales.documents.loadCustomers', err)
      flash(t('sales.documents.form.errors.customers', 'Failed to load customers.'), 'error')
    } finally {
      setCustomerLoading(false)
    }
  }, [t])

  const loadChannels = React.useCallback(async () => {
    setChannelLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '50' })
      const call = await apiCall<{ items?: Array<{ id?: string; name?: string; code?: string | null }> }>(
        `/api/sales/channels?${params.toString()}`
      )
      if (call.ok && Array.isArray(call.result?.items)) {
        const options = call.result.items
          .map((item) => {
            const id = typeof item?.id === 'string' ? item.id : null
            if (!id) return null
            const label = typeof item?.name === 'string' && item.name.trim().length ? item.name : id
            const code = typeof item?.code === 'string' && item.code.trim().length ? item.code : null
            return { id, label: code ? `${label} (${code})` : label }
          })
          .filter((opt): opt is ChannelOption => !!opt)
        setChannels(options)
      } else {
        setChannels([])
      }
    } catch (err) {
      console.error('sales.documents.loadChannels', err)
      setChannels([])
    } finally {
      setChannelLoading(false)
    }
  }, [])

  const loadAddresses = React.useCallback(async (customerId?: string | null) => {
    if (!customerId) {
      setAddressOptions([])
      return
    }
    setAddressesLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '50', entityId: customerId })
      const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/customers/addresses?${params.toString()}`
      )
      if (call.ok && Array.isArray(call.result?.items)) {
        const options = call.result.items
          .map((item) => {
            const id = typeof item.id === 'string' ? item.id : null
            if (!id) return null
            const name = typeof item.name === 'string' ? item.name : null
            const line1 = typeof item.address_line1 === 'string' ? item.address_line1 : null
            const label = name ?? line1 ?? id
            return { id, label }
          })
          .filter((opt): opt is AddressOption => !!opt)
        setAddressOptions(options)
      } else {
        setAddressOptions([])
      }
    } catch (err) {
      console.error('sales.documents.loadAddresses', err)
      setAddressOptions([])
    } finally {
      setAddressesLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadCustomers().catch(() => {})
    loadChannels().catch(() => {})
  }, [loadChannels, loadCustomers])

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'documentKind',
      label: t('sales.documents.form.kind', 'Document type'),
      type: 'custom',
      required: true,
      component: ({ value, setValue }) => {
        const current = value === 'order' ? 'order' : 'quote'
        return (
          <div className="flex gap-3">
            {(['quote', 'order'] as DocumentKind[]).map((kind) => (
              <Button
                key={kind}
                type="button"
                variant={current === kind ? 'default' : 'outline'}
                onClick={() => setValue(kind)}
                className="capitalize"
              >
                {kind}
              </Button>
            ))}
          </div>
        )
      },
    },
    {
      id: 'currencyCode',
      label: t('sales.documents.form.currency', 'Currency'),
      type: 'text',
      required: true,
      placeholder: 'USD',
    },
    {
      id: 'channelId',
      label: t('sales.documents.form.channel', 'Sales channel'),
      type: 'custom',
      description: t('sales.documents.form.channel.help', 'Optional. Only for orders.'),
      component: ({ value, setValue, values }) => {
        const isOrder = values?.documentKind === 'order'
        if (!isOrder) {
          return <div className="text-sm text-muted-foreground">{t('sales.documents.form.channel.skip', 'Channel only applies to orders.')}</div>
        }
        return (
          <select
            className="w-full rounded border px-2 py-2 text-sm"
            value={typeof value === 'string' ? value : ''}
            onChange={(evt) => setValue(evt.target.value || null)}
            disabled={channelLoading}
          >
            <option value="">{t('sales.documents.form.channel.placeholder', 'Select a channel')}</option>
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>{channel.label}</option>
            ))}
          </select>
        )
      },
    },
    {
      id: 'customerEntityId',
      label: t('sales.documents.form.customer', 'Customer'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              className="w-full rounded border px-2 py-2 text-sm"
              list="sales-document-customers"
              value={typeof value === 'string' ? value : ''}
              onChange={(evt) => {
                const next = evt.target.value || null
                setValue(next)
                loadAddresses(next)
                loadCustomers(evt.target.value)
              }}
              placeholder={t('sales.documents.form.customer.placeholder', 'Select or paste customer id')}
            />
            <Button asChild size="sm" variant="outline">
              <Link href="/backend/customers/people/create" target="_blank" rel="noreferrer">
                {t('sales.documents.form.customer.addPerson', 'New person')}
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/backend/customers/companies/create" target="_blank" rel="noreferrer">
                {t('sales.documents.form.customer.addCompany', 'New company')}
              </Link>
            </Button>
          </div>
          <datalist id="sales-document-customers">
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.label}{customer.subtitle ? ` • ${customer.subtitle}` : ''}</option>
            ))}
          </datalist>
          <div className="text-xs text-muted-foreground">
            {customerLoading
              ? t('sales.documents.form.customer.loading', 'Loading customers…')
              : t('sales.documents.form.customer.help', 'Start typing to filter.')}
          </div>
        </div>
      ),
    },
    {
      id: 'customerEmail',
      label: t('sales.documents.form.email', 'Customer email'),
      type: 'text',
      placeholder: t('sales.documents.form.email.placeholder', 'Email used for the document'),
    },
    {
      id: 'shippingAddressSection',
      label: t('sales.documents.form.shipping.title', 'Shipping address'),
      type: 'custom',
      component: ({ values, setValue }) => {
        const useCustom = values?.useCustomShipping === true
        const selectedId = typeof values?.shippingAddressId === 'string' ? values.shippingAddressId : ''
        const draft = (values?.shippingAddressDraft ?? {}) as AddressDraft
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useCustom}
                  onChange={(evt) => setValue('useCustomShipping', evt.target.checked)}
                />
                {t('sales.documents.form.shipping.custom', 'Define new address')}
              </label>
              {!useCustom ? (
                <select
                  className="w-full rounded border px-2 py-2 text-sm"
                  value={selectedId}
                  onChange={(evt) => setValue('shippingAddressId', evt.target.value || null)}
                  disabled={addressesLoading || !addressOptions.length}
                >
                  <option value="">{addressesLoading ? t('sales.documents.form.address.loading', 'Loading addresses…') : t('sales.documents.form.address.placeholder', 'Select address')}</option>
                  {addressOptions.map((addr) => (
                    <option key={addr.id} value={addr.id}>{addr.label}</option>
                  ))}
                </select>
              ) : null}
            </div>
            {useCustom ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder={t('sales.documents.form.address.name', 'Full name')}
                  value={draft.name ?? ''}
                  onChange={(evt) => setValue('shippingAddressDraft', { ...draft, name: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.company', 'Company (optional)')}
                  value={draft.companyName ?? ''}
                  onChange={(evt) => setValue('shippingAddressDraft', { ...draft, companyName: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.line1', 'Address line 1')}
                  className="sm:col-span-2"
                  value={draft.addressLine1 ?? ''}
                  onChange={(evt) => setValue('shippingAddressDraft', { ...draft, addressLine1: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.line2', 'Address line 2')}
                  className="sm:col-span-2"
                  value={draft.addressLine2 ?? ''}
                  onChange={(evt) => setValue('shippingAddressDraft', { ...draft, addressLine2: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.city', 'City')}
                  value={draft.city ?? ''}
                  onChange={(evt) => setValue('shippingAddressDraft', { ...draft, city: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.region', 'Region/state')}
                  value={draft.region ?? ''}
                  onChange={(evt) => setValue('shippingAddressDraft', { ...draft, region: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.postal', 'Postal code')}
                  value={draft.postalCode ?? ''}
                  onChange={(evt) => setValue('shippingAddressDraft', { ...draft, postalCode: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.country', 'Country')}
                  value={draft.country ?? ''}
                  onChange={(evt) => setValue('shippingAddressDraft', { ...draft, country: evt.target.value })}
                />
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={values?.saveShippingAddress === true}
                    onChange={(evt) => setValue('saveShippingAddress', evt.target.checked)}
                  />
                  {t('sales.documents.form.address.saveToCustomer', 'Save this address to the customer')}
                </label>
              </div>
            ) : null}
          </div>
        )
      },
    },
    {
      id: 'billingAddressSection',
      label: t('sales.documents.form.billing.title', 'Billing address'),
      type: 'custom',
      component: ({ values, setValue }) => {
        const useCustom = values?.useCustomBilling === true
        const selectedId = typeof values?.billingAddressId === 'string' ? values.billingAddressId : ''
        const draft = (values?.billingAddressDraft ?? {}) as AddressDraft
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useCustom}
                  onChange={(evt) => setValue('useCustomBilling', evt.target.checked)}
                />
                {t('sales.documents.form.shipping.custom', 'Define new address')}
              </label>
              {!useCustom ? (
                <select
                  className="w-full rounded border px-2 py-2 text-sm"
                  value={selectedId}
                  onChange={(evt) => setValue('billingAddressId', evt.target.value || null)}
                  disabled={addressesLoading || !addressOptions.length}
                >
                  <option value="">{addressesLoading ? t('sales.documents.form.address.loading', 'Loading addresses…') : t('sales.documents.form.address.placeholder', 'Select address')}</option>
                  {addressOptions.map((addr) => (
                    <option key={addr.id} value={addr.id}>{addr.label}</option>
                  ))}
                </select>
              ) : null}
            </div>
            {useCustom ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder={t('sales.documents.form.address.name', 'Full name')}
                  value={draft.name ?? ''}
                  onChange={(evt) => setValue('billingAddressDraft', { ...draft, name: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.company', 'Company (optional)')}
                  value={draft.companyName ?? ''}
                  onChange={(evt) => setValue('billingAddressDraft', { ...draft, companyName: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.line1', 'Address line 1')}
                  className="sm:col-span-2"
                  value={draft.addressLine1 ?? ''}
                  onChange={(evt) => setValue('billingAddressDraft', { ...draft, addressLine1: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.line2', 'Address line 2')}
                  className="sm:col-span-2"
                  value={draft.addressLine2 ?? ''}
                  onChange={(evt) => setValue('billingAddressDraft', { ...draft, addressLine2: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.city', 'City')}
                  value={draft.city ?? ''}
                  onChange={(evt) => setValue('billingAddressDraft', { ...draft, city: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.region', 'Region/state')}
                  value={draft.region ?? ''}
                  onChange={(evt) => setValue('billingAddressDraft', { ...draft, region: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.postal', 'Postal code')}
                  value={draft.postalCode ?? ''}
                  onChange={(evt) => setValue('billingAddressDraft', { ...draft, postalCode: evt.target.value })}
                />
                <Input
                  placeholder={t('sales.documents.form.address.country', 'Country')}
                  value={draft.country ?? ''}
                  onChange={(evt) => setValue('billingAddressDraft', { ...draft, country: evt.target.value })}
                />
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={values?.saveBillingAddress === true}
                    onChange={(evt) => setValue('saveBillingAddress', evt.target.checked)}
                  />
                  {t('sales.documents.form.address.saveToCustomer', 'Save this address to the customer')}
                </label>
              </div>
            ) : null}
          </div>
        )
      },
    },
    {
      id: 'comments',
      label: t('sales.documents.form.comments', 'Comments'),
      type: 'textarea',
    },
  ], [addressOptions, addressesLoading, channelLoading, channels, customerLoading, customers, loadAddresses, loadCustomers, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'details', title: t('sales.documents.form.details', 'Document details'), column: 1, fields: ['documentKind', 'currencyCode', 'channelId', 'comments'] },
    { id: 'customer', title: t('sales.documents.form.customer.group', 'Customer'), column: 1, fields: ['customerEntityId', 'customerEmail'] },
    { id: 'addresses', title: t('sales.documents.form.addresses', 'Addresses'), column: 2, fields: ['shippingAddressSection', 'billingAddressSection'] },
    { id: 'custom', title: t('sales.documents.form.customFields', 'Custom fields'), column: 2, kind: 'customFields' },
  ], [t])

  const initialValues = React.useMemo<Partial<SalesDocumentFormValues>>(
    () => ({
      documentKind: 'quote',
      currencyCode: 'USD',
      useCustomShipping: false,
      useCustomBilling: false,
    }),
    []
  )

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      const { customFields, rest } = collectCustomFieldValues(values)
      const base = rest as SalesDocumentFormValues
      const documentKind: DocumentKind = base.documentKind === 'order' ? 'order' : 'quote'
      const payload: Record<string, unknown> = {
        currencyCode: typeof base.currencyCode === 'string' && base.currencyCode.trim().length
          ? base.currencyCode.trim().toUpperCase()
          : undefined,
        customerEntityId: base.customerEntityId || undefined,
        comments: base.comments ?? undefined,
        metadata: base.customerEmail ? { customerEmail: base.customerEmail } : undefined,
      }
      if (documentKind === 'order') {
        payload.channelId = base.channelId || undefined
      }
      const shippingSnapshot = base.useCustomShipping ? normalizeAddressDraft(base.shippingAddressDraft) : null
      const billingSnapshot = base.useCustomBilling ? normalizeAddressDraft(base.billingAddressDraft) : null
      if (shippingSnapshot) payload.shippingAddressSnapshot = shippingSnapshot
      if (billingSnapshot) payload.billingAddressSnapshot = billingSnapshot
      if (!base.useCustomShipping) payload.shippingAddressId = base.shippingAddressId || undefined
      if (!base.useCustomBilling) payload.billingAddressId = base.billingAddressId || undefined

      try {
        let shippingId = payload.shippingAddressId as string | undefined
        let billingId = payload.billingAddressId as string | undefined
        if (base.customerEntityId && shippingSnapshot && base.saveShippingAddress) {
          const res = await createCrud<{ id?: string }>('customers/addresses', {
            entityId: base.customerEntityId,
            addressLine1: shippingSnapshot.addressLine1 ?? shippingSnapshot.name ?? 'Address',
            name: shippingSnapshot.name ?? undefined,
            addressLine2: shippingSnapshot.addressLine2 ?? undefined,
            city: shippingSnapshot.city ?? undefined,
            region: shippingSnapshot.region ?? undefined,
            postalCode: shippingSnapshot.postalCode ?? undefined,
            country: shippingSnapshot.country ?? undefined,
          })
          if (res?.result?.id) shippingId = res.result.id
        }
        if (base.customerEntityId && billingSnapshot && base.saveBillingAddress) {
          const res = await createCrud<{ id?: string }>('customers/addresses', {
            entityId: base.customerEntityId,
            addressLine1: billingSnapshot.addressLine1 ?? billingSnapshot.name ?? 'Address',
            name: billingSnapshot.name ?? undefined,
            addressLine2: billingSnapshot.addressLine2 ?? undefined,
            city: billingSnapshot.city ?? undefined,
            region: billingSnapshot.region ?? undefined,
            postalCode: billingSnapshot.postalCode ?? undefined,
            country: billingSnapshot.country ?? undefined,
          })
          if (res?.result?.id) billingId = res.result.id
        }
        if (shippingId) payload.shippingAddressId = shippingId
        if (billingId) payload.billingAddressId = billingId
        if (Object.keys(customFields).length) payload.customFields = customFields

        const endpoint = documentKind === 'order' ? 'sales/orders' : 'sales/quotes'
        const { result } = await createCrud<{ id?: string; orderId?: string; quoteId?: string }>(endpoint, payload, {
          errorMessage: t('sales.documents.form.errors.submit', 'Failed to create document.'),
        })
        const newId =
          (result && typeof result.id === 'string' && result.id) ||
          (result && typeof result.orderId === 'string' && result.orderId) ||
          (result && typeof result.quoteId === 'string' && result.quoteId) ||
          null
        if (!newId) {
          throw createCrudFormError(t('sales.documents.form.errors.id', 'Document id missing after create.'))
        }
        flash(t('sales.documents.form.success', 'Sales document created.'), 'success')
        onCreated({ id: newId, kind: documentKind })
      } catch (err) {
        if (err instanceof Error) throw err
        throw createCrudFormError(t('sales.documents.form.errors.submit', 'Failed to create document.'))
      }
    },
    [onCreated, t],
  )

  return (
    <CrudForm<SalesDocumentFormValues>
      title={t('sales.documents.form.title', 'Create sales document')}
      backHref="/backend/sales/channels"
      fields={fields}
      groups={groups}
      initialValues={initialValues}
      entityIds={[E.sales.sales_quote, E.sales.sales_order]}
      submitLabel={t('sales.documents.form.submit', 'Create')}
      cancelHref="/backend/sales/channels"
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
    />
  )
}
