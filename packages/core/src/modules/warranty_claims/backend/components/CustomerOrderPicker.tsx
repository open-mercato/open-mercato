'use client'

import * as React from 'react'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { loadOrderOptions, resolveOrderLabel } from './orderLookup'

type CustomerOrderPickerProps = {
  customerId: string | null
  value: string
  onChange: (value: string) => void
  placeholder: string
  fallbackLabel: string
  disabled?: boolean
  autoFocus?: boolean
  onAccessChange?: (denied: boolean) => void
}

export function CustomerOrderPicker({ customerId, value, onChange, placeholder, fallbackLabel, disabled, autoFocus, onAccessChange }: CustomerOrderPickerProps) {
  const previousCustomerId = React.useRef(customerId)
  const customerChanged = previousCustomerId.current !== customerId

  React.useEffect(() => {
    if (previousCustomerId.current === customerId) return
    previousCustomerId.current = customerId
    onChange('')
  }, [customerId, onChange])

  const loadSuggestions = React.useCallback(
    (query?: string) => loadOrderOptions(query, { customerId, fallbackLabel, onAccessChange }),
    [customerId, fallbackLabel, onAccessChange],
  )
  const resolveLabel = React.useCallback(
    (orderId: string) => resolveOrderLabel(orderId, fallbackLabel),
    [fallbackLabel],
  )

  return (
    <ComboboxInput
      key={customerId ?? ''}
      value={customerChanged ? '' : value}
      onChange={onChange}
      loadSuggestions={loadSuggestions}
      resolveLabel={resolveLabel}
      placeholder={placeholder}
      allowCustomValues={false}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  )
}
