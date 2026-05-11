import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DatePicker } from '../date-picker'
import { DatePicker as LegacyDatePicker } from '../../backend/inputs/DatePicker'
import { DateTimePicker as LegacyDateTimePicker } from '../../backend/inputs/DateTimePicker'

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider locale="en" dict={{}}>{ui}</I18nProvider>)
}

function getTrigger(): HTMLElement {
  const trigger = document.querySelector('[data-slot="date-picker-trigger"]')
  if (!trigger) throw new Error('DatePicker trigger not found')
  return trigger as HTMLElement
}

async function openPopover() {
  await act(async () => {
    fireEvent.click(getTrigger())
  })
}

describe('DatePicker primitive', () => {
  it('renders the placeholder when value is null', () => {
    renderWithI18n(<DatePicker value={null} onChange={() => {}} placeholder="Pick a date" />)
    expect(screen.getByText('Pick a date')).toBeInTheDocument()
  })

  it('renders the formatted value when value is provided', () => {
    renderWithI18n(<DatePicker value={new Date(2026, 4, 9)} onChange={() => {}} />)
    expect(screen.getByText('May 9, 2026')).toBeInTheDocument()
  })

  it('uses a custom display format when supplied', () => {
    renderWithI18n(
      <DatePicker value={new Date(2026, 4, 9)} onChange={() => {}} displayFormat="yyyy-MM-dd" />,
    )
    expect(screen.getByText('2026-05-09')).toBeInTheDocument()
  })

  it('opens the popover and renders the calendar grid on trigger click', async () => {
    renderWithI18n(<DatePicker value={null} onChange={() => {}} placeholder="Pick" />)
    await openPopover()
    expect(screen.getByRole('grid')).toBeInTheDocument()
  })

  it('renders Apply and Cancel buttons in the default footer', async () => {
    renderWithI18n(<DatePicker value={null} onChange={() => {}} />)
    await openPopover()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('renders Today and Clear links when footer="today-clear"', async () => {
    renderWithI18n(<DatePicker value={null} onChange={() => {}} footer="today-clear" />)
    await openPopover()
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  it('hides the Today button when showTodayButton=false', async () => {
    renderWithI18n(
      <DatePicker
        value={null}
        onChange={() => {}}
        footer="today-clear"
        showTodayButton={false}
      />,
    )
    await openPopover()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  it('hides the Clear button when showClearButton=false', async () => {
    renderWithI18n(
      <DatePicker
        value={null}
        onChange={() => {}}
        footer="today-clear"
        showClearButton={false}
      />,
    )
    await openPopover()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
  })

  it('renders no footer when footer="none"', async () => {
    renderWithI18n(<DatePicker value={null} onChange={() => {}} footer="none" />)
    await openPopover()
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })

  it('blocks open when disabled', () => {
    renderWithI18n(<DatePicker value={null} onChange={() => {}} disabled />)
    const trigger = getTrigger()
    expect(trigger).toBeDisabled()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('commits today and closes when Today is clicked', async () => {
    const onChange = jest.fn()
    renderWithI18n(<DatePicker value={null} onChange={onChange} footer="today-clear" />)
    await openPopover()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    const committed = onChange.mock.calls[0][0] as Date
    expect(committed).toBeInstanceOf(Date)
    expect(committed.getHours()).toBe(0)
    expect(committed.getMinutes()).toBe(0)
  })

  it('commits null when Clear is clicked', async () => {
    const onChange = jest.fn()
    renderWithI18n(
      <DatePicker value={new Date(2026, 4, 9)} onChange={onChange} footer="today-clear" />,
    )
    await openPopover()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('does not commit when Cancel is clicked in apply-cancel mode', async () => {
    const onChange = jest.fn()
    renderWithI18n(<DatePicker value={null} onChange={onChange} />)
    await openPopover()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('renders the time input when withTime=true', async () => {
    renderWithI18n(<DatePicker value={new Date(2026, 4, 9, 10, 30)} onChange={() => {}} withTime />)
    expect(screen.getByText('May 9, 2026 10:30')).toBeInTheDocument()
    await openPopover()
    expect(screen.getByLabelText('Hour')).toBeInTheDocument()
    expect(screen.getByLabelText('Minute')).toBeInTheDocument()
  })

  it('forwards aria-label to the trigger', () => {
    renderWithI18n(
      <DatePicker value={null} onChange={() => {}} aria-label="Birthday" />,
    )
    expect(screen.getByRole('button', { name: 'Birthday' })).toBeInTheDocument()
  })

  it('selected day cell paints primary fill and forces button transparent (regression)', async () => {
    renderWithI18n(<DatePicker value={new Date(2026, 4, 9)} onChange={() => {}} footer="none" />)
    await openPopover()
    // react-day-picker v9 applies `selected` className to the day `<td>` cell, not
    // the inner `<button>`. The button defaults (hover/focus-visible bg) would
    // otherwise paint over the cell's primary fill, so we force the button to
    // render transparent on selected cells.
    const selectedCells = Array.from(document.querySelectorAll('td.\\!bg-primary')) as HTMLElement[]
    expect(selectedCells.length).toBeGreaterThan(0)
    const cellClassName = selectedCells[0].className
    expect(cellClassName).toMatch(/!bg-primary/)
    // The td-level rule that neutralises the button's bg/hover/focus paint.
    expect(cellClassName).toMatch(/\[&_button\]:!bg-transparent/)
    expect(cellClassName).toMatch(/\[&_button:hover\]:!bg-transparent/)
    expect(cellClassName).toMatch(/\[&_button:focus-visible\]:!bg-transparent/)
    // No `ring-2` overlay on the default day_button class (replaced by bg-accent
    // on focus-visible so selected days don't get a ring-on-top). Target a day cell
    // button specifically (not month-nav buttons which still use ring styling).
    const dayCellButton = selectedCells[0].querySelector('button')
    if (dayCellButton) {
      expect(dayCellButton.className).not.toMatch(/focus-visible:ring-2/)
    }
  })
})

describe('DatePicker backwards-compat shims', () => {
  it('backend/inputs/DatePicker defaults to the Figma-aligned Apply/Cancel footer', async () => {
    renderWithI18n(<LegacyDatePicker value={null} onChange={() => {}} />)
    await act(async () => {
      fireEvent.click(getTrigger())
    })
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('backend/inputs/DatePicker still honours explicit footer="today-clear"', async () => {
    renderWithI18n(<LegacyDatePicker value={null} onChange={() => {}} footer="today-clear" />)
    await act(async () => {
      fireEvent.click(getTrigger())
    })
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  it('backend/inputs/DateTimePicker renders the time input', async () => {
    renderWithI18n(
      <LegacyDateTimePicker value={new Date(2026, 4, 9, 10, 30)} onChange={() => {}} />,
    )
    expect(screen.getByText('May 9, 2026 10:30')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(getTrigger())
    })
    expect(screen.getByLabelText('Hour')).toBeInTheDocument()
    expect(screen.getByLabelText('Minute')).toBeInTheDocument()
  })

  it('backend/inputs/DateTimePicker defaults to the Figma-aligned Apply/Cancel footer', async () => {
    renderWithI18n(<LegacyDateTimePicker value={null} onChange={() => {}} />)
    await act(async () => {
      fireEvent.click(getTrigger())
    })
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})
