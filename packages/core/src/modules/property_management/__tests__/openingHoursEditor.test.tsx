/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { OpeningHoursEditor } from '../components/buildings/OpeningHoursEditor'
import { openingRowsOf } from '../components/buildings/openingHoursRows'

function renderEditor(rows = openingRowsOf([{ weekday: 0, opensAt: '18:00', closesAt: '24:00' }, { weekday: 1, opensAt: '09:00', closesAt: '17:00' }], true)) {
  const setValue = jest.fn()
  renderWithProviders(
    <OpeningHoursEditor
      {...({ values: { openingHoursEnabled: true, openingRows: rows }, setValue, errors: {} } as unknown as React.ComponentProps<typeof OpeningHoursEditor>)}
    />,
  )
  return setValue
}

describe('OpeningHoursEditor', () => {
  it('renders a midnight close instead of a clamped time and lets a day close at midnight', () => {
    const setValue = renderEditor()
    expect(screen.getByTestId('pm-opening-midnight-0')).toHaveTextContent('midnight')
    expect(screen.queryByTestId('pm-opening-midnight-1')).toBeNull()
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes[0]).toHaveAttribute('aria-checked', 'true')
    expect(checkboxes[1]).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(checkboxes[1])
    const rows = setValue.mock.calls[0][1] as Array<{ weekday: number; closesAt: string }>
    expect(rows.find((row) => row.weekday === 1)?.closesAt).toBe('24:00')
    fireEvent.click(checkboxes[0])
    const reverted = setValue.mock.calls[1][1] as Array<{ weekday: number; closesAt: string }>
    expect(reverted.find((row) => row.weekday === 0)?.closesAt).toBe('23:45')
  })
})
