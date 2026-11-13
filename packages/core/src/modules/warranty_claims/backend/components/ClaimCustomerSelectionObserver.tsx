'use client'

import * as React from 'react'

export function ClaimCustomerSelectionObserver({ customerId, lines, onChange }: {
  customerId: string | null
  lines: unknown[]
  onChange: (lines: unknown[]) => void
}) {
  const previousCustomerId = React.useRef(customerId)
  React.useEffect(() => {
    if (previousCustomerId.current === customerId) return
    previousCustomerId.current = customerId
    onChange(lines.filter((line) => !(
      typeof line === 'object' && line !== null && 'orderLineId' in line && line.orderLineId
    )))
  }, [customerId, lines, onChange])
  return null
}
