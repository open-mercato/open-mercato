'use client'

import * as React from 'react'
import type { OrganizationScopeChangedDetail } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { validateAddressCustomFields } from '@open-mercato/ui/backend/detail/AddressCustomFields'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError, normalizeCrudServerError } from '@open-mercato/ui/backend/utils/serverErrors'
import type { CustomerAddressValue } from '../../AddressTiles'
import type { CustomerAddressDraftOptions } from '../../customerAddressDraftsField'

const optionalTextFields = [
  'name', 'purpose', 'companyName', 'addressLine2', 'buildingNumber', 'flatNumber', 'city', 'region', 'postalCode', 'country',
] as const

function buildAddressBody(entry: CustomerAddressValue) {
  const body: Record<string, unknown> = {
    addressLine1: entry.addressLine1.trim(),
    isPrimary: entry.isPrimary ?? false,
  }
  for (const field of optionalTextFields) {
    const rawValue = entry[field]
    const value = typeof rawValue === 'string' ? rawValue.trim() : undefined
    if (value) body[field] = field === 'country' ? value.toUpperCase() : value
  }
  if (typeof entry.latitude === 'number') body.latitude = entry.latitude
  if (typeof entry.longitude === 'number') body.longitude = entry.longitude
  if (entry.customValues && Object.keys(entry.customValues).length) body.customValues = entry.customValues
  return body
}

type CreateProgress = {
  id: string
  scope: OrganizationScopeChangedDetail
  savedAddressIds: Set<string>
  unconfirmedAddressId?: string
}

type AddressRecovery = Pick<CreateProgress, 'id' | 'savedAddressIds' | 'unconfirmedAddressId'>

function isDefiniteAddressRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error) || typeof error.status !== 'number') return false
  return error.status >= 400 && error.status < 499 && error.status !== 408
}

export function useCustomerAddressDraftSubmission(
  t: (key: string) => string,
  customFields: CustomerAddressDraftOptions['customFields'],
  scope: OrganizationScopeChangedDetail,
) {
  const [recovery, setRecovery] = React.useState<AddressRecovery>()
  const progress = React.useRef<CreateProgress>(null)
  const editingAddress = React.useRef(false)
  const onEditingChange = React.useCallback((editing: boolean) => { editingAddress.current = editing }, [])
  const addressDrafts = React.useMemo(() => ({
    customFields,
    onEditingChange,
    savedAddressIds: recovery?.savedAddressIds,
    unconfirmedAddressId: recovery?.unconfirmedAddressId,
  }), [customFields, onEditingChange, recovery])

  function updateRecovery(current: CreateProgress) {
    setRecovery({ id: current.id, savedAddressIds: new Set(current.savedAddressIds), unconfirmedAddressId: current.unconfirmedAddressId })
  }

  function confirmAddressOutcome(outcome: 'saved' | 'missing') {
    const current = progress.current
    if (!current?.unconfirmedAddressId) return
    if (outcome === 'saved') current.savedAddressIds.add(current.unconfirmedAddressId)
    delete current.unconfirmedAddressId
    updateRecovery(current)
  }

  async function submit(
    drafts: CustomerAddressValue[] | undefined,
    createParent: () => Promise<{ id?: string; entityId?: string } | null | undefined>,
  ) {
    let current = progress.current
    const fail = (message: string, details?: string) => createCrudFormError(message, { addresses: details ?? message })
    if (current && (current.scope.organizationId !== scope.organizationId || current.scope.tenantId !== scope.tenantId)) {
      throw fail(t('customers.people.detail.addresses.createScopeChanged'))
    }
    if (current?.unconfirmedAddressId) throw fail(t('customers.people.detail.addresses.saveUnconfirmed'))
    if (editingAddress.current) throw fail(t('customers.people.detail.addresses.finishDraft'))

    const remaining = (Array.isArray(drafts) ? drafts : []).filter((entry) => !current?.savedAddressIds.has(entry.id))
    if (remaining.length && customFields.structure.status !== 'ready') {
      throw fail(customFields.structure.status === 'loading' ? customFields.labels.loading : customFields.labels.error)
    }
    for (const entry of remaining) {
      if (typeof entry.addressLine1 !== 'string' || !entry.addressLine1.trim()) {
        throw fail(t('customers.people.detail.addresses.draftInvalid'))
      }
      const errors = validateAddressCustomFields(customFields.structure, entry.customValues ?? {})
      const firstError = Object.values(errors)[0]
      if (firstError) throw fail(t('customers.people.detail.addresses.draftInvalid'), firstError)
    }
    const addressBodies = remaining.map((entry) => ({ id: entry.id, body: buildAddressBody(entry) }))

    if (!current) {
      const created = await createParent()
      const id = created?.id ?? created?.entityId
      if (typeof id !== 'string') return undefined
      current = { id, scope, savedAddressIds: new Set<string>() }
      progress.current = current
    }

    for (const { id, body } of addressBodies) {
      try {
        await createCrud('customers/addresses', {
          ...body,
          entityId: current.id,
          ...(current.scope.organizationId ? { organizationId: current.scope.organizationId } : {}),
        }, { errorMessage: t('customers.people.detail.addresses.error') })
        current.savedAddressIds.add(id)
      } catch (error) {
        if (!isDefiniteAddressRejection(error)) {
          current.unconfirmedAddressId = id
          updateRecovery(current)
          throw fail(t('customers.people.detail.addresses.saveUnconfirmed'))
        }
        updateRecovery(current)
        const normalized = normalizeCrudServerError(error)
        const details = Object.values(normalized.fieldErrors ?? {})[0] ?? normalized.message
        throw fail(t('customers.people.detail.addresses.retryPending'), details)
      }
    }

    return current.id
  }

  return { addressDrafts, recovery, confirmAddressOutcome, submit }
}
