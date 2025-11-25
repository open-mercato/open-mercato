"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  DictionaryEntrySelect,
  type DictionaryOption,
  type DictionarySelectLabels,
} from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { Building2, Mail, Plus, Store, UserRound } from 'lucide-react'
import { useEmailDuplicateCheck } from '@open-mercato/core/modules/customers/backend/hooks/useEmailDuplicateCheck'
import { useCurrencyDictionary } from '@open-mercato/core/modules/customers/components/detail/hooks/useCurrencyDictionary'

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
  kind: 'person' | 'company'
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
  sameAsShipping?: boolean
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

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

type QuickCreatePayload = { id: string; kind: 'person' | 'company'; email?: string | null }

type CustomerQuickCreateProps = {
  t: Translator
  onCreated: (payload: QuickCreatePayload) => void
}

function CustomerQuickCreate({ t, onCreated }: CustomerQuickCreateProps) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [dialog, setDialog] = React.useState<'person' | 'company' | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [personForm, setPersonForm] = React.useState({ firstName: '', lastName: '', email: '' })
  const [companyForm, setCompanyForm] = React.useState({ name: '', email: '', domain: '' })
  const menuRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!menuOpen) return
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const resetForms = React.useCallback(() => {
    setPersonForm({ firstName: '', lastName: '', email: '' })
    setCompanyForm({ name: '', email: '', domain: '' })
    setFormError(null)
    setSaving(false)
  }, [])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
    resetForms()
  }, [resetForms])

  const handlePersonCreate = React.useCallback(async () => {
    const firstName = personForm.firstName.trim()
    const lastName = personForm.lastName.trim()
    const email = personForm.email.trim()
    if (!firstName || !lastName) {
      setFormError(t('sales.documents.form.customer.quick.personRequired', 'Provide first and last name.'))
      return
    }
    setSaving(true)
    try {
      const displayName = `${firstName} ${lastName}`.trim()
      const payload: Record<string, unknown> = {
        displayName,
        firstName,
        lastName,
      }
      if (email) payload.primaryEmail = email
      const { result } = await createCrud<{ id?: string; entityId?: string }>('customers/people', payload, {
        errorMessage: t('sales.documents.form.customer.quick.error', 'Failed to create customer.'),
      })
      const id =
        (result && typeof result.entityId === 'string' && result.entityId) ||
        (result && typeof result.id === 'string' && result.id) ||
        null
      if (!id) throw new Error('Missing customer id')
      flash(t('sales.documents.form.customer.quick.personSuccess', 'Customer created.'), 'success')
      onCreated({ id, kind: 'person', email })
      closeDialog()
    } catch (err) {
      console.error('sales.documents.quickCreate.person', err)
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('sales.documents.form.customer.quick.error', 'Failed to create customer.')
      setFormError(message)
    } finally {
      setSaving(false)
    }
  }, [closeDialog, onCreated, personForm.email, personForm.firstName, personForm.lastName, resetForms, t])

  const handleCompanyCreate = React.useCallback(async () => {
    const name = companyForm.name.trim()
    const domain = companyForm.domain.trim()
    const email = companyForm.email.trim()
    if (!name) {
      setFormError(t('sales.documents.form.customer.quick.companyRequired', 'Provide a company name.'))
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = { displayName: name }
      if (domain) payload.domain = domain
      if (email) payload.primaryEmail = email
      const { result } = await createCrud<{ id?: string; entityId?: string }>('customers/companies', payload, {
        errorMessage: t('sales.documents.form.customer.quick.error', 'Failed to create customer.'),
      })
      const id =
        (result && typeof result.entityId === 'string' && result.entityId) ||
        (result && typeof result.id === 'string' && result.id) ||
        null
      if (!id) throw new Error('Missing customer id')
      flash(t('sales.documents.form.customer.quick.companySuccess', 'Customer created.'), 'success')
      onCreated({ id, kind: 'company', email })
      closeDialog()
    } catch (err) {
      console.error('sales.documents.quickCreate.company', err)
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('sales.documents.form.customer.quick.error', 'Failed to create customer.')
      setFormError(message)
    } finally {
      setSaving(false)
    }
  }, [closeDialog, companyForm.domain, companyForm.email, companyForm.name, onCreated, resetForms, t])

  const renderMenu = () => (
    <div className="absolute right-0 z-30 mt-2 w-48 rounded border bg-popover p-1 shadow-lg">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted"
        onClick={() => {
          setDialog('person')
          setMenuOpen(false)
          setFormError(null)
        }}
      >
        <UserRound className="h-4 w-4 text-muted-foreground" />
        {t('sales.documents.form.customer.addPerson', 'Create person')}
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm hover:bg-muted"
        onClick={() => {
          setDialog('company')
          setMenuOpen(false)
          setFormError(null)
        }}
      >
        <Building2 className="h-4 w-4 text-muted-foreground" />
        {t('sales.documents.form.customer.addCompany', 'Create company')}
      </button>
    </div>
  )

  return (
    <div className="relative" ref={menuRef}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-2"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
      >
        <Plus className="h-4 w-4" />
        {t('sales.documents.form.customer.create', 'Create customer')}
      </Button>
      {menuOpen ? renderMenu() : null}

      <Dialog open={dialog === 'person'} onOpenChange={(open) => (open ? setDialog('person') : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sales.documents.form.customer.addPerson', 'Create person')}</DialogTitle>
            <DialogDescription>
              {t('sales.documents.form.customer.quick.dialogDescription', 'Add a person without leaving this form.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder={t('customers.people.form.firstName.placeholder', 'First name')}
                value={personForm.firstName}
                onChange={(event) => setPersonForm((prev) => ({ ...prev, firstName: event.target.value }))}
              />
              <Input
                placeholder={t('customers.people.form.lastName.placeholder', 'Last name')}
                value={personForm.lastName}
                onChange={(event) => setPersonForm((prev) => ({ ...prev, lastName: event.target.value }))}
              />
            </div>
            <Input
              placeholder={t('customers.people.form.primaryEmail.placeholder', 'Email (optional)')}
              type="email"
              value={personForm.email}
              onChange={(event) => setPersonForm((prev) => ({ ...prev, email: event.target.value }))}
            />
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={handlePersonCreate} disabled={saving}>
              {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'company'} onOpenChange={(open) => (open ? setDialog('company') : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sales.documents.form.customer.addCompany', 'Create company')}</DialogTitle>
            <DialogDescription>
              {t('sales.documents.form.customer.quick.dialogDescription', 'Add a company without leaving this form.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder={t('customers.companies.form.displayName.placeholder', 'Company name')}
              value={companyForm.name}
              onChange={(event) => setCompanyForm((prev) => ({ ...prev, name: event.target.value }))}
            />
            <Input
              placeholder={t('customers.companies.form.domain.placeholder', 'Domain (optional)')}
              value={companyForm.domain}
              onChange={(event) => setCompanyForm((prev) => ({ ...prev, domain: event.target.value }))}
            />
            <Input
              placeholder={t('customers.companies.form.primaryEmail.placeholder', 'Email (optional)')}
              type="email"
              value={companyForm.email}
              onChange={(event) => setCompanyForm((prev) => ({ ...prev, email: event.target.value }))}
            />
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="button" onClick={handleCompanyCreate} disabled={saving}>
              {saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
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
      return { id, label: `${label}`, subtitle, kind }
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
  const currencyLabels = React.useMemo<DictionarySelectLabels>(() => ({
    placeholder: t('sales.documents.form.currency.placeholder', 'Select currency'),
    addLabel: t('sales.documents.form.currency.add', 'Add currency'),
    addPrompt: t('sales.documents.form.currency.prompt', 'Currency code'),
    dialogTitle: t('sales.documents.form.currency.dialogTitle', 'Add currency'),
    valueLabel: t('sales.documents.form.currency.valueLabel', 'Currency code'),
    valuePlaceholder: t('sales.documents.form.currency.valuePlaceholder', 'e.g. USD'),
    labelLabel: t('sales.documents.form.currency.labelLabel', 'Label'),
    labelPlaceholder: t('sales.documents.form.currency.labelPlaceholder', 'Display name'),
    emptyError: t('sales.documents.form.currency.emptyError', 'Currency code is required'),
    cancelLabel: t('sales.documents.form.currency.cancel', 'Cancel'),
    saveLabel: t('sales.documents.form.currency.save', 'Save'),
    saveShortcutHint: '⌘/Ctrl + Enter',
    successCreateLabel: t('sales.documents.form.currency.created', 'Currency saved.'),
    errorLoad: t('sales.documents.form.currency.errorLoad', 'Failed to load currencies.'),
    errorSave: t('sales.documents.form.currency.errorSave', 'Failed to save currency.'),
    loadingLabel: t('sales.documents.form.currency.loading', 'Loading currencies…'),
    manageTitle: t('sales.documents.form.currency.manage', 'Manage currency dictionary'),
  }), [t])
  const { data: currencyDictionary, refetch: refetchCurrencyDictionary } = useCurrencyDictionary()

  const fetchCurrencyOptions = React.useCallback(async (): Promise<DictionaryOption[]> => {
    try {
      const source = currencyDictionary ?? (await refetchCurrencyDictionary())
      if (source && Array.isArray(source.entries)) {
        return source.entries.map((entry) => ({
          value: entry.value,
          label: entry.label,
          color: entry.color ?? null,
          icon: entry.icon ?? null,
        }))
      }
      return []
    } catch (err) {
      console.error('sales.documents.currency', err)
      return []
    }
  }, [currencyDictionary, refetchCurrencyDictionary])

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
      return merged
    } catch (err) {
      console.error('sales.documents.loadCustomers', err)
      flash(t('sales.documents.form.errors.customers', 'Failed to load customers.'), 'error')
      return []
    } finally {
      setCustomerLoading(false)
    }
  }, [t])

  const loadChannels = React.useCallback(async (query?: string) => {
    setChannelLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '20' })
      if (query && query.trim().length) params.set('search', query.trim())
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
        if (!query) setChannels(options)
        return options
      } else {
        setChannels([])
        return []
      }
    } catch (err) {
      console.error('sales.documents.loadChannels', err)
      setChannels([])
      return []
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
      label: '',
      type: 'custom',
      required: true,
      component: ({ value, setValue }) => {
        const current = value === 'order' ? 'order' : 'quote'
        const label = t('sales.documents.form.kind', 'Document type')
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                <span className="text-destructive">*</span>
                <span>{label}</span>
              </div>
              <div className="inline-flex rounded-lg border bg-background p-1 shadow-sm">
                {(['quote', 'order'] as DocumentKind[]).map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    variant={current === kind ? 'default' : 'ghost'}
                    onClick={() => setValue(kind)}
                    className="capitalize"
                  >
                    {kind}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                'sales.documents.form.kind.hint',
                "Please select which kind of sales document you want to create. When creating Quotes - it's kind of Shopping cart or Request for negotiation and could be converted to regular order later",
              )}
            </p>
          </div>
        )
      },
    },
    {
      id: 'currencyCode',
      label: t('sales.documents.form.currency', 'Currency'),
      type: 'custom',
      required: true,
      component: ({ value, setValue }) => (
        <DictionaryEntrySelect
          value={typeof value === 'string' ? value : undefined}
          onChange={(next) => setValue(next ?? '')}
          fetchOptions={fetchCurrencyOptions}
          allowInlineCreate={false}
          manageHref="/backend/config/dictionaries?key=currency"
          selectClassName="w-full"
          labels={currencyLabels}
        />
      ),
    },
    {
      id: 'channelId',
      label: t('sales.documents.form.channel', 'Sales channel'),
      type: 'custom',
      component: ({ value, setValue }) => (
        <LookupSelect
          value={typeof value === 'string' ? value : null}
          onChange={(next) => setValue(next)}
          fetchItems={async (query) => {
            const options = await loadChannels(query)
            return options.map<LookupSelectItem>((opt) => ({
              id: opt.id,
              title: opt.label,
              icon: <Store className="h-5 w-5 text-muted-foreground" />,
            }))
          }}
          searchPlaceholder={t('sales.documents.form.channel.placeholder', 'Select a channel')}
          loadingLabel={t('sales.documents.form.channel.loading', 'Loading channels…')}
          emptyLabel={t('sales.documents.form.channel.empty', 'No channels found.')}
          selectedHintLabel={(id) => t('sales.documents.form.channel.selected', 'Selected channel: {{id}}', { id })}
        />
      ),
    },
    {
      id: 'shippingAddressSection',
      label: '',
      type: 'custom',
      component: ({ values, setValue }) => {
        const useCustom = values?.useCustomShipping === true
        const selectedId = typeof values?.shippingAddressId === 'string' ? values.shippingAddressId : ''
        const draft = (values?.shippingAddressDraft ?? {}) as AddressDraft
        const customerRequired = !values?.customerEntityId
        return (
          <div className="space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-base font-semibold">
                  {t('sales.documents.form.shipping.title', 'Shipping address')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {customerRequired
                    ? t('sales.documents.form.address.customerRequired', 'Select a customer or define new custom address')
                    : t('sales.documents.form.shipping.hint', 'Select an address or define a new one.')}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={useCustom}
                  onCheckedChange={(checked) => setValue('useCustomShipping', checked)}
                />
                <span>{t('sales.documents.form.shipping.custom', 'Define new address')}</span>
              </label>
            </div>
            {!useCustom ? (
              <select
                className="w-full rounded border px-2 py-2 text-sm"
                value={selectedId}
                onChange={(evt) => setValue('shippingAddressId', evt.target.value || null)}
                disabled={addressesLoading || customerRequired}
              >
                <option value="">
                  {addressesLoading
                    ? t('sales.documents.form.address.loading', 'Loading addresses…')
                    : t('sales.documents.form.address.placeholder', 'Select address')}
                </option>
                {addressOptions.map((addr) => (
                  <option key={addr.id} value={addr.id}>{addr.label}</option>
                ))}
              </select>
            ) : null}
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
                  <Switch
                    checked={values?.saveShippingAddress === true}
                    onCheckedChange={(checked) => setValue('saveShippingAddress', checked)}
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
      label: '',
      type: 'custom',
      component: ({ values, setValue }) => {
        const useCustom = values?.useCustomBilling === true
        const selectedId = typeof values?.billingAddressId === 'string' ? values.billingAddressId : ''
        const draft = (values?.billingAddressDraft ?? {}) as AddressDraft
        const customerRequired = !values?.customerEntityId
        const sameAsShipping = values?.sameAsShipping !== false
        const shippingId = typeof values?.shippingAddressId === 'string' ? values.shippingAddressId : null
        const shippingDraft = (values?.shippingAddressDraft ?? {}) as AddressDraft
        const shippingDraftKey = JSON.stringify(shippingDraft)
        const billingDraftKey = JSON.stringify(draft)
        const useCustomShipping = values?.useCustomShipping === true

        React.useEffect(() => {
          if (!sameAsShipping) return
          if ((values?.billingAddressId ?? null) !== shippingId) {
            setValue('billingAddressId', shippingId)
          }
          if (useCustomShipping !== (values?.useCustomBilling === true)) {
            setValue('useCustomBilling', useCustomShipping)
          }
          if (useCustomShipping && shippingDraftKey !== billingDraftKey) {
            setValue('billingAddressDraft', shippingDraft)
          }
        }, [
          billingDraftKey,
          sameAsShipping,
          setValue,
          shippingDraft,
          shippingDraftKey,
          shippingId,
          useCustomShipping,
          values?.billingAddressId,
          values?.useCustomBilling,
        ])

        return (
          <div className="space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-base font-semibold">
                  {t('sales.documents.form.billing.title', 'Billing address')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {sameAsShipping
                    ? t('sales.documents.form.address.sameAsShippingHint', 'Billing will mirror the shipping address. Uncheck to edit.')
                    : t('sales.documents.form.billing.hint', 'Select an address or define a new one.')}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={sameAsShipping}
                  onCheckedChange={(checked) => {
                    setValue('sameAsShipping', checked)
                    if (checked) {
                      setValue('useCustomBilling', useCustomShipping)
                      setValue('billingAddressId', shippingId)
                      setValue('billingAddressDraft', shippingDraft)
                    }
                  }}
                />
                <span>{t('sales.documents.form.address.sameAsShipping', 'Same as shipping address')}</span>
              </label>
            </div>

            {!sameAsShipping ? (
              <>
                {!useCustom ? (
                  <select
                    className="w-full rounded border px-2 py-2 text-sm"
                    value={selectedId}
                    onChange={(evt) => setValue('billingAddressId', evt.target.value || null)}
                    disabled={addressesLoading || customerRequired}
                  >
                    <option value="">
                      {addressesLoading
                        ? t('sales.documents.form.address.loading', 'Loading addresses…')
                        : t('sales.documents.form.address.placeholder', 'Select address')}
                    </option>
                    {addressOptions.map((addr) => (
                      <option key={addr.id} value={addr.id}>{addr.label}</option>
                    ))}
                  </select>
                ) : null}

                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={useCustom}
                    onCheckedChange={(checked) => setValue('useCustomBilling', checked)}
                    disabled={false}
                  />
                  <span>{t('sales.documents.form.shipping.custom', 'Define new address')}</span>
                </label>

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
                      <Switch
                        checked={values?.saveBillingAddress === true}
                        onCheckedChange={(checked) => setValue('saveBillingAddress', checked)}
                      />
                      {t('sales.documents.form.address.saveToCustomer', 'Save this address to the customer')}
                    </label>
                  </div>
                ) : null}
              </>
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
    {
      id: 'infoNote',
      label: '',
      type: 'custom',
      component: () => (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          {t('sales.documents.form.nextStep', 'After creation you will add items, prices, and fulfillment details.')}
        </div>
      ),
    },
  ], [addressOptions, addressesLoading, fetchCurrencyOptions, loadAddresses, loadChannels, loadCustomers, t, currencyLabels])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'docType', title: '', column: 1, fields: ['documentKind'] },
    {
      id: 'customer',
      title: '',
      column: 1,
      fields: [],
      component: ({ values, setValue }) => {
        const emailValue = typeof values.customerEmail === 'string' ? values.customerEmail : ''
        const { duplicate, checking } = useEmailDuplicateCheck(emailValue, {
          disabled: false,
          debounceMs: 400,
          matchMode: 'prefix',
        })
        return (
          <div className="space-y-4">
            <div className="space-y-3">
              <LookupSelect
                value={typeof values.customerEntityId === 'string' ? values.customerEntityId : null}
                onChange={(next) => {
                  setValue('customerEntityId', next)
                  loadAddresses(next)
                }}
                fetchItems={async (query) => {
                  const options = await loadCustomers(query)
                  return options.map<LookupSelectItem>((opt) => ({
                    id: opt.id,
                    title: opt.label,
                    subtitle: opt.subtitle ?? undefined,
                    icon:
                      opt.kind === 'person' ? (
                        <UserRound className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <Building2 className="h-5 w-5 text-muted-foreground" />
                      ),
                  }))
                }}
                actionSlot={
                  <CustomerQuickCreate
                    t={t}
                    onCreated={({ id, email }) => {
                      setValue('customerEntityId', id)
                      loadAddresses(id)
                      if (email && !values.customerEmail) {
                        setValue('customerEmail', email)
                      }
                    }}
                  />
                }
                searchPlaceholder={t('sales.documents.form.customer.placeholder', 'Search customers…')}
                loadingLabel={t('sales.documents.form.customer.loading', 'Loading customers…')}
                emptyLabel={t('sales.documents.form.customer.empty', 'No customers found.')}
                selectedHintLabel={(id) => t('sales.documents.form.customer.selected', 'Selected customer: {{id}}', { id })}
              />
            </div>
            <div className="space-y-2">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <input
                  type="email"
                  className="w-full rounded border pl-8 pr-2 py-2 text-sm"
                  value={emailValue}
                  onChange={(event) => setValue('customerEmail', event.target.value)}
                  placeholder={t('sales.documents.form.email.placeholder', 'Email used for the document')}
                  spellCheck={false}
                />
              </div>
              {duplicate ? (
                <div className="flex items-center justify-between rounded border bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    {t('customers.people.form.emailDuplicateNotice', undefined, { name: duplicate.displayName })}
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setValue('customerEntityId', duplicate.id)
                      loadAddresses(duplicate.id)
                    }}
                  >
                    {t('sales.documents.form.email.selectCustomer', 'Select customer')}
                  </Button>
                </div>
              ) : null}
              {!duplicate && checking ? (
                <p className="text-xs text-muted-foreground">{t('customers.people.form.emailChecking')}</p>
              ) : null}
            </div>
          </div>
        )
      },
    },
    { id: 'channels-comments', title: '', column: 1, fields: ['channelId', 'comments'] },
    { id: 'currency', title: '', column: 2, fields: ['currencyCode'] },
    { id: 'shipping', title: '', column: 2, fields: ['shippingAddressSection'] },
    { id: 'billing', title: '', column: 2, fields: ['billingAddressSection'] },
    { id: 'custom', title: t('sales.documents.form.customFields', 'Custom fields'), column: 2, kind: 'customFields' },
  ], [loadAddresses, loadCustomers, t])

  const initialValues = React.useMemo<Partial<SalesDocumentFormValues>>(
    () => ({
      documentKind: 'quote',
      currencyCode: 'USD',
      useCustomShipping: false,
      useCustomBilling: false,
      sameAsShipping: true,
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
      payload.channelId = base.channelId || undefined
      const shippingSnapshot = base.useCustomShipping ? normalizeAddressDraft(base.shippingAddressDraft) : null
      let billingSnapshot = base.useCustomBilling ? normalizeAddressDraft(base.billingAddressDraft) : null
      const sameAsShipping = base.sameAsShipping !== false
      if (sameAsShipping) {
        if (shippingSnapshot) {
          billingSnapshot = shippingSnapshot
        } else if (!base.useCustomShipping) {
          payload.billingAddressId = base.shippingAddressId || undefined
        }
      }
      if (shippingSnapshot) payload.shippingAddressSnapshot = shippingSnapshot
      if (billingSnapshot) payload.billingAddressSnapshot = billingSnapshot
      if (!base.useCustomShipping) payload.shippingAddressId = base.shippingAddressId || undefined
      if (!base.useCustomBilling && !sameAsShipping) payload.billingAddressId = base.billingAddressId || undefined

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
