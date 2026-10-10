/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen } from '@testing-library/react'

type Range = { start: Date; end: Date }

jest.mock('@open-mercato/ui/primitives/date-range-picker', () => ({
  DateRangePicker: ({ onChange, 'aria-label': ariaLabel }: { onChange: (range: Range | null) => void; 'aria-label'?: string }) => (
    <div aria-label={ariaLabel}>
      <button type="button" onClick={() => onChange({ start: new Date(2026, 0, 1), end: new Date(2026, 5, 28) })}>pick 179 days</button>
      <button type="button" onClick={() => onChange({ start: new Date(2026, 0, 1), end: new Date(2026, 6, 31) })}>pick 212 days</button>
    </div>
  ),
}))

import { XrayWindowSelector } from '../XrayWindowSelector'
import { renderXray } from './xrayTestSupport'

describe('XrayWindowSelector', () => {
  it('switches between the default windows', () => {
    const onChange = jest.fn()
    renderXray(<XrayWindowSelector value={{ kind: 'preset', key: '30d' }} onChange={onChange} />)
    expect(screen.getByRole('radiogroup', { name: 'Period' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }))
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'preset', key: '7d' })
  })

  it('refuses a custom range over 180 days without applying it, and applies a valid one', async () => {
    const onChange = jest.fn()
    renderXray(<XrayWindowSelector value={{ kind: 'preset', key: '30d' }} onChange={onChange} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Custom' }))
    })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'custom' }))
    onChange.mockClear()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'pick 212 days' }))
    })
    expect(screen.getByTestId('xray-window-error')).toHaveTextContent('Choose at most 180 days.')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'pick 179 days' }))
    })
    expect(screen.queryByTestId('xray-window-error')).toBeNull()
    expect(onChange).toHaveBeenCalledWith({ kind: 'custom', start: '2026-01-01', end: '2026-06-28' })
  })
})
