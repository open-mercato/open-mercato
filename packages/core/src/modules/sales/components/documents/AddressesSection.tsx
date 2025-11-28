"use client"

import * as React from 'react'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { useT } from '@/lib/i18n/context'
import { AddressEditor, type AddressEditorDraft } from '@open-mercato/core/modules/customers/components/AddressEditor'
import {
  AddressView,
  formatAddressString,
  type AddressFormatStrategy,
  type AddressValue,
} from '@open-mercato/core/modules/customers/utils/addressFormat'
import { Pencil, Plus, Save, Trash2 } from 'lucide-react'

type Translator = (key: string, fallback?: string, params?: Record<string, string | number>) => string

type AddressOption = {
  id: string
  label: string
  summary: string
  value: AddressValue
  name?: string | null
  purpose?: string | null
}

export type SalesDocumentAddressesSectionProps = {
  documentId: string
  kind: 'order' | 'quote'
  customerId?: string | null
  shippingAddressId?: string | null
  billingAddressId?: string | null
  shippingAddressSnapshot?: Record<string, unknown> | null
  billingAddressSnapshot?: Record<string, unknown> | null
  lockedReason?: string | null
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
  isPrimary: false,
}

function normalizeAddressDraft(draft?: AddressEditorDraft | null): Record<string, unknown> | null {
  if (!draft) return null
  const normalized: Record<string, unknown> = {}
  const assign = (key: keyof AddressEditorDraft, target: string) => {
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
  return { id, label, summary, value, name: name || null, purpose: purpose || null }
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
  lockedReason,
  onUpdated,
}: SalesDocumentAddressesSectionProps) {
  const t = useT()
  const [addressOptions, setAddressOptions] = React.useState<AddressOption[]>([])
  const [addressesLoading, setAddressesLoading] = React.useState(false)
  const [addressesError, setAddressesError] = React.useState<string | null>(null)
  const [addressFormat, setAddressFormat] = React.useState<AddressFormatStrategy>('line_first')
  const [useCustomShipping, setUseCustomShipping] = React.useState<boolean>(!!shippingAddressSnapshot)
  const [useCustomBilling, setUseCustomBilling] = React.useState<boolean>(
    billingAddressSnapshot ? true : !!shippingAddressSnapshot
  )
  const [sameAsShipping, setSameAsShipping] = React.useState<boolean>(() => {
    if (shippingAddressSnapshot || billingAddressSnapshot) {
      return deepEqual(shippingAddressSnapshot, billingAddressSnapshot)
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

  const customerRequired = !customerId
  const addressOptionsMap = React.useMemo(() => {
    const map = new Map<string, AddressOption>()
    addressOptions.forEach((entry) => map.set(entry.id, entry))
    return map
  }, [addressOptions])

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
            }
          })
          .filter((entry): entry is DocumentAddressAssignment => entry !== null)
        setDocumentAddresses(mapped)
      } else {
        setDocumentAddresses([])
      }
    } catch (err) {
      console.error('sales.documents.addresses.document.load', err)
      const message = t('sales.documents.detail.addresses.loadError', 'Failed to load addresses.')
      flash(message, 'error')
      setDocumentAddressesError(message)
      setDocumentAddresses([])
    } finally {
      setDocumentAddressesLoading(false)
    }
  }, [documentId, kind, resolveAddressSummary, t])

  React.useEffect(() => {
    const shippingCustom = !!shippingAddressSnapshot
    const billingCustom = !!billingAddressSnapshot
    const nextSame = shippingAddressSnapshot || billingAddressSnapshot
      ? deepEqual(shippingAddressSnapshot, billingAddressSnapshot)
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
  }, [billingAddressId, billingAddressSnapshot, documentId, shippingAddressId, shippingAddressSnapshot])

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
      if (!id) {
        setAddressOptions([])
        return
      }
      setAddressesLoading(true)
      setAddressesError(null)
      try {
        const params = new URLSearchParams({ page: '1', pageSize: '50', entityId: id })
        const call = await apiCall<{ items?: Array<Record<string, unknown>> }>(
          `/api/customers/addresses?${params.toString()}`
        )
        if (call.ok && Array.isArray(call.result?.items)) {
          const options = call.result.items
            .map((item) => mapApiAddress(item, addressFormat))
            .filter((entry): entry is AddressOption => !!entry)
          setAddressOptions(options)
        } else {
          setAddressOptions([])
        }
      } catch (err) {
        console.error('sales.documents.addresses.load', err)
        const message = t('sales.documents.detail.addresses.loadError', 'Failed to load addresses.')
        setAddressesError(message)
        flash(message, 'error')
        setAddressOptions([])
      } finally {
        setAddressesLoading(false)
      }
    },
    [addressFormat, t]
  )

  React.useEffect(() => {
    loadAddresses(customerId).catch(() => {})
  }, [customerId, loadAddresses])

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
        console.error('sales.documents.addresses.format', err)
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

      const call = await apiCallOrThrow<Record<string, unknown>>(
        '/api/sales/document-addresses',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentId,
            documentKind: kind,
            customerAddressId: customerAddressId ?? undefined,
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
          }),
        },
        { errorMessage: t('sales.documents.detail.addresses.saveError', 'Failed to update addresses.') }
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
      flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
    } catch (err) {
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
    addressOptionsMap,
    customerId,
    documentId,
    kind,
    loadAddresses,
    resolveAddressSummary,
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
      await apiCallOrThrow(
        '/api/sales/document-addresses',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingAddressId,
            documentId,
            documentKind: kind,
            customerAddressId: current.customerAddressId ?? undefined,
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
          }),
        },
        { errorMessage: t('sales.documents.detail.addresses.saveError', 'Failed to update addresses.') }
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
      flash(t('sales.documents.detail.updatedMessage', 'Document updated.'), 'success')
      handleCancelEdit()
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('sales.documents.detail.addresses.saveError', 'Failed to update addresses.')
      flash(message, 'error')
    } finally {
      setEditingSaving(false)
    }
  }, [documentAddresses, documentId, editingAddressId, editingDraft, handleCancelEdit, kind, resolveAddressSummary, t])

  const handleDeleteDocumentAddress = React.useCallback(
    async (id: string) => {
      if (guardLocked()) return
      const confirmMessage = t(
        'sales.documents.detail.addresses.deleteConfirm',
        'This will permanently remove this address from the document. Continue?'
      )
      if (typeof window !== 'undefined' && !window.confirm(confirmMessage)) {
        return
      }
      setDeletingAddressIds((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
      try {
        await apiCallOrThrow(
          '/api/sales/document-addresses',
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, documentId, documentKind: kind }),
          },
          { errorMessage: t('sales.documents.detail.addresses.deleteError', 'Failed to remove address.') }
        )
        setDocumentAddresses((prev) => prev.filter((entry) => entry.id !== id))
        if (editingAddressId === id) {
          handleCancelEdit()
        }
        flash(t('sales.documents.detail.addresses.removed', 'Address unassigned.'), 'success')
      } catch (err) {
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
    [documentId, editingAddressId, handleCancelEdit, kind, t]
  )

  const handleSave = React.useCallback(async () => {
    if (guardLocked()) return
    setSaving(true)
    try {
      const shippingSnapshot = useCustomShipping ? normalizeAddressDraft(shippingDraft) : null
      let billingSnapshot = useCustomBilling ? normalizeAddressDraft(billingDraft) : null
      const same = sameAsShipping
      const payload: Record<string, unknown> = { id: documentId }

      if (same && useCustomShipping) {
        billingSnapshot = shippingSnapshot
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
        const res = await createCrud<{ id?: string }>('customers/addresses', {
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
        })
        if (res?.result?.id) shippingId = res.result.id
      }

      if (customerId && billingSnapshot && useCustomBilling && saveBillingAddress) {
        const res = await createCrud<{ id?: string }>('customers/addresses', {
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
        })
        if (res?.result?.id) billingId = res.result.id
      }

      payload.shippingAddressSnapshot = shippingSnapshot ?? null
      payload.billingAddressSnapshot = billingSnapshot ?? null
      payload.shippingAddressId = shippingSnapshot ? null : shippingId
      payload.billingAddressId = billingSnapshot ? null : billingId

      const endpoint = kind === 'order' ? '/api/sales/orders' : '/api/sales/quotes'
      const call = await apiCallOrThrow<Record<string, unknown>>(
        endpoint,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        { errorMessage: t('sales.documents.detail.updateError', 'Failed to update document.') }
      )
      const result = call.result ?? {}
      onUpdated?.({
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
    billingDraft,
    customerId,
    documentId,
    kind,
    sameAsShipping,
    saveBillingAddress,
    saveShippingAddress,
    shippingAddressIdState,
    shippingDraft,
    t,
    loadAddresses,
    useCustomBilling,
    useCustomShipping,
  ])

  const renderAddressSelect = (
    value: string,
    options: AddressOption[],
    onChange: (next: string | null) => void,
    disabled: boolean
  ) => (
    <select
      className="w-full rounded border px-2 py-2 text-sm"
      value={value}
      onChange={(evt) => onChange(evt.target.value || null)}
      disabled={disabled}
    >
      <option value="">
        {addressesLoading
          ? t('sales.documents.form.address.loading', 'Loading addresses…')
          : t('sales.documents.form.address.placeholder', 'Select address')}
      </option>
      {options.map((addr) => {
        const optionLabel = addr.summary ? `${addr.label} — ${addr.summary}` : addr.label
        return (
          <option key={addr.id} value={addr.id}>
            {optionLabel}
          </option>
        )
      })}
    </select>
  )

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
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={useCustomShipping}
                onCheckedChange={(checked) => setUseCustomShipping(checked)}
                disabled={customerRequired || locked}
              />
              <span>{t('sales.documents.form.shipping.custom', 'Define new address')}</span>
            </label>
          </div>
          {!useCustomShipping
            ? renderAddressSelect(
                shippingAddressIdState ?? '',
                shippingOptions,
                setShippingAddressId,
                addressesLoading || customerRequired || locked
              )
            : null}
          {useCustomShipping ? (
            <div className="space-y-3">
              <AddressEditor
                value={shippingDraft}
                format={addressFormat}
                t={t as Translator}
                onChange={(next) => setShippingDraft(next)}
                hidePrimaryToggle
              />
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={saveShippingAddress && !customerRequired}
                  onCheckedChange={(checked) => setSaveShippingAddress(checked)}
                  disabled={customerRequired || locked}
                />
                {t('sales.documents.form.address.saveToCustomer', 'Save this address to the customer')}
              </label>
            </div>
          ) : null}
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
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={sameAsShipping}
                onCheckedChange={(checked) => {
                  setSameAsShipping(checked)
                  if (checked) {
                    setUseCustomBilling(useCustomShipping)
                    setBillingAddressId(useCustomShipping ? null : shippingAddressIdState)
                    setBillingDraft(useCustomShipping ? shippingDraft : emptyDraft)
                  }
                }}
                disabled={locked}
              />
              <span>{t('sales.documents.form.address.sameAsShipping', 'Same as shipping')}</span>
            </label>
          </div>

          {!sameAsShipping ? (
            <>
              {!useCustomBilling
                ? renderAddressSelect(
                    billingAddressIdState ?? '',
                    billingOptions,
                    setBillingAddressId,
                    addressesLoading || customerRequired || locked
                  )
                : null}
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={useCustomBilling}
                  onCheckedChange={(checked) => setUseCustomBilling(checked)}
                  disabled={customerRequired || locked}
                />
                <span>{t('sales.documents.form.shipping.custom', 'Define new address')}</span>
              </label>

              {useCustomBilling ? (
                <div className="space-y-3">
                  <AddressEditor
                    value={billingDraft}
                    format={addressFormat}
                    t={t as Translator}
                    onChange={(next) => setBillingDraft(next)}
                    hidePrimaryToggle
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={saveBillingAddress && !customerRequired}
                      onCheckedChange={(checked) => setSaveBillingAddress(checked)}
                      disabled={customerRequired || locked}
                    />
                    {t('sales.documents.form.address.saveToCustomer', 'Save this address to the customer')}
                  </label>
                </div>
              ) : null}
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdditionalFormOpen(true)}
            disabled={customerRequired || locked}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t('sales.documents.detail.addresses.add', 'Add address')}
          </Button>
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
              onClick: () => setAdditionalFormOpen(true),
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
                    />
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
                        disabled={editingSaving}
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
                  </>
                )}
              </div>
            )
          })}
        </div>

        {additionalFormOpen ? (
          <div className="space-y-3 rounded border border-dashed p-3">
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

            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={additionalUseCustom}
                onCheckedChange={(checked) => setAdditionalUseCustom(checked)}
                disabled={customerRequired || locked}
              />
              <span>{t('sales.documents.form.shipping.custom', 'Define new address')}</span>
            </label>

            {!additionalUseCustom
              ? renderAddressSelect(
                  additionalSelectedId,
                  addressOptions,
                  (next) => setAdditionalSelectedId(next ?? ''),
                  addressesLoading || customerRequired
                )
              : null}

            {additionalUseCustom ? (
              <AddressEditor
                value={additionalDraft}
                format={addressFormat}
                t={t as Translator}
                onChange={(next) => setAdditionalDraft(next)}
                hidePrimaryToggle
              />
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                onClick={handleAddAdditionalAddress}
                disabled={additionalSaving || customerRequired || locked}
              >
                {additionalSaving
                  ? t('sales.documents.form.address.saving', 'Saving…')
                  : t('sales.documents.detail.addresses.add', 'Add address')}
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
    </div>
  )
}

export default SalesDocumentAddressesSection
