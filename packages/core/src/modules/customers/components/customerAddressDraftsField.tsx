import type { CrudField } from '@open-mercato/ui/backend/CrudForm'
import type { AddressTileCustomFields } from '@open-mercato/ui/backend/detail/AddressCustomFields'
import { CustomerAddressTiles, type CustomerAddressValue, type Translator } from './AddressTiles'

export type CustomerAddressDraftOptions = {
  customFields: AddressTileCustomFields
  savedAddressIds?: ReadonlySet<string>
  unconfirmedAddressId?: string
  onEditingChange?: (editing: boolean) => void
}

export function createCustomerAddressDraftsField(
  t: Translator,
  emptyLabel: string,
  options?: CustomerAddressDraftOptions,
): CrudField {
  return {
    id: 'addresses',
    label: '',
    type: 'custom',
    layout: 'full',
    component: ({ value, setValue, disabled }) => {
      const addresses = Array.isArray(value) ? (value as CustomerAddressValue[]) : []
      return (
        <CustomerAddressTiles
          addresses={options?.savedAddressIds ? addresses.filter((entry) => !options.savedAddressIds?.has(entry.id)) : addresses}
          t={t}
          emptyLabel={emptyLabel}
          gridClassName="grid gap-4 xl:grid-cols-2"
          customFields={options?.customFields}
          onEditingChange={options?.onEditingChange}
          unconfirmedAddressId={options?.unconfirmedAddressId}
          isSubmitting={disabled}
          showCoordinateFields
          onCreate={(payload) => {
            const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `tmp-${Math.random().toString(36).slice(2)}`
            const existing = payload.isPrimary ? addresses.map((entry) => ({ ...entry, isPrimary: false })) : addresses
            setValue([{ ...payload, id, isPrimary: payload.isPrimary ?? false }, ...existing])
          }}
          onUpdate={(id, payload) => setValue(addresses.map((entry) => {
            if (entry.id !== id) return payload.isPrimary ? { ...entry, isPrimary: false } : entry
            return {
              ...entry,
              name: payload.name ?? null,
              purpose: payload.purpose ?? null,
              companyName: payload.companyName ?? null,
              addressLine1: payload.addressLine1,
              addressLine2: payload.addressLine2 ?? null,
              buildingNumber: payload.buildingNumber ?? null,
              flatNumber: payload.flatNumber ?? null,
              city: payload.city ?? null,
              region: payload.region ?? null,
              postalCode: payload.postalCode ?? null,
              country: payload.country ?? null,
              latitude: payload.latitude ?? null,
              longitude: payload.longitude ?? null,
              isPrimary: payload.isPrimary ?? false,
              ...(payload.customValues ? { customValues: { ...entry.customValues, ...payload.customValues } } : {}),
            }
          }))}
          onDelete={(id) => setValue(addresses.filter((entry) => entry.id !== id))}
        />
      )
    },
  }
}
