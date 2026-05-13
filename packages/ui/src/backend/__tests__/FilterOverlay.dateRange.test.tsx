/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { FilterOverlay, type FilterDef, type FilterValues } from '../FilterOverlay'

function renderOverlay({
  filters,
  initialValues = {},
  onApply = jest.fn(),
  onClear = jest.fn(),
}: {
  filters: FilterDef[]
  initialValues?: FilterValues
  onApply?: (v: FilterValues) => void
  onClear?: () => void
}) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <FilterOverlay
        open={true}
        onOpenChange={() => {}}
        filters={filters}
        initialValues={initialValues}
        onApply={onApply}
        onClear={onClear}
      />
    </I18nProvider>,
  )
}

describe('FilterOverlay dateRange — DS unification (DateRangePicker swap)', () => {
  const dateRangeFilter: FilterDef = {
    id: 'createdRange',
    label: 'Created',
    type: 'dateRange',
  }

  it('renders the DateRangePicker primitive trigger (not raw <input type="date">)', () => {
    renderOverlay({ filters: [dateRangeFilter] })
    expect(document.querySelector('[data-slot="date-range-picker-trigger"]')).toBeInTheDocument()
    expect(document.querySelector('input[type="date"]')).toBeNull()
  })

  it('preserves the existing { from, to } string output shape on Apply (BC for consumers)', async () => {
    const onApply = jest.fn()
    renderOverlay({
      filters: [dateRangeFilter],
      initialValues: { createdRange: { from: '2026-05-01', to: '2026-05-09' } },
      onApply,
    })
    // Apply existing values — output shape stays as { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }.
    // Multiple Apply buttons may exist (FilterOverlay top + DateRangePicker popover);
    // pick the FilterOverlay top one (always rendered, popover may or may not be open).
    const applyBtns = screen.getAllByRole('button', { name: /^apply$/i })
    const overlayApply = applyBtns[0]
    await act(async () => {
      fireEvent.click(overlayApply)
    })
    expect(onApply).toHaveBeenCalledTimes(1)
    const applied = onApply.mock.calls[0][0]
    expect(applied.createdRange).toBeDefined()
    expect(typeof applied.createdRange.from).toBe('string')
    expect(typeof applied.createdRange.to).toBe('string')
    expect(applied.createdRange.from).toBe('2026-05-01')
    expect(applied.createdRange.to).toBe('2026-05-09')
  })

  it('renders the formatted range in the trigger when initial { from, to } is provided', () => {
    renderOverlay({
      filters: [dateRangeFilter],
      initialValues: { createdRange: { from: '2026-05-01', to: '2026-05-09' } },
    })
    const trigger = document.querySelector('[data-slot="date-range-picker-trigger"]')
    expect(trigger).toBeInTheDocument()
    expect(trigger!.textContent).toContain('May')
    expect(trigger!.textContent).toContain('2026')
  })

  it('handles empty / undefined values gracefully (no crash)', () => {
    expect(() => {
      renderOverlay({ filters: [dateRangeFilter], initialValues: {} })
    }).not.toThrow()
    expect(document.querySelector('[data-slot="date-range-picker-trigger"]')).toBeInTheDocument()
  })
})
