"use client"

import * as React from 'react'
import { CrudForm, type CrudCustomFieldRenderProps, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
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
  DialogTrigger,
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
import {
  buildCompanyPayload,
  buildPersonPayload,
  createCompanyFormFields,
  createCompanyFormGroups,
  createCompanyFormSchema,
  createPersonFormFields,
  createPersonFormGroups,
  createPersonFormSchema,
  type CompanyFormValues,
  type PersonFormValues,
} from '@open-mercato/core/modules/customers/components/formConfig'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  formatAddressString,
  type AddressFormatStrategy,
  type AddressValue,
} from '@open-mercato/core/modules/customers/utils/addressFormat'
import { AddressEditor, type AddressEditorDraft } from '@open-mercato/core/modules/customers/components/AddressEditor'

type DocumentKind = 'quote' | 'order'

type AddressDraft = AddressEditorDraft

type CustomerOption = {
  id: string
  label: string
  subtitle?: string | null
  kind: 'person' | 'company'
  primaryEmail?: string | null
}

type ChannelOption = { id: string; label: string }

type AddressOption = {
  id: string
  label: string
  summary: string
  name?: string | null
  value: AddressValue
}

export type SalesDocumentFormValues = {
  documentKind: DocumentKind
  documentNumber?: string
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
  initialKind?: DocumentKind
}

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

type QuickCreatePayload = {
  id: string
  kind: 'person' | 'company'
  email?: string | null
  label: string
  subtitle?: string | null
}

type CustomerQuickCreateProps = {
  t: Translator
  onCreated: (payload: QuickCreatePayload) => void
}

