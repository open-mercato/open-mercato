/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import widget from '../widget'

const STATUS_LABELS: Record<string, string> = {
  label_created: 'Label created',
  picked_up: 'Picked up',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  failed_delivery: 'Delivery failed',
  returned: 'Returned',
  cancelled: 'Cancelled',
  unknown: 'Unknown',
}

const STATUS_TOKEN: Record<string, string> = {
  label_created: 'status-neutral',
  picked_up: 'status-info',
  in_transit: 'status-info',
  out_for_delivery: 'status-info',
  delivered: 'status-success',
  failed_delivery: 'status-error',
  returned: 'status-warning',
  cancelled: 'status-error',
  unknown: 'status-neutral',
}

const dict = Object.fromEntries(
  Object.entries(STATUS_LABELS).map(([status, label]) => [`shipping_carriers.status.${status}`, label]),
)

function renderCell(value: unknown) {
  const cell = widget.columns[0].cell
  if (!cell) throw new Error('cell renderer missing')
  return render(
    <I18nProvider locale="en" dict={dict}>
      {cell({ getValue: () => value })}
    </I18nProvider>,
  )
}

describe('shipping_carriers tracking-status-badge widget', () => {
  it('renders translated status labels instead of raw underscore-formatted ids', () => {
    for (const [status, label] of Object.entries(STATUS_LABELS)) {
      const { container, unmount } = renderCell(status)
      expect(container.textContent).toContain(label)
      // Raw ids must never leak through (e.g. "out_for_delivery" or "out for delivery").
      expect(container.textContent).not.toContain(status)
      expect(container.textContent).not.toContain(status.replace(/_/g, ' '))
      unmount()
    }
  })

  it('maps each shipment status to its design-system status token, never a hard-coded Tailwind shade', () => {
    const forbidden = /\b(?:bg|text|border)-(?:gray|slate|sky|blue|indigo|green|amber|red|orange)-\d{2,3}\b/
    for (const [status, token] of Object.entries(STATUS_TOKEN)) {
      const { container, unmount } = renderCell(status)
      expect(container.innerHTML).toContain(token)
      expect(container.innerHTML).not.toMatch(forbidden)
      unmount()
    }
  })

  it('falls back to the neutral token for unexpected status values', () => {
    const { container } = renderCell('some_future_status')
    expect(container.innerHTML).toContain('status-neutral')
  })

  it('renders nothing for empty or non-string values', () => {
    expect(renderCell('').container.textContent).toBe('')
    expect(renderCell(null).container.textContent).toBe('')
    expect(renderCell(42).container.textContent).toBe('')
  })
})
