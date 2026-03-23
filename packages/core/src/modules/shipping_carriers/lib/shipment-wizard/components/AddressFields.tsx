"use client"

import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { AddressFieldsProps } from '../types'

export const AddressFields = (props: AddressFieldsProps) => {
  const { prefix, address, onChange, disabled } = props
  const t = useT()

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor={`${prefix}-line1`} className="mb-1 block text-xs font-medium text-muted-foreground">
          {t('shipping_carriers.create.field.addressLine1', 'Address line 1')}
        </label>
        <Input
          id={`${prefix}-line1`}
          value={address.line1}
          onChange={(event) => onChange({ ...address, line1: event.target.value })}
          disabled={disabled}
        />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${prefix}-line2`} className="mb-1 block text-xs font-medium text-muted-foreground">
          {t('shipping_carriers.create.field.addressLine2', 'Address line 2')}
        </label>
        <Input
          id={`${prefix}-line2`}
          value={address.line2 ?? ''}
          onChange={(event) => onChange({ ...address, line2: event.target.value || undefined })}
          disabled={disabled}
        />
      </div>
      <div>
        <label htmlFor={`${prefix}-city`} className="mb-1 block text-xs font-medium text-muted-foreground">
          {t('shipping_carriers.create.field.city', 'City')}
        </label>
        <Input
          id={`${prefix}-city`}
          value={address.city}
          onChange={(event) => onChange({ ...address, city: event.target.value })}
          disabled={disabled}
        />
      </div>
      <div>
        <label htmlFor={`${prefix}-postal`} className="mb-1 block text-xs font-medium text-muted-foreground">
          {t('shipping_carriers.create.field.postalCode', 'Postal code')}
        </label>
        <Input
          id={`${prefix}-postal`}
          value={address.postalCode}
          onChange={(event) => onChange({ ...address, postalCode: event.target.value })}
          disabled={disabled}
        />
      </div>
      <div>
        <label htmlFor={`${prefix}-country`} className="mb-1 block text-xs font-medium text-muted-foreground">
          {t('shipping_carriers.create.field.countryCode', 'Country code (ISO)')}
        </label>
        <Input
          id={`${prefix}-country`}
          value={address.countryCode}
          placeholder="PL"
          maxLength={3}
          onChange={(event) => onChange({ ...address, countryCode: event.target.value.toUpperCase() })}
          disabled={disabled}
        />
      </div>
    </div>
  )
}