function CustomerQuickCreate({ t, onCreated }: CustomerQuickCreateProps) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [dialog, setDialog] = React.useState<'person' | 'company' | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const { organizationId } = useOrganizationScopeDetail()
  const personSchema = React.useMemo(() => createPersonFormSchema(), [])
  const personFields = React.useMemo(() => createPersonFormFields(t), [t])
  const personGroups = React.useMemo(() => createPersonFormGroups(t), [t])
  const companySchema = React.useMemo(() => createCompanyFormSchema(), [])
  const companyFields = React.useMemo(() => createCompanyFormFields(t), [t])
  const companyGroups = React.useMemo(() => createCompanyFormGroups(t), [t])

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

  const closeDialog = React.useCallback(() => {
    setDialog(null)
    setFormError(null)
    setSaving(false)
  }, [])

  const handlePersonCreate = React.useCallback(
    async (values: PersonFormValues) => {
      setSaving(true)
      try {
        const payload = buildPersonPayload(values, organizationId)
        const { result } = await createCrud<{ id?: string; entityId?: string }>('customers/people', payload, {
          errorMessage: t('sales.documents.form.customer.quick.error', 'Failed to create customer.'),
        })
        const id =
          (result && typeof result.entityId === 'string' && result.entityId) ||
          (result && typeof result.id === 'string' && result.id) ||
          null
        if (!id) throw new Error('Missing customer id')
        const displayName =
          typeof values.displayName === 'string' && values.displayName.trim().length
            ? values.displayName.trim()
            : t('customers.people.form.displayName.placeholder', 'New person')
        flash(t('sales.documents.form.customer.quick.personSuccess', 'Customer created.'), 'success')
        onCreated({
          id,
          kind: 'person',
          email: typeof values.primaryEmail === 'string' ? values.primaryEmail : null,
          label: displayName,
          subtitle: typeof values.primaryEmail === 'string' ? values.primaryEmail : null,
        })
        closeDialog()
      } catch (err) {
        console.error('sales.documents.quickCreate.person', err)
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.form.customer.quick.error', 'Failed to create customer.')
        setFormError(message)
        throw err
      } finally {
        setSaving(false)
      }
    },
    [closeDialog, onCreated, organizationId, t],
  )

  const handleCompanyCreate = React.useCallback(
    async (values: CompanyFormValues) => {
      setSaving(true)
      try {
        const payload = buildCompanyPayload(values, organizationId)
        const { result } = await createCrud<{ id?: string; entityId?: string }>('customers/companies', payload, {
          errorMessage: t('sales.documents.form.customer.quick.error', 'Failed to create customer.'),
        })
        const id =
          (result && typeof result.entityId === 'string' && result.entityId) ||
          (result && typeof result.id === 'string' && result.id) ||
          null
        if (!id) throw new Error('Missing customer id')
        const displayName =
          typeof values.displayName === 'string' && values.displayName.trim().length
            ? values.displayName.trim()
            : t('customers.companies.form.displayName.placeholder', 'New company')
        const email = typeof values.primaryEmail === 'string' ? values.primaryEmail : null
        const domain =
          typeof values.domain === 'string' && values.domain.trim().length ? values.domain.trim() : null
        flash(t('sales.documents.form.customer.quick.companySuccess', 'Customer created.'), 'success')
        onCreated({
          id,
          kind: 'company',
          email,
          label: displayName,
          subtitle: domain || email || null,
        })
        closeDialog()
      } catch (err) {
        console.error('sales.documents.quickCreate.company', err)
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.form.customer.quick.error', 'Failed to create customer.')
        setFormError(message)
        throw err
      } finally {
        setSaving(false)
      }
    },
    [closeDialog, onCreated, organizationId, t],
  )

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
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('sales.documents.form.customer.addPerson', 'Create person')}</DialogTitle>
            <DialogDescription>
              {t('sales.documents.form.customer.quick.dialogDescription', 'Add a person without leaving this form.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            <div
              onSubmit={(event) => {
                event.stopPropagation()
                if (typeof (event as any).nativeEvent?.stopImmediatePropagation === 'function') {
                  (event as any).nativeEvent.stopImmediatePropagation()
                }
              }}
            >
              <CrudForm<PersonFormValues>
                embedded
                fields={personFields}
                groups={personGroups}
                schema={personSchema}
                initialValues={{ addresses: [] as PersonFormValues['addresses'] }}
                submitLabel={t('common.save', 'Save')}
                cancelHref={undefined}
                onSubmit={(values) => handlePersonCreate(values)}
                entityIds={[E.customers.customer_entity, E.customers.customer_person_profile]}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'company'} onOpenChange={(open) => (open ? setDialog('company') : closeDialog())}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('sales.documents.form.customer.addCompany', 'Create company')}</DialogTitle>
            <DialogDescription>
              {t('sales.documents.form.customer.quick.dialogDescription', 'Add a company without leaving this form.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            <div
              onSubmit={(event) => {
                event.stopPropagation()
                if (typeof (event as any).nativeEvent?.stopImmediatePropagation === 'function') {
                  (event as any).nativeEvent.stopImmediatePropagation()
                }
              }}
            >
              <CrudForm<CompanyFormValues>
                embedded
                fields={companyFields}
                groups={companyGroups}
                schema={companySchema}
                initialValues={{ addresses: [] as CompanyFormValues['addresses'] }}
                submitLabel={t('common.save', 'Save')}
                cancelHref={undefined}
                onSubmit={(values) => handleCompanyCreate(values)}
                entityIds={[E.customers.customer_entity, E.customers.customer_company_profile]}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function parseCustomerOptions(items: unknown[], kind: 'person' | 'company'): CustomerOption[] {
  const parsed: CustomerOption[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : null
    if (!id) continue
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
    parsed.push({ id, label: `${label}`, subtitle, kind, primaryEmail: email })
  }
  return parsed
}

function normalizeAddressDraft(draft?: AddressDraft | null): Record<string, unknown> | null {
  if (!draft) return null
  const normalized: Record<string, unknown> = {}
  const assign = (key: keyof AddressDraft, target: string) => {
    const value = draft[key]
    if (typeof value === 'string' && value.trim().length) normalized[target] = value.trim()
    if (typeof value === 'boolean') normalized[target] = value
  }
  assign('name', 'name')
  assign('purpose', 'purpose')
  assign('companyName', 'companyName')
  assign('addressLine1', 'addressLine1')
  assign('addressLine2', 'addressLine2')
  assign('buildingNumber', 'buildingNumber')
  assign('flatNumber', 'flatNumber')
  assign('city', 'city')
  assign('region', 'region')
  assign('postalCode', 'postalCode')
  assign('country', 'country')
  assign('isPrimary', 'isPrimary')
  return Object.keys(normalized).length ? normalized : null
}

export function SalesDocumentForm({ onCreated, isSubmitting = false, initialKind }: SalesDocumentFormProps) {
  const t = useT()
  const [customers, setCustomers] = React.useState<CustomerOption[]>([])
  const [customerLoading, setCustomerLoading] = React.useState(false)
  const [channels, setChannels] = React.useState<ChannelOption[]>([])
  const [channelLoading, setChannelLoading] = React.useState(false)
  const [addressOptions, setAddressOptions] = React.useState<AddressOption[]>([])
  const [addressesLoading, setAddressesLoading] = React.useState(false)
  const [addressesError, setAddressesError] = React.useState<string | null>(null)
  const [addressFormat, setAddressFormat] = React.useState<AddressFormatStrategy>('line_first')
  const addressRequestRef = React.useRef(0)
  const addressAbortRef = React.useRef<AbortController | null>(null)
  const addressTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const customerQuerySetter = React.useRef<((value: string) => void) | null>(null)
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

  const fetchCustomerEmail = React.useCallback(
    async (id: string, kindHint?: 'person' | 'company'): Promise<string | null> => {
      try {
        const kind = kindHint ?? customers.find((item) => item.id === id)?.kind ?? null
        const endpoint = kind === 'company' ? '/api/customers/companies' : '/api/customers/people'
        const params = new URLSearchParams({ id, pageSize: '1', page: '1' })
        const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(`${endpoint}?${params.toString()}`)
        if (!call.ok || !Array.isArray(call.result?.items) || !call.result.items.length) return null
        const item = call.result.items[0]
        const email =
          (typeof item?.primary_email === 'string' && item.primary_email) ||
          (typeof (item as any)?.primaryEmail === 'string' && (item as any).primaryEmail) ||
          null
        if (email) {
          setCustomers((prev) =>
            prev.map((entry) => (entry.id === id ? { ...entry, primaryEmail: email } : entry))
          )
        }
        return email ?? null
      } catch (err) {
        console.error('sales.documents.fetchCustomerEmail', err)
        return null
      }
    },
    [customers],
  )

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
    addressRequestRef.current += 1
    const requestId = addressRequestRef.current

    if (addressTimeoutRef.current) {
      clearTimeout(addressTimeoutRef.current)
      addressTimeoutRef.current = null
    }
    if (addressAbortRef.current) {
      addressAbortRef.current.abort()
      addressAbortRef.current = null
    }

    if (!customerId) {
      setAddressesError(null)
      setAddressOptions([])
      setAddressesLoading(false)
      return
    }
    setAddressesLoading(true)
    setAddressesError(null)
    setAddressOptions([])
    const controller = new AbortController()
    addressAbortRef.current = controller
    addressTimeoutRef.current = setTimeout(() => controller.abort(), 12_000)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '50', entityId: customerId })
      const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/customers/addresses?${params.toString()}`,
        { signal: controller.signal },
        { fallback: { items: [] } }
      )
      if (call.ok && Array.isArray(call.result?.items)) {
        const options = call.result.items.reduce<AddressOption[]>((acc, item) => {
          const id = typeof item.id === 'string' ? item.id : null
          if (!id) return acc
          const value: AddressValue = {
            addressLine1: typeof item.address_line1 === 'string' ? item.address_line1 : null,
            addressLine2: typeof item.address_line2 === 'string' ? item.address_line2 : null,
            buildingNumber: typeof item.building_number === 'string' ? item.building_number : null,
            flatNumber: typeof item.flat_number === 'string' ? item.flat_number : null,
            city: typeof item.city === 'string' ? item.city : null,
            region: typeof item.region === 'string' ? item.region : null,
            postalCode: typeof item.postal_code === 'string' ? item.postal_code : null,
            country: typeof item.country === 'string' ? item.country : null,
            companyName: typeof item.company_name === 'string' ? item.company_name : null,
          }
          const name = typeof item.name === 'string' ? item.name.trim() : ''
          const summary = formatAddressString(value, addressFormat)
          const label = name || summary || id
          acc.push({ id, label, summary, value, name: name || null })
          return acc
        }, [])
        if (addressRequestRef.current === requestId) {
          setAddressOptions(options)
        }
      } else {
        if (addressRequestRef.current === requestId) {
          setAddressOptions([])
          setAddressesError(
            t('sales.documents.detail.addresses.loadError', 'Failed to load addresses.')
          )
        }
      }
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') {
        console.error('sales.documents.loadAddresses', err)
      }
      if (addressRequestRef.current === requestId) {
        setAddressOptions([])
        if ((err as DOMException)?.name !== 'AbortError') {
          setAddressesError(
            t('sales.documents.detail.addresses.loadError', 'Failed to load addresses.')
          )
        }
      }
    } finally {
      if (addressTimeoutRef.current) {
        clearTimeout(addressTimeoutRef.current)
        addressTimeoutRef.current = null
      }
      if (addressAbortRef.current === controller) {
        addressAbortRef.current = null
      }
      if (addressRequestRef.current === requestId) {
        setAddressesLoading(false)
      }
    }
  }, [addressFormat, t])

  React.useEffect(() => {
    loadCustomers().catch(() => {})
    loadChannels().catch(() => {})
  }, [loadChannels, loadCustomers])

  React.useEffect(
    () => () => {
      if (addressAbortRef.current) {
        addressAbortRef.current.abort()
        addressAbortRef.current = null
      }
      if (addressTimeoutRef.current) {
        clearTimeout(addressTimeoutRef.current)
        addressTimeoutRef.current = null
      }
    },
    [],
  )

  React.useEffect(() => {
    setAddressOptions((prev) =>
      prev.map((entry) => {
        const summary = formatAddressString(entry.value, addressFormat)
        const label = (entry.name && entry.name.trim().length ? entry.name : '') || summary || entry.id
        return { ...entry, summary, label }
      }),
    )
  }, [addressFormat])

  React.useEffect(() => {
    let cancelled = false
    async function fetchAddressFormat() {
      try {
        const call = await apiCall<{ addressFormat?: string }>('/api/customers/settings/address-format')
        const format = typeof call.result?.addressFormat === 'string' ? call.result.addressFormat : null
        if (!cancelled && (format === 'street_first' || format === 'line_first')) {
          setAddressFormat(format)
        }
      } catch (err) {
        console.error('sales.documents.addressFormat', err)
      } finally {
      }
    }
    fetchAddressFormat().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const resetAddressFormState = React.useCallback(
    (updateValue: (key: string, value: unknown) => void) => {
      updateValue('shippingAddressId', null)
      updateValue('billingAddressId', null)
      updateValue('shippingAddressDraft', undefined)
      updateValue('billingAddressDraft', undefined)
      updateValue('useCustomShipping', false)
      updateValue('useCustomBilling', false)
      updateValue('saveShippingAddress', false)
      updateValue('saveBillingAddress', false)
      updateValue('sameAsShipping', true)
    },
    [],
  )

  function DocumentNumberField({ value, setValue, values }: CrudCustomFieldRenderProps) {
    const formValues = (values ?? {}) as Partial<SalesDocumentFormValues>
    const kind: DocumentKind = formValues.documentKind === 'order' ? 'order' : 'quote'
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const autoValueRef = React.useRef<string | null>(null)
    const lastKindRef = React.useRef<DocumentKind | null>(null)

    const requestNumber = React.useCallback(async () => {
      setLoading(true)
      setError(null)
      try {
        const call = await apiCall<{ number?: string; error?: string }>('/api/sales/document-numbers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind }),
        })
        const nextNumber = typeof call.result?.number === 'string' ? call.result.number : null
        if (call.ok && nextNumber) {
          autoValueRef.current = nextNumber
          lastKindRef.current = kind
          setValue(nextNumber)
        } else {
          setError(call.result?.error || t('sales.documents.form.errors.numberGenerate', 'Could not generate a document number.'))
        }
      } catch (err) {
        console.error('sales.documents.generateNumber', err)
        setError(t('sales.documents.form.errors.numberGenerate', 'Could not generate a document number.'))
      } finally {
        setLoading(false)
      }
    }, [kind, setValue, t])

    React.useEffect(() => {
      const current = typeof value === 'string' ? value.trim() : ''
      const wasAuto = autoValueRef.current && current === autoValueRef.current
      if (!current.length || (wasAuto && lastKindRef.current && lastKindRef.current !== kind)) {
        void requestNumber()
      } else {
        lastKindRef.current = kind
      }
    }, [kind, requestNumber, value])

    return (
      <div className="space-y-2">
        <div className="flex w-full flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <Input
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => setValue(event.target.value)}
            disabled={loading}
            spellCheck={false}
            className="w-full md:flex-1"
          />
          <Button type="button" variant="outline" onClick={requestNumber} disabled={loading}>
            {loading
              ? t('sales.documents.form.numberLoading', 'Generating…')
              : t('sales.documents.form.numberRefresh', 'Generate')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {kind === 'order'
            ? t('sales.documents.form.numberHintOrder', 'Format applies to orders and uses the configured counter.')
            : t('sales.documents.form.numberHintQuote', 'Format applies to quotes and uses the configured counter.')}
        </p>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    )
  }

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'documentKind',
      label: '',
      type: 'custom',
      required: false,
      component: ({ value, setValue }) => {
        const current = value === 'order' ? 'order' : 'quote'
        const label = t('sales.documents.form.kind', 'Document type')
        return (
          <div className="space-y-2 pt-0">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">{label}</div>
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
      id: 'documentNumber',
      label: t('sales.documents.form.number', 'Document number'),
      type: 'custom',
      required: true,
      component: DocumentNumberField,
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
      component: ({ values, setFormValue }) => {
        const formValues = (values ?? {}) as Partial<SalesDocumentFormValues>
        const updateValue = setFormValue ?? (() => {})
        const useCustom = formValues.useCustomShipping === true
        const selectedId = typeof formValues.shippingAddressId === 'string' ? formValues.shippingAddressId : ''
        const draft = (formValues.shippingAddressDraft ?? {}) as AddressDraft
        const customerRequired = !formValues.customerEntityId
        const customerId = typeof formValues.customerEntityId === 'string' ? formValues.customerEntityId : null
        return (
          <div className="space-y-3">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-base font-semibold">
                  {t('sales.documents.form.shipping.title', 'Shipping address')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {customerRequired
                    ? t('sales.documents.form.address.customerRequired', 'Select customer first or define custom address')
                    : t('sales.documents.form.shipping.hint', 'Select an address or define a new one.')}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={useCustom}
                  onCheckedChange={(checked) => updateValue('useCustomShipping', checked)}
                />
                <span>{t('sales.documents.form.shipping.custom', 'Define new address')}</span>
              </label>
            </div>
            {!useCustom ? (
              <select
                className="w-full rounded border px-2 py-2 text-sm"
                value={selectedId}
                onChange={(evt) => updateValue('shippingAddressId', evt.target.value || null)}
                disabled={addressesLoading || customerRequired}
              >
                <option value="">
                  {addressesLoading
                    ? t('sales.documents.form.address.loading', 'Loading addresses…')
                    : t('sales.documents.form.address.placeholder', 'Select address')}
                </option>
                {addressOptions.map((addr) => {
                  const optionLabel = addr.summary ? `${addr.label} — ${addr.summary}` : addr.label
                  return (
                    <option key={addr.id} value={addr.id}>{optionLabel}</option>
                  )
                })}
              </select>
            ) : null}
            {useCustom ? (
              <div className="space-y-3">
                <AddressEditor
                  value={draft}
                  format={addressFormat}
                  t={t}
                  onChange={(next) => updateValue('shippingAddressDraft', next)}
                  hidePrimaryToggle
                />
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <Switch
                    checked={formValues.saveShippingAddress === true}
                    onCheckedChange={(checked) => updateValue('saveShippingAddress', checked)}
                  />
                  {t('sales.documents.form.address.saveToCustomer', 'Save this address to the customer')}
                </label>
              </div>
            ) : null}
            {addressesError && customerId ? (
              <div className="flex items-start justify-between gap-3 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <span className="flex-1">{addressesError}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => loadAddresses(customerId)}
                  disabled={addressesLoading}
                  className="shrink-0"
                >
                  {t('sales.documents.detail.retry', 'Try again')}
                </Button>
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
      component: function BillingAddressSectionField({ values, setFormValue }) {
        const formValues = (values ?? {}) as Partial<SalesDocumentFormValues>
        const updateValue = setFormValue ?? (() => {})
        const useCustom = formValues.useCustomBilling === true
        const selectedId = typeof formValues.billingAddressId === 'string' ? formValues.billingAddressId : ''
        const draft = (formValues.billingAddressDraft ?? {}) as AddressDraft
        const customerRequired = !formValues.customerEntityId
        const sameAsShipping = formValues.sameAsShipping !== false
        const shippingId = typeof formValues.shippingAddressId === 'string' ? formValues.shippingAddressId : null
        const shippingDraft = (formValues.shippingAddressDraft ?? {}) as AddressDraft
        const shippingDraftKey = JSON.stringify(shippingDraft)
        const billingDraftKey = JSON.stringify(draft)
        const useCustomShipping = formValues.useCustomShipping === true

        React.useEffect(() => {
          if (!sameAsShipping) return
          if ((formValues.billingAddressId ?? null) !== shippingId) {
            updateValue('billingAddressId', shippingId)
          }
          if (useCustomShipping !== (formValues.useCustomBilling === true)) {
            updateValue('useCustomBilling', useCustomShipping)
          }
          if (useCustomShipping && shippingDraftKey !== billingDraftKey) {
            updateValue('billingAddressDraft', shippingDraft)
          }
        }, [
          billingDraftKey,
          sameAsShipping,
          updateValue,
          shippingDraft,
          shippingDraftKey,
          shippingId,
          useCustomShipping,
          formValues.billingAddressId,
          formValues.useCustomBilling,
        ])

        return (
          <div className="space-y-3">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
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
                    updateValue('sameAsShipping', checked)
                    if (checked) {
                      updateValue('useCustomBilling', useCustomShipping)
                      updateValue('billingAddressId', shippingId)
                      updateValue('billingAddressDraft', shippingDraft)
                    }
                  }}
                />
                <span>{t('sales.documents.form.address.sameAsShipping', 'Same as shipping')}</span>
              </label>
            </div>

            {!sameAsShipping ? (
              <>
                {!useCustom ? (
                  <select
                    className="w-full rounded border px-2 py-2 text-sm"
                    value={selectedId}
                    onChange={(evt) => updateValue('billingAddressId', evt.target.value || null)}
                    disabled={addressesLoading || customerRequired}
                  >
                    <option value="">
                      {addressesLoading
                        ? t('sales.documents.form.address.loading', 'Loading addresses…')
                        : t('sales.documents.form.address.placeholder', 'Select address')}
                    </option>
                    {addressOptions.map((addr) => {
                      const optionLabel = addr.summary ? `${addr.label} — ${addr.summary}` : addr.label
                      return (
                        <option key={addr.id} value={addr.id}>{optionLabel}</option>
                      )
                    })}
                  </select>
                ) : null}

                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={useCustom}
                    onCheckedChange={(checked) => updateValue('useCustomBilling', checked)}
                    disabled={false}
                  />
                  <span>{t('sales.documents.form.shipping.custom', 'Define new address')}</span>
                </label>

                {useCustom ? (
                  <div className="space-y-3">
                    <AddressEditor
                      value={draft}
                      format={addressFormat}
                      t={t}
                      onChange={(next) => updateValue('billingAddressDraft', next)}
                      hidePrimaryToggle
                    />
                    <label className="col-span-2 flex items-center gap-2 text-sm">
                      <Switch
                        checked={formValues.saveBillingAddress === true}
                        onCheckedChange={(checked) => updateValue('saveBillingAddress', checked)}
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
  ], [
    addressFormat,
    addressOptions,
    addressesError,
    addressesLoading,
    currencyLabels,
    fetchCurrencyOptions,
    loadAddresses,
    loadChannels,
    loadCustomers,
    resetAddressFormState,
    t,
  ])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'docType', title: '', column: 1, fields: ['documentKind', 'documentNumber'] },
    {
      id: 'customer',
      title: '',
      column: 1,
      fields: [],
      component: function CustomerGroupComponent({ values, setValue }) {
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
                  if (next !== values.customerEntityId) {
                    resetAddressFormState(setValue)
                  }
                  setValue('customerEntityId', next)
                  loadAddresses(next)
                  if (next) {
                    const match = customers.find((entry) => entry.id === next)
                    const possibleEmail =
                      typeof match?.primaryEmail === 'string' && match.primaryEmail.length
                        ? match.primaryEmail
                        : null
                    if (possibleEmail) {
                      setValue('customerEmail', possibleEmail)
                    } else {
                      fetchCustomerEmail(next, match?.kind)
                        .then((email) => {
                          if (email) setValue('customerEmail', email)
                        })
                        .catch(() => {})
                    }
                  }
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
                    onCreated={({ id, email, label, kind, subtitle }) => {
                      // Seed the search box with the new customer's display name so it renders immediately
                      customerQuerySetter.current?.(label)
                      setCustomers((prev) => {
                        const exists = prev.some((entry) => entry.id === id)
                        if (exists) return prev
                        const next: CustomerOption = {
                          id,
                          label,
                          subtitle: subtitle ?? undefined,
                          kind,
                          primaryEmail: email ?? null,
                        }
                        return [next, ...prev]
                      })
                      setValue('customerEntityId', id)
                      resetAddressFormState(setValue)
                      loadAddresses(id)
                      if (email && !values.customerEmail) {
                        setValue('customerEmail', email)
                      }
                    }}
                  />
                }
                onReady={({ setQuery }) => {
                  customerQuerySetter.current = setQuery
                }}
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
                    size="sm"
                    variant="secondary"
                    className="px-4"
                    type="button"
                    disabled={values.customerEntityId === duplicate.id}
                    aria-disabled={values.customerEntityId === duplicate.id}
                    onClick={() => {
                      setValue('customerEntityId', duplicate.id)
                      resetAddressFormState(setValue)
                      loadAddresses(duplicate.id)
                    }}
                  >
                    {values.customerEntityId === duplicate.id
                      ? t('sales.documents.form.email.alreadySelected', 'Selected customer')
                      : t('sales.documents.form.email.selectCustomer', 'Select customer')}
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
  ], [
    customers,
    fetchCustomerEmail,
    loadAddresses,
    loadCustomers,
    resetAddressFormState,
    t,
  ])

  const initialValues = React.useMemo<Partial<SalesDocumentFormValues>>(
    () => ({
      documentKind: initialKind === 'order' ? 'order' : 'quote',
      documentNumber: '',
      currencyCode: 'USD',
      useCustomShipping: false,
      useCustomBilling: false,
      sameAsShipping: true,
    }),
    [initialKind]
  )

  const handleSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      const safeValues = values ?? {}
      const customFields = collectCustomFieldValues(safeValues)
      const base = Object.fromEntries(
        Object.entries(safeValues).filter(([key]) => !key.startsWith('cf_') && !key.startsWith('cf:'))
      ) as SalesDocumentFormValues
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
      const documentNumber = typeof base.documentNumber === 'string' ? base.documentNumber.trim() : ''
      if (!documentNumber) {
        throw createCrudFormError(t('sales.documents.form.errors.numberRequired', 'Document number is required.'))
      }
      if (documentKind === 'order') {
        payload.orderNumber = documentNumber
      } else {
        payload.quoteNumber = documentNumber
      }
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
      if (shippingSnapshot) {
        payload.shippingAddressSnapshot = shippingSnapshot
        payload.shippingAddressId = undefined
      }
      if (billingSnapshot) {
        payload.billingAddressSnapshot = billingSnapshot
        payload.billingAddressId = undefined
      }
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
            buildingNumber: shippingSnapshot.buildingNumber ?? undefined,
            flatNumber: shippingSnapshot.flatNumber ?? undefined,
            city: shippingSnapshot.city ?? undefined,
            region: shippingSnapshot.region ?? undefined,
            postalCode: shippingSnapshot.postalCode ?? undefined,
            country: shippingSnapshot.country ?? undefined,
            purpose: shippingSnapshot.purpose ?? undefined,
            isPrimary: shippingSnapshot.isPrimary ?? undefined,
          })
          if (res?.result?.id) shippingId = res.result.id
        }
        if (base.customerEntityId && billingSnapshot && base.saveBillingAddress) {
          const res = await createCrud<{ id?: string }>('customers/addresses', {
            entityId: base.customerEntityId,
            addressLine1: billingSnapshot.addressLine1 ?? billingSnapshot.name ?? 'Address',
            name: billingSnapshot.name ?? undefined,
            addressLine2: billingSnapshot.addressLine2 ?? undefined,
            buildingNumber: billingSnapshot.buildingNumber ?? undefined,
            flatNumber: billingSnapshot.flatNumber ?? undefined,
            city: billingSnapshot.city ?? undefined,
            region: billingSnapshot.region ?? undefined,
            postalCode: billingSnapshot.postalCode ?? undefined,
            country: billingSnapshot.country ?? undefined,
            purpose: billingSnapshot.purpose ?? undefined,
            isPrimary: billingSnapshot.isPrimary ?? undefined,
          })
          if (res?.result?.id) billingId = res.result.id
        }
        if (!base.useCustomShipping && shippingId) payload.shippingAddressId = shippingId
        if (!base.useCustomBilling && !sameAsShipping && billingId) payload.billingAddressId = billingId
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
    />
  )
}
