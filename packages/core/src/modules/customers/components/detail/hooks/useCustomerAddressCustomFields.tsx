'use client'

import * as React from 'react'
import { E } from '#generated/entities.ids.generated'
import {
  useAddressCustomFields,
  type AddressTileCustomFields,
} from '@open-mercato/ui/backend/detail/AddressCustomFields'
import { CustomFieldValuesList } from '../CustomFieldValuesList'

export function useCustomerAddressCustomFields(
  t: (key: string) => string,
  enabled = true,
): AddressTileCustomFields {
  const structure = useAddressCustomFields(E.customers.customer_address, enabled)
  return React.useMemo(() => ({
    structure,
    labels: {
      loading: t('customers.people.detail.addresses.customFieldsLoading'),
      error: t('customers.people.detail.addresses.customFieldsLoadError'),
      retry: t('customers.people.detail.addresses.customFieldsRetry'),
    },
    renderValues: (values) => {
      const visibleValues = Object.fromEntries(structure.definitions
        .filter((definition) => Object.hasOwn(values, definition.key))
        .map((definition) => [definition.key, values[definition.key]]))
      return <CustomFieldValuesList values={visibleValues} definitions={structure.definitions} />
    },
  }), [structure, t])
}
