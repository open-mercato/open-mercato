/** @jest-environment jsdom */

import { isValidElement } from 'react'
import { render, screen } from '@testing-library/react'
import widget from '../tracking-status-badge/widget'

const mockT = jest.fn((key: string, fallback?: string) => {
  if (key === 'shipping_carriers.status.in_transit') return 'In transit'
  return fallback ?? key
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockT,
}))

describe('tracking status badge widget', () => {
  beforeEach(() => {
    mockT.mockClear()
  })

  it('renders translated shipping statuses through the design-system status badge', () => {
    const cell = widget.columns[0]?.cell
    expect(cell).toBeDefined()

    const rendered = cell?.({ getValue: () => 'in_transit' })
    expect(isValidElement(rendered)).toBe(true)
    render(rendered)

    expect(mockT).toHaveBeenCalledWith('shipping_carriers.status.in_transit', 'in_transit')
    const badge = screen.getByText('In transit')
    expect(badge.className).toContain('bg-status-info-bg')
    expect(badge.className).not.toMatch(/\bbg-(blue|red|green|amber|orange|slate|gray|indigo|sky)-/)
    expect(badge.className).not.toMatch(/\btext-(blue|red|green|amber|orange|slate|gray|indigo|sky)-/)
  })
})
