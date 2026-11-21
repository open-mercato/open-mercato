"use client"

import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import {
  AddressCustomFieldEditor,
  useAddressCustomFields,
  useAddressCustomValueDraft,
} from '@open-mercato/ui/backend/detail/AddressCustomFields'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { AddressEditor, type AddressEditorDraft } from '@open-mercato/core/modules/customers/components/AddressEditor'
import { CustomFieldValuesList } from '@open-mercato/core/modules/customers/components/detail/CustomFieldValuesList'
import {
  AddressView,
  formatAddressString,
  type AddressFormatStrategy,
  type AddressValue,
} from '@open-mercato/core/modules/customers/utils/addressFormat'
import { Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { asAddressValues, selectAddressValuesForCopy } from './addressCustomValueClient'

const logger = createLogger('sales')

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

type AddressOption = {
  id: string
  label: string
  summary: string
  value: AddressValue
  name?: string | null
  purpose?: string | null
  customValues?: Record<string, unknown> | null
}

export type SalesDocumentAddressesSectionProps = {
  documentId: string
  kind: 'order' | 'quote'
  customerId?: string | null
  shippingAddressId?: string | null
  billingAddressId?: string | null
  shippingAddressSnapshot?: Record<string, unknown> | null
  billingAddressSnapshot?: Record<string, unknown> | null
  shippingAddressCustomValues?: Record<string, unknown> | null
  billingAddressCustomValues?: Record<string, unknown> | null
  updatedAt?: string | null
  lockedReason?: string | null
  onReload?: () => Promise<void>
  onUpdated?: (patch: {
    shippingAddressId?: string | null
    billingAddressId?: string | null
    shippingAddressSnapshot?: Record<string, unknown> | null
    billingAddressSnapshot?: Record<string, unknown> | null
  }) => void
}

const emptyDraft: AddressEditorDraft = {
  name: '',
  purpose: '',
  companyName: '',
  addressLine1: '',
  addressLine2: '',
  buildingNumber: '',
  flatNumber: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
  taxId: '',
  taxIdType: '',
  phone: '',
  isPrimary: false,
}

const EDITABLE_SNAPSHOT_KEYS = new Set(Object.keys(emptyDraft))

/**
 * The fields the editor owns, typed, plus whatever else the caller's snapshot carried.
 *
 * The index signature is what lets an integration's extra keys — anything a future
 * integration writes — survive the merge-back below, while the named fields stay `string` for callers
 * that read them. `taxId` and `phone` are NOT among them any more: the editor renders both, so they
 * are assigned from the draft like every other field. Reading
 * `normalized.city` off a bare `Record<string, unknown>` yields `unknown`, which is what forced the
 * `@ts-nocheck` on this file.
 */
type NormalizedAddressDraft = {
  name?: string
  purpose?: string
  companyName?: string
  addressLine1?: string
  addressLine2?: string
  buildingNumber?: string
  flatNumber?: string
  city?: string
  region?: string
  postalCode?: string
  country?: string
  taxId?: string
  phone?: string
  isPrimary?: boolean
} & Record<string, unknown>

function normalizeAddressDraft(
  draft?: AddressEditorDraft | null,
  previous?: Record<string, unknown> | null,
): NormalizedAddressDraft | null {
  if (!draft) return null
  const normalized: NormalizedAddressDraft = {}
  let hasEditableContent = false
  const assign = (key: keyof AddressEditorDraft, target: string) => {
    const value = draft[key]
    if (typeof value === 'string' && value.trim().length) {
      normalized[target] = value.trim()
      hasEditableContent = true
    }
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
  assign('taxId', 'taxId')
  assign('taxIdType', 'taxIdType')
  assign('phone', 'phone')
  assign('isPrimary', 'isPrimary')
  if (!hasEditableContent) return null
  if (previous) {
    for (const [key, value] of Object.entries(previous)) {
      if (EDITABLE_SNAPSHOT_KEYS.has(key)) continue
      if (value === undefined) continue
      normalized[key] = value
    }
  }
  return normalized
}

function draftFromSnapshot(snapshot?: Record<string, unknown> | null): AddressEditorDraft {
  const record = snapshot ?? {}
  return {
    name: typeof record.name === 'string' ? record.name : '',
    purpose: typeof record.purpose === 'string' ? record.purpose : '',
    companyName: typeof record.companyName === 'string' ? record.companyName : '',
    addressLine1: typeof record.addressLine1 === 'string' ? record.addressLine1 : '',
    addressLine2: typeof record.addressLine2 === 'string' ? record.addressLine2 : '',
    buildingNumber: typeof record.buildingNumber === 'string' ? record.buildingNumber : '',
    flatNumber: typeof record.flatNumber === 'string' ? record.flatNumber : '',
    city: typeof record.city === 'string' ? record.city : '',
    region: typeof record.region === 'string' ? record.region : '',
    postalCode: typeof record.postalCode === 'string' ? record.postalCode : '',
    country: typeof record.country === 'string' ? record.country : '',
    taxId: typeof record.taxId === 'string' ? record.taxId : '',
    taxIdType: typeof record.taxIdType === 'string' ? record.taxIdType : '',
    phone: typeof record.phone === 'string' ? record.phone : '',
    isPrimary: record.isPrimary === true,
  }
}

function deepEqual(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

type DocumentAddressAssignment = {
  id: string
  value: AddressValue
  summary: string
  customerAddressId?: string | null
  name?: string | null
  purpose?: string | null
  companyName?: string | null
  updatedAt?: string | null
  customValues?: Record<string, unknown> | null
}

function readStringField(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string') return value
  }
  return null
}

function mapApiAddress(item: Record<string, unknown>, format: AddressFormatStrategy): AddressOption | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const read = (keys: string[]) => readStringField(item, keys)
  const value: AddressValue = {
    addressLine1: read(['address_line1', 'addressLine1']),
    addressLine2: read(['address_line2', 'addressLine2']),
    buildingNumber: read(['building_number', 'buildingNumber']),
    flatNumber: read(['flat_number', 'flatNumber']),
    city: read(['city']),
    region: read(['region']),
    postalCode: read(['postal_code', 'postalCode']),
    country: read(['country']),
    companyName: read(['company_name', 'companyName']),
  }
  const name = (read(['name']) ?? '').trim()
  const purpose = (read(['purpose']) ?? '').trim()
  const summary = formatAddressString(value, format)
  const label = name || summary || id
  return { id, label, summary, value, name: name || null, purpose: purpose || null, customValues: asAddressValues(item.customValues) }
}

function mergeAddressOption(options: AddressOption[], selected: AddressOption | null): AddressOption[] {
  if (!selected) return options
  if (options.some((option) => option.id === selected.id)) return options
  return [selected, ...options]
}

function draftFromDocumentAddress(entry: DocumentAddressAssignment): AddressEditorDraft {
  return {
    name: entry.name ?? '',
    purpose: entry.purpose ?? '',
    companyName: entry.companyName ?? entry.value.companyName ?? '',
    addressLine1: entry.value.addressLine1 ?? '',
    addressLine2: entry.value.addressLine2 ?? '',
    buildingNumber: entry.value.buildingNumber ?? '',
    flatNumber: entry.value.flatNumber ?? '',
    city: entry.value.city ?? '',
    region: entry.value.region ?? '',
    postalCode: entry.value.postalCode ?? '',
    country: entry.value.country ?? '',
    isPrimary: false,
  }
}

export function SalesDocumentAddressesSection({
  documentId,
  kind,
  customerId,
  shippingAddressId,
  billingAddressId,
  shippingAddressSnapshot,
  billingAddressSnapshot,
  shippingAddressCustomValues,
  billingAddressCustomValues,
  updatedAt,
  lockedReason,
  onReload,
  onUpdated,
}: SalesDocumentAddressesSectionProps) {
  const t = useT()
  const organizationScopeVersion = useOrganizationScopeVersion()
  const fieldStructure = useAddressCustomFields('sales:sales_document_address')
  const customerFieldStructure = useAddressCustomFields('customers:customer_address', Boolean(customerId))
  const fieldLabels = {
    loading: t('sales.documents.form.address.loading', 'Loading addresses…'),
    error: t('sales.documents.detail.addresses.loadError', 'Failed to load addresses.'),
    retry: t('sales.documents.detail.retry', 'Try again'),
  }
  const customFields = {
    structure: fieldStructure,
    labels: fieldLabels,
    renderValues: (values: Record<string, unknown>) => (
      <CustomFieldValuesList values={values} definitions={fieldStructure.definitions} />
    ),
  }
  const shippingFields = useAddressCustomValueDraft(customFields)
  const billingFields = useAddressCustomValueDraft(customFields)
  const additionalFields = useAddressCustomValueDraft(customFields)
  const editingFields = useAddressCustomValueDraft(customFields)
  const [shippingCopySource, setShippingCopySource] = React.useState<string | null>(null)
  const [billingCopySource, setBillingCopySource] = React.useState<string | null>(null)
  const [additionalCopySource, setAdditionalCopySource] = React.useState<string | null>(null)
  const [mirrorBillingFields, setMirrorBillingFields] = React.useState(false)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [addressOptions, setAddressOptions] = React.useState<AddressOption[]>([])
  const [addressesLoading, setAddressesLoading] = React.useState(false)
  const [addressesError, setAddressesError] = React.useState<string | null>(null)
  const addressRequestVersion = React.useRef(0)
  const [addressFormat, setAddressFormat] = React.useState<AddressFormatStrategy>('line_first')
  const [useCustomShipping, setUseCustomShipping] = React.useState<boolean>(
    !!shippingAddressSnapshot && !shippingAddressId
  )
  const [useCustomBilling, setUseCustomBilling] = React.useState<boolean>(
    billingAddressSnapshot && !billingAddressId
      ? true
      : !!shippingAddressSnapshot && !shippingAddressId
  )
  const [sameAsShipping, setSameAsShipping] = React.useState<boolean>(() => {
    if (shippingAddressSnapshot || billingAddressSnapshot) {
      return deepEqual(shippingAddressSnapshot, billingAddressSnapshot) && deepEqual(shippingAddressCustomValues, billingAddressCustomValues)
    }
    if (!billingAddressId) return true
    return shippingAddressId === billingAddressId
  })
  const [shippingAddressIdState, setShippingAddressId] = React.useState<string | null>(shippingAddressId ?? null)
  const [billingAddressIdState, setBillingAddressId] = React.useState<string | null>(
    billingAddressId ?? shippingAddressId ?? null
  )
  const [shippingDraft, setShippingDraft] = React.useState<AddressEditorDraft>(
    draftFromSnapshot(shippingAddressSnapshot)
  )
  const [billingDraft, setBillingDraft] = React.useState<AddressEditorDraft>(
    draftFromSnapshot(billingAddressSnapshot ?? (sameAsShipping ? shippingAddressSnapshot : null))
  )
  const [saveShippingAddress, setSaveShippingAddress] = React.useState(false)
  const [saveBillingAddress, setSaveBillingAddress] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [documentAddresses, setDocumentAddresses] = React.useState<DocumentAddressAssignment[]>([])
  const [documentAddressesLoading, setDocumentAddressesLoading] = React.useState(false)
  const [documentAddressesError, setDocumentAddressesError] = React.useState<string | null>(null)
  const [additionalFormOpen, setAdditionalFormOpen] = React.useState(false)
  const [additionalUseCustom, setAdditionalUseCustom] = React.useState(false)
  const [additionalSelectedId, setAdditionalSelectedId] = React.useState('')
  const [additionalDraft, setAdditionalDraft] = React.useState<AddressEditorDraft>(emptyDraft)
  const [additionalSaving, setAdditionalSaving] = React.useState(false)
  const [deletingAddressIds, setDeletingAddressIds] = React.useState<Set<string>>(new Set())
  const locked = Boolean(lockedReason)
  const [editingAddressId, setEditingAddressId] = React.useState<string | null>(null)
  const [editingDraft, setEditingDraft] = React.useState<AddressEditorDraft>(emptyDraft)
  const [editingSaving, setEditingSaving] = React.useState(false)
  const mutationContextId = React.useMemo(
    () => `sales-document-addresses:${kind}:${documentId}`,
    [documentId, kind],
  )
  const resourceKind = React.useMemo(() => (kind === 'order' ? 'sales.order' : 'sales.quote'), [kind])
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    kind: 'order' | 'quote'
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({
      formId: mutationContextId,
      resourceKind,
      resourceId: documentId,
      kind,
      retryLastMutation,
    }),
    [documentId, kind, mutationContextId, resourceKind, retryLastMutation],
  )
  const runGuardedMutation = React.useCallback(
    async <T,>(operation: () => Promise<T>, mutationPayload: Record<string, unknown>) =>
      runMutation({
        operation,
        mutationPayload,
        context: mutationContext,
      }),
    [mutationContext, runMutation],
  )

  const customerRequired = !customerId
  const hasSavedAddresses = addressOptions.length > 0
  // With no saved addresses the only thing the form can do is define a new one, so it
  // opens straight on the address fields instead of an empty select (#6194). The choice
  // follows the saved addresses as they load, until the user picks a side themselves.
  const additionalModeTouchedRef = React.useRef(false)
  const openAdditionalForm = React.useCallback(() => {
    additionalModeTouchedRef.current = false
    setAdditionalUseCustom(!hasSavedAddresses)
    setAdditionalSelectedId('')
    additionalFields.reset()
    setAdditionalCopySource(null)
    setAdditionalFormOpen(true)
  }, [additionalFields.reset, hasSavedAddresses])
  React.useEffect(() => {
    if (!additionalFormOpen || addressesLoading) return
    if (!hasSavedAddresses) setAdditionalUseCustom(true)
    else if (!additionalModeTouchedRef.current) setAdditionalUseCustom(false)
  }, [additionalFormOpen, addressesLoading, hasSavedAddresses])
  const addressOptionsMap = React.useMemo(() => {
    const map = new Map<string, AddressOption>()
    addressOptions.forEach((entry) => map.set(entry.id, entry))
    return map
  }, [addressOptions])

  const copyPreview = React.useCallback((id: string | null) => (
    selectAddressValuesForCopy(id ? addressOptionsMap.get(id)?.customValues : null, customerFieldStructure, fieldStructure)
  ), [addressOptionsMap, customerFieldStructure, fieldStructure])
  const shippingPreview = React.useMemo(() => copyPreview(shippingCopySource), [copyPreview, shippingCopySource])
  const billingPreview = React.useMemo(() => copyPreview(billingCopySource), [billingCopySource, copyPreview])
  const additionalPreview = React.useMemo(() => copyPreview(additionalCopySource), [additionalCopySource, copyPreview])
  React.useEffect(() => {
    if (shippingCopySource) shippingFields.setInitialValues(shippingPreview ?? {})
  }, [shippingCopySource, shippingFields.setInitialValues, shippingPreview])
  React.useEffect(() => {
    if (billingCopySource) billingFields.setInitialValues(billingPreview ?? {})
  }, [billingCopySource, billingFields.setInitialValues, billingPreview])
  React.useEffect(() => {
    if (additionalCopySource) additionalFields.setInitialValues(additionalPreview ?? {})
  }, [additionalCopySource, additionalFields.setInitialValues, additionalPreview])
  const copyShippingFields = shippingPreview !== null
  const copyBillingFields = billingPreview !== null
  const copyAdditionalFields = additionalPreview !== null

  const resolveAddressSummary = React.useCallback(
    (value: AddressValue) => {
      const summary = formatAddressString(value, addressFormat)
      if (summary) return summary
      return (
        value.addressLine1 ??
        value.addressLine2 ??
        value.city ??
        value.region ??
        value.postalCode ??
        value.country ??
        ''
      )
    },
    [addressFormat]
  )

  React.useEffect(() => {
    setDocumentAddresses((prev) =>
      prev.map((entry) => ({
        ...entry,
        summary: resolveAddressSummary(entry.value),
      }))
    )
  }, [resolveAddressSummary])

  React.useEffect(() => {
    if (editingAddressId && !documentAddresses.some((entry) => entry.id === editingAddressId)) {
      setEditingAddressId(null)
      setEditingDraft(emptyDraft)
      setEditingSaving(false)
    }
  }, [documentAddresses, editingAddressId])

  const loadDocumentAddresses = React.useCallback(async () => {
    if (!documentId) return
    setDocumentAddressesLoading(true)
    try {
      setDocumentAddressesError(null)
      const params = new URLSearchParams({ documentId, documentKind: kind })
      const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/document-addresses?${params.toString()}`
      )
      if (call.ok && Array.isArray(call.result?.items)) {
        const mapped = call.result.items
          .map((item) => {
            const id = typeof item.id === 'string' ? item.id : null
            if (!id) return null
            const read = (keys: string[]) => readStringField(item, keys)
            const value: AddressValue = {
              addressLine1: read(['address_line1', 'addressLine1']),
              addressLine2: read(['address_line2', 'addressLine2']),
              buildingNumber: read(['building_number', 'buildingNumber']),
              flatNumber: read(['flat_number', 'flatNumber']),
              city: read(['city']),
              region: read(['region']),
              postalCode: read(['postal_code', 'postalCode']),
              country: read(['country']),
              companyName: read(['company_name', 'companyName']),
            }
            return {
              id,
              value,
              summary: resolveAddressSummary(value),
              customerAddressId: read(['customer_address_id', 'customerAddressId']),
              name: read(['name']),
              purpose: read(['purpose']),
              companyName: value.companyName ?? null,
              customValues: asAddressValues(item.customValues),
              updatedAt: read(['updated_at', 'updatedAt']),
            }
          })
          // Narrow to non-null only. Asserting `DocumentAddressAssignment` here was wrong: its
          // optional fields (`name?`, `purpose?`, …) admit `undefined`, which the mapped literal's
          // `string | null` does not, so the predicate was not assignable to what it filtered.
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        setDocumentAddresses(mapped)
      } else {
        setDocumentAddresses([])
      }
    } catch (err) {
      logger.error('sales.documents.addresses.document.load', { err })
      const message = t('sales.documents.detail.addresses.loadError', 'Failed to load addresses.')
      flash(message, 'error')
      setDocumentAddressesError(message)
      setDocumentAddresses([])
    } finally {
      setDocumentAddressesLoading(false)
    }
  }, [documentId, kind, resolveAddressSummary, t])

  React.useEffect(() => {
    const shippingCustom = !!shippingAddressSnapshot && !shippingAddressId
    const billingCustom = !!billingAddressSnapshot && !billingAddressId
    const nextSame = shippingAddressSnapshot || billingAddressSnapshot
      ? deepEqual(shippingAddressSnapshot, billingAddressSnapshot) && deepEqual(shippingAddressCustomValues, billingAddressCustomValues)
      : !billingAddressId || billingAddressId === shippingAddressId
    setUseCustomShipping(shippingCustom)
    setUseCustomBilling(nextSame ? shippingCustom : billingCustom)
    setSameAsShipping(nextSame)
    setShippingDraft(draftFromSnapshot(shippingAddressSnapshot))
    setBillingDraft(
      draftFromSnapshot(
        nextSame
          ? billingAddressSnapshot ?? shippingAddressSnapshot ?? null
          : billingAddressSnapshot ?? null
      )
    )
    setShippingAddressId(shippingAddressId ?? null)
    setBillingAddressId(nextSame ? shippingAddressId ?? billingAddressId ?? null : billingAddressId ?? null)
    setSaveShippingAddress(false)
    setSaveBillingAddress(false)
    shippingFields.reset(shippingAddressCustomValues ?? {})
    billingFields.reset(billingAddressCustomValues ?? {})
    setShippingCopySource(null)
    setBillingCopySource(null)
    setMirrorBillingFields(false)
  }, [billingAddressId, billingAddressCustomValues, billingAddressSnapshot, billingFields.reset, documentId, shippingAddressId, shippingAddressCustomValues, shippingAddressSnapshot, shippingFields.reset])

  React.useEffect(() => {
    loadDocumentAddresses().catch(() => {})
  }, [loadDocumentAddresses])

  React.useEffect(() => {
    if (!sameAsShipping) return
    const nextUseCustomBilling = useCustomShipping
    if (useCustomBilling !== nextUseCustomBilling) {
      setUseCustomBilling(nextUseCustomBilling)
    }
    if (useCustomShipping) {
      if (!deepEqual(shippingDraft, billingDraft)) {
        setBillingDraft(shippingDraft)
      }
      if (billingAddressIdState !== null) {
        setBillingAddressId(null)
      }
    } else {
      if (billingAddressIdState !== shippingAddressIdState) {
        setBillingAddressId(shippingAddressIdState)
      }
      if (!deepEqual(billingDraft, emptyDraft)) {
        setBillingDraft(emptyDraft)
      }
    }
  }, [
    billingAddressIdState,
    billingDraft,
    sameAsShipping,
    shippingAddressIdState,
    shippingDraft,
    useCustomBilling,
    useCustomShipping,
  ])

  const loadAddresses = React.useCallback(
    async (id?: string | null) => {
      const version = ++addressRequestVersion.current
      if (!id) {
        setAddressOptions([])
        setAddressesLoading(false)
        return
      }
      setAddressesLoading(true)
      setAddressesError(null)
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '50', entityId: id })
        const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/customers/addresses?${params.toString()}`
        )
        if (version !== addressRequestVersion.current) return
        if (call.ok && Array.isArray(call.result?.items)) {
          const options = call.result.items
            .map((item) => mapApiAddress(item, addressFormat))
            .filter((entry): entry is AddressOption => !!entry)
          setAddressOptions(options)
        } else {
          setAddressOptions([])
        }
      } catch (err) {
        if (version !== addressRequestVersion.current) return
        logger.error('sales.documents.addresses.load', { err })
        const message = t('sales.documents.detail.addresses.loadError', 'Failed to load addresses.')
        setAddressesError(message)
        flash(message, 'error')
        setAddressOptions([])
      } finally {
        if (version === addressRequestVersion.current) setAddressesLoading(false)
      }
    },
    [addressFormat, t]
  )

  const loadAddressOptionById = React.useCallback(
    async (addressId: string): Promise<AddressOption | null> => {
      if (!customerId) return null
      const params = new URLSearchParams({ id: addressId, entityId: customerId, pageSize: '1' })
      const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/customers/addresses?${params.toString()}`
      )
      const items = Array.isArray(call.result?.items) ? call.result.items : []
      return (
        items
          .map((item) => mapApiAddress(item, addressFormat))
          .find((entry): entry is AddressOption => entry?.id === addressId) ?? null
      )
    },
    [addressFormat, customerId]
  )

  React.useEffect(() => {
    setAddressOptions([])
    loadAddresses(customerId).catch(() => {})
    return () => { addressRequestVersion.current += 1 }
  }, [customerId, loadAddresses, organizationScopeVersion])

  React.useEffect(() => {
    const selectedIds = [shippingAddressIdState, billingAddressIdState].filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )
    const missingIds = selectedIds.filter((id) => !addressOptions.some((option) => option.id === id))
    if (!missingIds.length) return
    let active = true
    Promise.all(missingIds.map((id) => loadAddressOptionById(id).catch(() => null)))
      .then((selectedOptions) => {
        if (!active) return
        setAddressOptions((current) =>
          selectedOptions.reduce(
            (next, selected) => mergeAddressOption(next, selected),
            current
          )
        )
      })
      .catch(() => {})
    return () => { active = false }
  }, [addressOptions, billingAddressIdState, loadAddressOptionById, organizationScopeVersion, shippingAddressIdState])

  const guardLocked = React.useCallback(() => {
    if (!locked) return false
    if (lockedReason) {
      flash(lockedReason, 'error')
    }
    return true
  }, [locked, lockedReason])

  React.useEffect(() => {
    setAddressOptions((prev) =>
      prev.map((entry) => {
        const summary = formatAddressString(entry.value, addressFormat)
        const label = (entry.name && entry.name.trim().length ? entry.name : '') || summary || entry.id
        return { ...entry, summary, label }
      })
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
        logger.error('sales.documents.addresses.format', { err })
      }
    }
    fetchAddressFormat().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const shippingOptions = React.useMemo(() => {
    if (shippingAddressIdState && !addressOptions.some((entry) => entry.id === shippingAddressIdState)) {
      const fallback: AddressOption = {
        id: shippingAddressIdState,
        label: shippingAddressIdState,
        summary: '',
        value: { addressLine1: null },
      }
      return [fallback, ...addressOptions]
    }
    return addressOptions
  }, [addressOptions, shippingAddressIdState])

  const billingOptions = React.useMemo(() => {
    if (billingAddressIdState && !addressOptions.some((entry) => entry.id === billingAddressIdState)) {
      const fallback: AddressOption = {
        id: billingAddressIdState,
        label: billingAddressIdState,
        summary: '',
        value: { addressLine1: null },
      }
      return [fallback, ...addressOptions]
    }
    return addressOptions
  }, [addressOptions, billingAddressIdState])

  const handleAddAdditionalAddress = React.useCallback(async () => {
    if (guardLocked()) return
    if (!customerId) {
      flash(t('sales.documents.form.address.customerRequired', 'Select a customer first'), 'error')
      return
    }
    if (!additionalUseCustom && !additionalSelectedId) {
      flash(t('sales.documents.detail.addresses.select', 'Select an address to add.'), 'error')
      return
    }
    const fields = additionalFields.prepare()
    if (!fields.valid) return
    setAdditionalSaving(true)
    try {
      let resolvedValue: AddressValue | null = null
      let customerAddressId: string | null = null
      let name: string | undefined
      let purpose: string | undefined

      if (additionalUseCustom) {
        const normalized = normalizeAddressDraft(additionalDraft)
        name = normalized?.name ?? undefined
        purpose = normalized?.purpose ?? undefined
        resolvedValue = {
          addressLine1: normalized?.addressLine1 ?? normalized?.name ?? 'Address',
          addressLine2: normalized?.addressLine2 ?? null,
          buildingNumber: normalized?.buildingNumber ?? null,
          flatNumber: normalized?.flatNumber ?? null,
          city: normalized?.city ?? null,
          region: normalized?.region ?? null,
          postalCode: normalized?.postalCode ?? null,
          country: normalized?.country ?? null,
          companyName: normalized?.companyName ?? null,
        }
      } else {
        const option = addressOptionsMap.get(additionalSelectedId)
        if (option) {
          resolvedValue = option.value
          customerAddressId = option.id
          name = option.name ?? undefined
          purpose = option.purpose ?? undefined
        }
      }

      if (!resolvedValue || !resolvedValue.addressLine1) {
        throw new Error(t('sales.documents.detail.addresses.saveError', 'Failed to update addresses.'))
      }

      const payload = {
        documentId,
        documentKind: kind,
        customerAddressId: customerAddressId ?? undefined,
        copyCustomerAddressCustomValues: copyAdditionalFields && !additionalUseCustom ? true : undefined,
        customValues: fields.customValues,
        name,
        purpose,
        addressLine1: resolvedValue.addressLine1,
        addressLine2: resolvedValue.addressLine2 ?? undefined,
        buildingNumber: resolvedValue.buildingNumber ?? undefined,
        flatNumber: resolvedValue.flatNumber ?? undefined,
        city: resolvedValue.city ?? undefined,
        region: resolvedValue.region ?? undefined,
        postalCode: resolvedValue.postalCode ?? undefined,
        country: resolvedValue.country ?? undefined,
        companyName: resolvedValue.companyName ?? undefined,
      }
      const call = await runGuardedMutation(
        () => apiCallOrThrow<Record<string, unknown>>('/api/sales/document-addresses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }, { errorMessage: t('sales.documents.detail.addresses.saveError', 'Failed to update addresses.') }),
        payload,
      )

      const savedId = typeof call.result?.id === 'string' ? call.result.id : null
      const assignedValue = resolvedValue

      setDocumentAddresses((prev) => [
        {
          id: savedId ?? `temp-${Date.now()}`,
          value: assignedValue,
          summary: resolveAddressSummary(assignedValue),
          customerAddressId: customerAddressId ?? null,
          name: name ?? null,
          purpose: purpose ?? null,
          companyName: assignedValue.companyName ?? null,
        },
        ...prev.filter((entry) => !savedId || entry.id !== savedId),
      ])
      if (additionalUseCustom || (customerAddressId && !addressOptionsMap.has(customerAddressId))) {
        loadAddresses(customerId).catch(() => {})
      }
      setAdditionalFormOpen(false)
      setAdditionalUseCustom(false)
      setAdditionalSelectedId('')
      setAdditionalDraft(emptyDraft)
      await loadDocumentAddresses()
      flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
    } catch (err) {
      if (additionalFields.showErrors(err)) return
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('sales.documents.detail.addresses.saveError', 'Failed to update addresses.')
      flash(message, 'error')
    } finally {
      setAdditionalSaving(false)
    }
  }, [
    additionalDraft,
    additionalSelectedId,
    additionalUseCustom,
    additionalFields,
    addressOptionsMap,
    copyAdditionalFields,
    customerId,
    documentId,
    guardLocked,
    kind,
    loadAddresses,
    loadDocumentAddresses,
    resolveAddressSummary,
    runGuardedMutation,
    t,
  ])

  const handleCancelEdit = React.useCallback(() => {
    setEditingAddressId(null)
    setEditingDraft(emptyDraft)
    setEditingSaving(false)
  }, [])

  const handleUpdateDocumentAddress = React.useCallback(async () => {
    if (!editingAddressId) return
    const current = documentAddresses.find((entry) => entry.id === editingAddressId)
    if (!current) {
      handleCancelEdit()
      return
    }
    if (guardLocked()) return
    const fields = editingFields.prepare()
    if (!fields.valid) return
    const normalizedRecord = (normalizeAddressDraft(editingDraft) ?? {}) as Record<string, unknown>
    const read = (key: string) => {
      const value = normalizedRecord[key]
      if (typeof value !== 'string') return ''
      const trimmed = value.trim()
      return trimmed.length ? trimmed : ''
    }
    const addressLine1 = read('addressLine1')
    if (!addressLine1) {
      flash(t('sales.documents.detail.addresses.line1Required', 'Add address line 1 to continue.'), 'error')
      return
    }
    const updatedValue: AddressValue = {
      addressLine1,
      addressLine2: read('addressLine2') || null,
      buildingNumber: read('buildingNumber') || null,
      flatNumber: read('flatNumber') || null,
      city: read('city') || null,
      region: read('region') || null,
      postalCode: read('postalCode') || null,
      country: read('country') || null,
      companyName: read('companyName') || null,
    }
    const nameValue = read('name') || null
    const purposeValue = read('purpose') || null

    setEditingSaving(true)
    try {
      const payload = {
        id: editingAddressId,
        documentId,
        documentKind: kind,
        customerAddressId: current.customerAddressId ?? undefined,
        customValues: fields.customValues,
        name: nameValue,
        purpose: purposeValue,
        companyName: updatedValue.companyName,
        addressLine1: updatedValue.addressLine1,
        addressLine2: updatedValue.addressLine2,
        buildingNumber: updatedValue.buildingNumber,
        flatNumber: updatedValue.flatNumber,
        city: updatedValue.city,
        region: updatedValue.region,
        postalCode: updatedValue.postalCode,
        country: updatedValue.country,
      }
      await runGuardedMutation(
        () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(current.updatedAt), () =>
            apiCallOrThrow(
              '/api/sales/document-addresses',
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              },
              { errorMessage: t('sales.documents.detail.addresses.saveError', 'Failed to update addresses.') },
            ),
          ),
        payload,
      )
      setDocumentAddresses((prev) =>
        prev.map((entry) =>
          entry.id === editingAddressId
            ? {
                ...entry,
                value: updatedValue,
                summary: resolveAddressSummary(updatedValue),
                name: nameValue,
                purpose: purposeValue,
                companyName: updatedValue.companyName ?? null,
              }
            : entry
        )
      )
      await loadDocumentAddresses()
      flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      handleCancelEdit()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: loadDocumentAddresses }) || editingFields.showErrors(err)) return
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('sales.documents.detail.addresses.saveError', 'Failed to update addresses.')
      flash(message, 'error')
    } finally {
      setEditingSaving(false)
    }
  }, [documentAddresses, documentId, editingAddressId, editingDraft, editingFields, guardLocked, handleCancelEdit, kind, loadDocumentAddresses, resolveAddressSummary, runGuardedMutation, t])

  const handleDeleteDocumentAddress = React.useCallback(
    async (id: string) => {
      if (guardLocked()) return
      const entry = documentAddresses.find((address) => address.id === id)
      const confirmMessage = t(
        'sales.documents.detail.addresses.deleteConfirm',
        'This will permanently remove this address from the document. Continue?'
      )
      const confirmed = await confirm({
        title: confirmMessage,
        variant: 'destructive',
      })
      if (!confirmed) return
      setDeletingAddressIds((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
      try {
        const payload = { id, documentId, documentKind: kind }
        await runGuardedMutation(
          () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(entry?.updatedAt), () =>
              apiCallOrThrow(
                '/api/sales/document-addresses',
                {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
                },
                { errorMessage: t('sales.documents.detail.addresses.deleteError', 'Failed to remove address.') },
              ),
            ),
          payload,
        )
        setDocumentAddresses((prev) => prev.filter((entry) => entry.id !== id))
        if (editingAddressId === id) {
          handleCancelEdit()
        }
        flash(t('sales.documents.detail.addresses.removed', 'Address unassigned.'), 'success')
      } catch (err) {
        if (surfaceRecordConflict(err, t, { onRefresh: loadDocumentAddresses })) return
        const message =
          err instanceof Error && err.message
            ? err.message
            : t('sales.documents.detail.addresses.deleteError', 'Failed to remove address.')
        flash(message, 'error')
      } finally {
        setDeletingAddressIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [confirm, documentAddresses, documentId, editingAddressId, guardLocked, handleCancelEdit, kind, loadDocumentAddresses, runGuardedMutation, t]
  )

  const handleSave = React.useCallback(async () => {
    if (guardLocked()) return
    const shippingSnapshot = useCustomShipping
      ? normalizeAddressDraft(shippingDraft, shippingAddressSnapshot)
      : null
    const billingSnapshot = sameAsShipping
      ? shippingSnapshot
      : useCustomBilling ? normalizeAddressDraft(billingDraft, billingAddressSnapshot) : null
    const shippingInput: ReturnType<typeof shippingFields.prepare> = shippingSnapshot || (!useCustomShipping && shippingAddressIdState)
      ? shippingFields.prepare()
      : { valid: true }
    const billingInput: ReturnType<typeof billingFields.prepare> = sameAsShipping
      ? shippingInput
      : billingSnapshot || (!useCustomBilling && billingAddressIdState) ? billingFields.prepare() : { valid: true }
    if (!shippingInput.valid || !billingInput.valid) return
    if (mirrorBillingFields && fieldStructure.status !== 'ready') return
    setSaving(true)
    try {
      const same = sameAsShipping
      const payload: Record<string, unknown> = { id: documentId }
      if (shippingInput.customValues) payload.shippingAddressCustomValues = shippingInput.customValues
      if (mirrorBillingFields && (shippingSnapshot || (!useCustomShipping && shippingAddressIdState))) {
        payload.billingAddressCustomValues = Object.fromEntries(fieldStructure.fields
          .filter(({ id }) => id in shippingFields.values || id in (billingAddressCustomValues ?? {}))
          .map(({ id }) => [id, shippingFields.values[id] ?? null]))
      } else if (billingInput.customValues) {
        payload.billingAddressCustomValues = billingInput.customValues
      }
      if (!useCustomShipping && copyShippingFields) payload.copyShippingAddressCustomValues = true
      if (same ? !useCustomShipping && copyShippingFields : !useCustomBilling && copyBillingFields) {
        payload.copyBillingAddressCustomValues = true
      }

      let shippingId = useCustomShipping ? null : shippingAddressIdState
      let billingId = same
        ? useCustomShipping
          ? null
          : shippingAddressIdState
        : useCustomBilling
          ? null
          : billingAddressIdState

      if (customerId && shippingSnapshot && useCustomShipping && saveShippingAddress) {
        const customerAddress = {
          entityId: customerId,
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
        }
        const res = await runGuardedMutation(
          () => createCrud<{ id?: string }>('customers/addresses', customerAddress),
          customerAddress,
        )
        if (res?.result?.id) shippingId = res.result.id
      }

      if (customerId && billingSnapshot && useCustomBilling && saveBillingAddress) {
        const customerAddress = {
          entityId: customerId,
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
        }
        const res = await runGuardedMutation(
          () => createCrud<{ id?: string }>('customers/addresses', customerAddress),
          customerAddress,
        )
        if (res?.result?.id) billingId = res.result.id
      }

      if (shippingSnapshot || !shippingId) {
        payload.shippingAddressSnapshot = shippingSnapshot ?? null
      }
      if (billingSnapshot || !billingId) {
        payload.billingAddressSnapshot = billingSnapshot ?? null
      }
      payload.shippingAddressId = shippingSnapshot ? null : shippingId
      payload.billingAddressId = billingSnapshot ? null : billingId

      const endpoint = kind === 'order' ? '/api/sales/orders' : '/api/sales/quotes'
      const call = await runGuardedMutation(
        () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(updatedAt), () =>
            apiCallOrThrow<Record<string, unknown>>(
              endpoint,
              {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              },
              { errorMessage: t('sales.documents.detail.updateError', 'Failed to update document.') },
            ),
          ),
        payload,
      )
      const result = call.result ?? {}
      if (onReload) await onReload()
      else onUpdated?.({
        shippingAddressId: (result.shippingAddressId as string | null | undefined) ?? (payload.shippingAddressId as string | null | undefined) ?? null,
        billingAddressId: (result.billingAddressId as string | null | undefined) ?? (payload.billingAddressId as string | null | undefined) ?? null,
        shippingAddressSnapshot:
          (result.shippingAddressSnapshot as Record<string, unknown> | null | undefined) ??
          (payload.shippingAddressSnapshot as Record<string, unknown> | null | undefined) ??
          null,
        billingAddressSnapshot:
          (result.billingAddressSnapshot as Record<string, unknown> | null | undefined) ??
          (payload.billingAddressSnapshot as Record<string, unknown> | null | undefined) ??
          null,
      })
      if (customerId) {
        loadAddresses(customerId).catch(() => {})
      }
      flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: onReload })) return
      const shippingError = shippingFields.showErrors(err, 'shippingAddressCustomValues')
      const billingError = sameAsShipping
        ? shippingFields.showErrors(err, 'billingAddressCustomValues')
        : billingFields.showErrors(err, 'billingAddressCustomValues')
      if (shippingError || billingError) return
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('sales.documents.detail.updateError', 'Failed to update document.')
      flash(message, 'error')
    } finally {
      setSaving(false)
    }
  }, [
    billingAddressIdState,
    billingAddressCustomValues,
    billingAddressSnapshot,
    billingDraft,
    billingFields,
    copyBillingFields,
    copyShippingFields,
    customerId,
    documentId,
    fieldStructure,
    guardLocked,
    kind,
    mirrorBillingFields,
    onReload,
    onUpdated,
    sameAsShipping,
    saveBillingAddress,
    saveShippingAddress,
    shippingAddressIdState,
    shippingAddressSnapshot,
    shippingDraft,
    shippingFields,
    t,
    loadAddresses,
    runGuardedMutation,
    useCustomBilling,
    useCustomShipping,
    updatedAt,
  ])

  const previewSelectedAddress = (id: string | null, fields: typeof shippingFields, setSource: (source: string | null) => void) => {
    fields.reset(copyPreview(id) ?? {})
    setSource(id)
  }

  const renderCustomFields = (fields: typeof shippingFields, busy: boolean, recordId?: string) => (
    <AddressCustomFieldEditor
      structure={fieldStructure}
      labels={fieldLabels}
      values={fields.values}
      onChange={fields.onChange}
      errors={fields.errors}
      disabled={locked || busy}
      recordId={recordId}
    />
  )

  const renderAddressSelect = (
    value: string,
    options: AddressOption[],
    onChange: (next: string | null) => void,
    disabled: boolean
  ) => {
    const selectedOption = options.find((addr) => addr.id === value) ?? null
    const selectedLabel = selectedOption
      ? selectedOption.summary
        ? `${selectedOption.label} — ${selectedOption.summary}`
        : selectedOption.label
      : null
    const optionsKey = options
      .map((addr) => `${addr.id}:${addr.summary ? `${addr.label} — ${addr.summary}` : addr.label}`)
      .join('\0')

    return (
      <Select
        key={`address:${value}:${optionsKey}`}
        value={value || undefined}
        onValueChange={(next) => onChange(next || null)}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue
            placeholder={
              addressesLoading
                ? t('sales.documents.form.address.loading', 'Loading addresses…')
                : t('sales.documents.form.address.placeholder', 'Select address')
            }
          >
            {selectedLabel ?? undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((addr) => {
            const optionLabel = addr.summary ? `${addr.label} — ${addr.summary}` : addr.label
            return (
              <SelectItem key={addr.id} value={addr.id}>
                {optionLabel}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {lockedReason ? (
          <ErrorMessage
            label={lockedReason}
            className="md:col-span-2"
            action={
              <Button size="sm" variant="outline" disabled>
                {t('sales.documents.detail.addresses.blocked', 'Addresses cannot be changed for the current status.')}
              </Button>
            }
          />
        ) : null}

        {addressesError ? (
          <ErrorMessage
            label={addressesError}
            className="md:col-span-2"
            action={
              <Button size="sm" variant="outline" onClick={() => loadAddresses(customerId)}>
                {t('sales.documents.detail.retry', 'Try again')}
              </Button>
            }
          />
        ) : null}

        <div className="space-y-3 rounded border bg-card p-4">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold">{t('sales.documents.form.shipping.title', 'Shipping address')}</p>
              <p className="text-xs text-muted-foreground">
                {customerRequired
                  ? t('sales.documents.form.address.customerRequired', 'Select customer first or define custom address')
                  : t('sales.documents.form.shipping.hint', 'Select an address or define a new one.')}
              </p>
            </div>
            <SwitchField
              label={t('sales.documents.form.shipping.custom', 'Define new address')}
              flip
              checked={useCustomShipping}
              onCheckedChange={(checked) => {
                setUseCustomShipping(checked)
                setShippingCopySource(null)
                shippingFields.reset(checked ? null : {})
              }}
              disabled={customerRequired || locked}
            />
          </div>
          {!useCustomShipping
            ? renderAddressSelect(
                shippingAddressIdState ?? '',
                shippingOptions,
                (id) => {
                  setShippingAddressId(id)
                  previewSelectedAddress(id, shippingFields, setShippingCopySource)
                },
                addressesLoading || customerRequired || locked || customerFieldStructure.status === 'loading'
              )
            : null}
          {useCustomShipping ? (
            <div className="space-y-3">
              <AddressEditor
                value={shippingDraft}
                format={addressFormat}
                showPhoneField
                showTaxIdField
                t={t as Translator}
                onChange={(next) => setShippingDraft(next)}
                hidePrimaryToggle
                disabled={locked}
              />
              <SwitchField
                label={t('sales.documents.form.address.saveToCustomer', 'Save this address to the customer')}
                flip
                checked={saveShippingAddress && !customerRequired}
                onCheckedChange={(checked) => setSaveShippingAddress(checked)}
                disabled={customerRequired || locked}
              />
            </div>
          ) : null}
          {useCustomShipping || shippingAddressIdState ? renderCustomFields(shippingFields, saving) : null}
        </div>

        <div className="space-y-3 rounded border bg-card p-4">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold">{t('sales.documents.form.billing.title', 'Billing address')}</p>
              <p className="text-xs text-muted-foreground">
                {sameAsShipping
                  ? t(
                      'sales.documents.form.address.sameAsShippingHint',
                      'Billing will mirror the shipping address. Uncheck to edit.'
                    )
                  : t('sales.documents.form.billing.hint', 'Select an address or define a new one.')}
              </p>
            </div>
            <SwitchField
              label={t('sales.documents.form.address.sameAsShipping', 'Same as shipping')}
              flip
              checked={sameAsShipping}
              onCheckedChange={(checked) => {
                setSameAsShipping(checked)
                setMirrorBillingFields(checked)
                if (checked) {
                  setUseCustomBilling(useCustomShipping)
                  setBillingAddressId(useCustomShipping ? null : shippingAddressIdState)
                  setBillingDraft(useCustomShipping ? shippingDraft : emptyDraft)
                }
              }}
              disabled={locked}
            />
          </div>

          {!sameAsShipping ? (
            <>
              {!useCustomBilling
                ? renderAddressSelect(
                    billingAddressIdState ?? '',
                    billingOptions,
                    (id) => {
                      setBillingAddressId(id)
                      previewSelectedAddress(id, billingFields, setBillingCopySource)
                    },
                    addressesLoading || customerRequired || locked || customerFieldStructure.status === 'loading'
                  )
                : null}
              <SwitchField
                label={t('sales.documents.form.shipping.custom', 'Define new address')}
                flip
                checked={useCustomBilling}
                onCheckedChange={(checked) => {
                  setUseCustomBilling(checked)
                  setBillingCopySource(null)
                  billingFields.reset(checked ? null : {})
                }}
                disabled={customerRequired || locked}
              />

              {useCustomBilling ? (
                <div className="space-y-3">
                  <AddressEditor
                    value={billingDraft}
                    format={addressFormat}
                    showPhoneField
                    showTaxIdField
                    t={t as Translator}
                    onChange={(next) => setBillingDraft(next)}
                    hidePrimaryToggle
                    disabled={locked}
                  />
                  <SwitchField
                    label={t('sales.documents.form.address.saveToCustomer', 'Save this address to the customer')}
                    flip
                    checked={saveBillingAddress && !customerRequired}
                    onCheckedChange={(checked) => setSaveBillingAddress(checked)}
                    disabled={customerRequired || locked}
                  />
                </div>
              ) : null}
              {useCustomBilling || billingAddressIdState ? renderCustomFields(billingFields, saving) : null}
            </>
          ) : null}
        </div>
        </div>

        <div className="space-y-3 rounded border bg-card p-4">
          {documentAddressesError ? (
            <ErrorMessage
              label={documentAddressesError}
              action={
                <Button size="sm" variant="outline" onClick={() => loadDocumentAddresses()}>
                  {t('sales.documents.detail.retry', 'Try again')}
                </Button>
              }
            />
          ) : null}
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold">
                {t('sales.documents.detail.addresses.additional', 'Additional addresses')}
              </p>
            <p className="text-xs text-muted-foreground">
              {t(
                'sales.documents.detail.addresses.additionalHint',
                'Assign extra customer addresses to this document.'
              )}
            </p>
          </div>
          {documentAddressesLoading || documentAddresses.length > 0 || additionalFormOpen ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openAdditionalForm}
              disabled={customerRequired || locked || additionalFormOpen}
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('sales.documents.detail.addresses.add', 'Add address')}
            </Button>
          ) : null}
        </div>

        {documentAddressesLoading ? (
          <LoadingMessage
            label={t('sales.documents.detail.addresses.loading', 'Loading document addresses…')}
            className="min-h-[48px] justify-start border-0 bg-transparent p-0 text-sm text-muted-foreground shadow-none"
          />
        ) : null}

        {!documentAddressesLoading && documentAddresses.length === 0 && !additionalFormOpen ? (
          <TabEmptyState
            title={t('sales.documents.detail.addresses.empty', 'No additional addresses yet.')}
            description={t(
              'sales.documents.detail.addresses.additionalHint',
              'Assign extra customer addresses to this document.'
            )}
            action={{
              label: t('sales.documents.detail.addresses.add', 'Add address'),
              onClick: openAdditionalForm,
              disabled: customerRequired || locked,
            }}
          />
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {documentAddresses.map((entry) => {
            const isEditing = editingAddressId === entry.id
            const title =
              (entry.name && entry.name.trim()) ||
              (entry.purpose && entry.purpose.trim()) ||
              entry.summary ||
              t('sales.documents.detail.addresses.itemLabel', 'Address')
            return (
              <div key={entry.id} className="space-y-2 rounded border bg-card p-3">
                {isEditing ? (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold">{title}</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelEdit}
                        aria-label={t('ui.detail.inline.cancel', 'Cancel')}
                      >
                        {t('ui.detail.inline.cancel', 'Cancel')}
                      </Button>
                    </div>
                    <AddressEditor
                      value={editingDraft}
                      format={addressFormat}
                      t={t as Translator}
                      onChange={(next) => setEditingDraft(next)}
                      hidePrimaryToggle
                      disabled={locked || editingSaving}
                    />
                    {renderCustomFields(editingFields, editingSaving, entry.id)}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCancelEdit}
                        disabled={editingSaving}
                      >
                        {t('ui.detail.inline.cancel', 'Cancel')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleUpdateDocumentAddress()}
                        disabled={editingSaving || locked || editingFields.blocked}
                      >
                        {editingSaving
                          ? t('sales.documents.form.address.saving', 'Saving…')
                          : t('sales.documents.detail.addresses.save', 'Save address')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">{title}</p>
                        {entry.companyName ? (
                          <p className="text-xs text-muted-foreground">{entry.companyName}</p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditingAddressId(entry.id)
                            setEditingDraft(draftFromDocumentAddress(entry))
                            editingFields.reset(entry.customValues ?? {})
                          }}
                          disabled={locked}
                          aria-label={t('sales.documents.detail.addresses.edit', 'Edit address')}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteDocumentAddress(entry.id)}
                          disabled={deletingAddressIds.has(entry.id) || locked}
                          aria-label={t('sales.documents.detail.addresses.delete', 'Remove address')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <AddressView
                      address={entry.value}
                      format={addressFormat}
                      className="space-y-1 text-sm"
                      lineClassName="text-sm text-foreground"
                    />
                    {entry.customValues && fieldStructure.status === 'ready' ? customFields.renderValues(entry.customValues) : null}
                  </>
                )}
              </div>
            )
          })}
        </div>

        {additionalFormOpen ? (
          <div className="space-y-3 rounded border border-dashed p-3" data-testid="additional-address-form">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <p className="text-sm font-semibold">
                {t('sales.documents.detail.addresses.new', 'Add a new address')}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdditionalFormOpen(false)
                  setAdditionalUseCustom(false)
                  setAdditionalSelectedId('')
                  setAdditionalDraft(emptyDraft)
                }}
              >
                {t('ui.detail.inline.cancel', 'Cancel')}
              </Button>
            </div>

            {hasSavedAddresses ? (
              <SegmentedControl
                value={additionalUseCustom ? 'new' : 'saved'}
                onValueChange={(next) => {
                  additionalModeTouchedRef.current = true
                  setAdditionalUseCustom(next === 'new')
                  if (next === 'saved') previewSelectedAddress(additionalSelectedId, additionalFields, setAdditionalCopySource)
                  else {
                    additionalFields.reset()
                    setAdditionalCopySource(null)
                  }
                }}
                size="sm"
                disabled={customerRequired || locked}
                aria-label={t('sales.documents.detail.addresses.mode.label', 'Address source')}
              >
                <SegmentedControlItem value="saved">
                  {t('sales.documents.detail.addresses.mode.saved', 'Saved address')}
                </SegmentedControlItem>
                <SegmentedControlItem value="new">
                  {t('sales.documents.detail.addresses.mode.new', 'New address')}
                </SegmentedControlItem>
              </SegmentedControl>
            ) : null}

            {!additionalUseCustom
              ? renderAddressSelect(
                  additionalSelectedId,
                  addressOptions,
                  (next) => {
                    setAdditionalSelectedId(next ?? '')
                    previewSelectedAddress(next, additionalFields, setAdditionalCopySource)
                  },
                  addressesLoading || customerRequired || locked || customerFieldStructure.status === 'loading'
                )
              : null}

            {additionalUseCustom ? (
              <AddressEditor
                value={additionalDraft}
                format={addressFormat}
                t={t as Translator}
                onChange={(next) => setAdditionalDraft(next)}
                hidePrimaryToggle
                disabled={locked || additionalSaving}
              />
            ) : null}
            {additionalUseCustom || additionalSelectedId ? renderCustomFields(additionalFields, additionalSaving) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                onClick={handleAddAdditionalAddress}
                disabled={additionalSaving || customerRequired || locked || additionalFields.blocked}
              >
                {additionalSaving
                  ? t('sales.documents.form.address.saving', 'Saving…')
                  : t('sales.documents.detail.addresses.save', 'Save address')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {addressesLoading || documentAddressesLoading ? (
          <div className="flex-1">
            <LoadingMessage
              label={t('sales.documents.form.address.loading', 'Loading addresses…')}
              className="min-h-[48px] justify-start border-0 bg-transparent p-0 text-sm text-muted-foreground shadow-none"
            />
          </div>
        ) : null}
        <div className="flex justify-end gap-2 sm:justify-start">
          <Button type="button" onClick={handleSave} disabled={saving || locked}>
            {saving ? (
              t('sales.documents.form.address.saving', 'Saving…')
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {t('sales.documents.detail.addresses.update', 'Update addresses')}
              </>
            )}
          </Button>
        </div>
      </div>
      {ConfirmDialogElement}
    </div>
  )
}

export default SalesDocumentAddressesSection
