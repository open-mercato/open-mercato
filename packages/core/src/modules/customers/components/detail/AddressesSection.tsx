"use client"

import * as React from 'react'
import { CustomerAddressTiles, type CustomerAddressInput, type CustomerAddressValue } from '../AddressTiles'
import type { AddressSummary, SectionAction, TabEmptyState, Translator } from './types'
import { useT } from '@/lib/i18n/context'

export type AddressesSectionProps = {
  addresses: AddressSummary[]
  onCreate: (payload: CustomerAddressInput) => Promise<void>
  onUpdate: (id: string, payload: CustomerAddressInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  isSubmitting: boolean
  emptyLabel: string
  addActionLabel: string
  emptyState: TabEmptyState
  onActionChange?: (action: SectionAction | null) => void
  translator?: Translator
}

export function AddressesSection({
  addresses,
  onCreate,
  onUpdate,
  onDelete,
  isSubmitting,
  emptyLabel,
  addActionLabel,
  emptyState,
  onActionChange,
  translator,
}: AddressesSectionProps) {
  const tHook = useT()
  const t: Translator = React.useMemo(
    () => translator ?? ((key, fallback) => {
      const value = tHook(key)
      return value === key && fallback ? fallback : value
    }),
    [translator, tHook],
  )

  const displayAddresses = React.useMemo<CustomerAddressValue[]>(() => {
    return addresses.map((address) => ({
      id: address.id,
      name: address.name ?? null,
      purpose: address.purpose ?? null,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2 ?? null,
      buildingNumber: address.buildingNumber ?? null,
      flatNumber: address.flatNumber ?? null,
      city: address.city ?? null,
      region: address.region ?? null,
      postalCode: address.postalCode ?? null,
      country: address.country ?? null,
      isPrimary: address.isPrimary ?? false,
    }))
  }, [addresses])

  const handleAddActionChange = React.useCallback(
    (action: { openCreateForm: () => void; addDisabled: boolean } | null) => {
      if (!onActionChange) return
      if (!action) {
        onActionChange(null)
        return
      }
      onActionChange({
        label: addActionLabel,
        onClick: action.openCreateForm,
        disabled: action.addDisabled,
      })
    },
    [addActionLabel, onActionChange],
  )

  return (
    <div className="mt-4">
      <CustomerAddressTiles
        addresses={displayAddresses}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isSubmitting={isSubmitting}
        emptyLabel={emptyLabel}
        t={t}
        hideAddButton
        onAddActionChange={handleAddActionChange}
        emptyStateTitle={emptyState.title}
        emptyStateActionLabel={emptyState.actionLabel}
      />
    </div>
  )
}

export default AddressesSection
