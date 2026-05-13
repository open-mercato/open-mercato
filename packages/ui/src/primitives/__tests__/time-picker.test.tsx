/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import {
  TimePicker,
  TimePickerSlot,
  TimePickerDurationChip,
  TimePickerStatusChip,
  formatDuration,
  type TimePickerValue,
} from '../time-picker'

function renderWithI18n(ui: React.ReactElement) {
  const utils = render(<I18nProvider locale="en" dict={{}}>{ui}</I18nProvider>)
  return {
    ...utils,
    rerender: (next: React.ReactElement) =>
      utils.rerender(<I18nProvider locale="en" dict={{}}>{next}</I18nProvider>),
  }
}

describe('formatDuration helper', () => {
  it('formats minutes under an hour', () => {
    expect(formatDuration(15)).toBe('15 min')
    expect(formatDuration(45)).toBe('45 min')
  })

  it('formats whole hours', () => {
    expect(formatDuration(60)).toBe('1 hour')
    expect(formatDuration(120)).toBe('2 hours')
    expect(formatDuration(720)).toBe('12 hours')
  })

  it('formats whole days', () => {
    expect(formatDuration(1440)).toBe('1 day')
    expect(formatDuration(2880)).toBe('2 days')
  })

  it('formats mixed hours and minutes', () => {
    expect(formatDuration(90)).toBe('1h 30m')
  })

  it('supports the long form when short=false', () => {
    expect(formatDuration(15, { short: false })).toBe('15 minutes')
    expect(formatDuration(60, { short: false })).toBe('1 hour')
    expect(formatDuration(120, { short: false })).toBe('2 hours')
  })

  it('handles zero and invalid values', () => {
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(-30)).toBe('0 min')
    expect(formatDuration(Number.NaN)).toBe('0 min')
  })
})

describe('TimePickerSlot atom', () => {
  it('renders 12h format by default with AM/PM suffix', () => {
    render(<TimePickerSlot value="13:30" onSelect={() => {}} />)
    expect(screen.getByText('01:30')).toBeInTheDocument()
    expect(screen.getByText('PM')).toBeInTheDocument()
  })

  it('renders 24h format when format="24h"', () => {
    const { container } = render(<TimePickerSlot value="13:30" format="24h" onSelect={() => {}} />)
    expect(container.textContent).toContain('13:30')
    expect(container.textContent).not.toContain('PM')
  })

  it('renders trailing check icon when selected', () => {
    const { container } = render(<TimePickerSlot value="10:00" selected onSelect={() => {}} />)
    const slot = container.querySelector('[data-slot="time-picker-slot"]')
    expect(slot).toHaveAttribute('data-state', 'active')
    expect(slot!.querySelectorAll('svg').length).toBeGreaterThan(0)
  })

  it('fires onSelect with the canonical value on click', () => {
    const onSelect = jest.fn()
    render(<TimePickerSlot value="10:00" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith('10:00')
  })

  it('does not fire onSelect when disabled', () => {
    const onSelect = jest.fn()
    render(<TimePickerSlot value="10:00" disabled onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('renders rightText when provided', () => {
    render(<TimePickerSlot value="10:00" rightText="11:00" onSelect={() => {}} />)
    expect(screen.getAllByText('10:00').length).toBeGreaterThan(0)
    expect(screen.getByText('11:00')).toBeInTheDocument()
  })
})

describe('TimePickerDurationChip atom', () => {
  it('renders default state with formatted label', () => {
    render(<TimePickerDurationChip value={30} onSelect={() => {}} />)
    expect(screen.getByText('30 min')).toBeInTheDocument()
  })

  it('renders custom label when provided', () => {
    render(<TimePickerDurationChip value={30} label="Half hour" onSelect={() => {}} />)
    expect(screen.getByText('Half hour')).toBeInTheDocument()
  })

  it('renders leading check icon when selected', () => {
    const { container } = render(<TimePickerDurationChip value={30} selected onSelect={() => {}} />)
    const chip = container.querySelector('[data-slot="time-picker-duration-chip"]')
    expect(chip).toHaveAttribute('data-state', 'active')
    expect(chip!.querySelectorAll('svg').length).toBeGreaterThan(0)
  })

  it('fires onSelect with numeric value on click', () => {
    const onSelect = jest.fn()
    render(<TimePickerDurationChip value={45} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith(45)
  })

  it('does not fire onSelect when disabled', () => {
    const onSelect = jest.fn()
    render(<TimePickerDurationChip value={45} disabled onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('TimePickerStatusChip atom', () => {
  it('renders the default label for each variant', () => {
    const { rerender } = render(<TimePickerStatusChip variant="available" />)
    expect(screen.getByText('Available')).toBeInTheDocument()
    rerender(<TimePickerStatusChip variant="busy" />)
    expect(screen.getByText('Busy')).toBeInTheDocument()
    rerender(<TimePickerStatusChip variant="in-meeting" />)
    expect(screen.getByText('In meeting')).toBeInTheDocument()
    rerender(<TimePickerStatusChip variant="offline" />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('marks the chip selected and exposes data-variant', () => {
    const { container } = render(
      <TimePickerStatusChip variant="busy" selected onSelect={() => {}} />,
    )
    const chip = container.querySelector('[data-slot="time-picker-status-chip"]')
    expect(chip).toHaveAttribute('data-state', 'selected')
    expect(chip).toHaveAttribute('data-variant', 'busy')
  })

  it('fires onSelect with the variant on click', () => {
    const onSelect = jest.fn()
    render(<TimePickerStatusChip variant="in-meeting" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith('in-meeting')
  })

  it('does not fire onSelect when disabled', () => {
    const onSelect = jest.fn()
    render(<TimePickerStatusChip variant="offline" disabled onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('respects a custom icon override', () => {
    const { container } = render(
      <TimePickerStatusChip variant="available" icon={<span data-testid="custom-icon" />} />,
    )
    expect(container.querySelector('[data-testid="custom-icon"]')).not.toBeNull()
  })
})

describe('TimePicker composition (inline mode)', () => {
  function Harness({
    initial,
    ...rest
  }: { initial?: TimePickerValue } & Omit<React.ComponentProps<typeof TimePicker>, 'value' | 'onChange'>) {
    const [value, setValue] = React.useState<TimePickerValue>(initial ?? null)
    return <TimePicker value={value} onChange={setValue} {...rest} />
  }

  it('auto-generates slots from startTime/endTime/intervalMinutes', () => {
    const { container } = renderWithI18n(<Harness startTime="09:00" endTime="10:00" intervalMinutes={30} />)
    const slots = container.querySelectorAll('[data-slot="time-picker-slot"]')
    expect(slots).toHaveLength(3) // 09:00, 09:30, 10:00
  })

  it('explicit slots prop overrides generation', () => {
    const { container } = renderWithI18n(<Harness slots={['08:00', '12:00']} />)
    const slots = container.querySelectorAll('[data-slot="time-picker-slot"]')
    expect(slots).toHaveLength(2)
  })

  it('does not render duration row when durations prop is omitted', () => {
    const { container } = renderWithI18n(<Harness slots={['09:00']} />)
    expect(container.querySelectorAll('[data-slot="time-picker-duration-chip"]').length).toBe(0)
  })

  it('renders duration row and highlights active duration', () => {
    const onDurationChange = jest.fn()
    const { container } = renderWithI18n(
      <Harness
        slots={['09:00']}
        durations={[{ value: 15 }, { value: 30 }, { value: 60 }]}
        activeDuration={30}
        onDurationChange={onDurationChange}
      />,
    )
    const chips = container.querySelectorAll('[data-slot="time-picker-duration-chip"]')
    expect(chips.length).toBe(3)
    const active = container.querySelector('[data-slot="time-picker-duration-chip"][data-state="active"]')
    expect(active).not.toBeNull()
    expect(active!.textContent).toContain('30 min')
    fireEvent.click(chips[0])
    expect(onDurationChange).toHaveBeenCalledWith(15)
  })

  it('renders status row with custom statusLabel and fires onStatusChange', () => {
    const onStatusChange = jest.fn()
    const { container } = renderWithI18n(
      <Harness
        slots={['09:00']}
        statuses={[{ variant: 'available' }, { variant: 'busy' }]}
        statusLabel="Pick your status"
        onStatusChange={onStatusChange}
      />,
    )
    const row = container.querySelector('[data-slot="time-picker-status-row"]')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Pick your status')).toBeInTheDocument()
    const busyChip = within(row as HTMLElement).getByText('Busy').closest('button')!
    fireEvent.click(busyChip)
    expect(onStatusChange).toHaveBeenCalledWith('busy')
  })

  it('shows header with placeholder text when value is null', () => {
    const { container } = renderWithI18n(
      <Harness slots={['09:00']} headerPlaceholder="Pick a time..." />,
    )
    const header = container.querySelector('[data-slot="time-picker-header"]')
    expect(header).not.toBeNull()
    expect(header!.textContent).toContain('Pick a time...')
  })

  it('shows formatted current time in header when value is set', () => {
    const { container } = renderWithI18n(<Harness initial="10:30" slots={['10:00', '10:30']} />)
    const header = container.querySelector('[data-slot="time-picker-header"]')
    expect(header!.textContent).toContain('10:30')
    expect(header!.textContent).toContain('AM')
  })

  it('hides header when showHeader=false', () => {
    const { container } = renderWithI18n(<Harness slots={['09:00']} showHeader={false} />)
    expect(container.querySelector('[data-slot="time-picker-header"]')).toBeNull()
  })

  it('hides footer when showFooter=false', () => {
    const { container } = renderWithI18n(<Harness slots={['09:00']} showFooter={false} />)
    expect(container.querySelector('[data-slot="time-picker-footer"]')).toBeNull()
  })

  it('Apply button fires onApply with current value', () => {
    const onApply = jest.fn()
    renderWithI18n(<Harness initial="09:30" slots={['09:30']} onApply={onApply} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledWith('09:30')
  })

  it('Cancel button fires onCancel in inline mode (no value revert)', () => {
    const onCancel = jest.fn()
    renderWithI18n(<Harness initial="09:30" slots={['09:30']} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('clicking a slot updates the value', () => {
    const onChange = jest.fn()
    renderWithI18n(
      <TimePicker
        value="09:00"
        onChange={onChange}
        slots={['09:00', '09:30', '10:00']}
      />,
    )
    fireEvent.click(screen.getAllByRole('button')[2]) // 0=close? no — no onClose given. 0=09:00 slot
    // Be explicit: pick by label text rather than index.
    const tenAm = screen.getAllByRole('button').find((btn) => btn.textContent?.includes('10:00') && btn.textContent?.includes('AM'))
    expect(tenAm).toBeDefined()
    fireEvent.click(tenAm!)
    expect(onChange).toHaveBeenCalledWith('10:00')
  })

  it('disables all sub-components when disabled=true', () => {
    const { container } = renderWithI18n(
      <Harness
        slots={['09:00', '09:30']}
        durations={[{ value: 30 }]}
        statuses={[{ variant: 'available' }]}
        disabled
      />,
    )
    container.querySelectorAll<HTMLButtonElement>('button[disabled]')
    const slotButtons = container.querySelectorAll<HTMLButtonElement>('[data-slot="time-picker-slot"]')
    slotButtons.forEach((btn) => expect(btn).toBeDisabled())
    const durationChip = container.querySelector<HTMLButtonElement>('[data-slot="time-picker-duration-chip"]')
    expect(durationChip).toBeDisabled()
    const statusChip = container.querySelector<HTMLButtonElement>('[data-slot="time-picker-status-chip"]')
    expect(statusChip).toBeDisabled()
  })

  it('Arrow Down moves focus to next slot, Arrow Up moves back', () => {
    const { container } = renderWithI18n(<Harness slots={['09:00', '09:30', '10:00']} />)
    const slots = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-slot="time-picker-slot"]'))
    slots[0].focus()
    fireEvent.keyDown(slots[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(slots[1])
    fireEvent.keyDown(slots[1], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(slots[2])
    fireEvent.keyDown(slots[2], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(slots[1])
  })

  it('renders legacyFooterActions as link-style buttons', () => {
    const onNow = jest.fn()
    const onClear = jest.fn()
    renderWithI18n(
      <Harness
        slots={['09:00']}
        legacyFooterActions={[
          { label: 'Now', onClick: onNow, variant: 'link' },
          { label: 'Clear', onClick: onClear, variant: 'muted' },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Now' }))
    expect(onNow).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalled()
  })

  it('shows close button only when onClose is provided', () => {
    const onClose = jest.fn()
    const { container, rerender } = renderWithI18n(<Harness slots={['09:00']} />)
    expect(container.querySelector('[data-slot="time-picker-close"]')).toBeNull()
    rerender(<Harness slots={['09:00']} onClose={onClose} />)
    fireEvent.click(container.querySelector('[data-slot="time-picker-close"]')!)
    expect(onClose).toHaveBeenCalled()
  })

  it('falls back to default placeholder when none provided', () => {
    const { container } = renderWithI18n(<TimePicker slots={['09:00']} />)
    expect(container.querySelector('[data-slot="time-picker-header"]')!.textContent).toContain('Pick a time')
  })
})

describe('TimePicker controlled vs uncontrolled', () => {
  it('uncontrolled defaultValue is used as initial slot selection', () => {
    const { container } = renderWithI18n(
      <TimePicker defaultValue="10:00" slots={['09:30', '10:00']} />,
    )
    const slots = container.querySelectorAll('[data-slot="time-picker-slot"]')
    expect(slots[1]).toHaveAttribute('data-state', 'active')
  })

  it('controlled value drives selection regardless of internal state', () => {
    const { container, rerender } = renderWithI18n(
      <TimePicker value="09:30" onChange={() => {}} slots={['09:30', '10:00']} />,
    )
    let slots = container.querySelectorAll('[data-slot="time-picker-slot"]')
    expect(slots[0]).toHaveAttribute('data-state', 'active')
    rerender(<TimePicker value="10:00" onChange={() => {}} slots={['09:30', '10:00']} />)
    slots = container.querySelectorAll('[data-slot="time-picker-slot"]')
    expect(slots[1]).toHaveAttribute('data-state', 'active')
  })

  it('uncontrolled defaultActiveDuration drives duration highlight', () => {
    const { container } = renderWithI18n(
      <TimePicker
        slots={['09:00']}
        durations={[{ value: 15 }, { value: 30 }]}
        defaultActiveDuration={30}
      />,
    )
    const chips = container.querySelectorAll('[data-slot="time-picker-duration-chip"]')
    expect(chips[0]).toHaveAttribute('data-state', 'default')
    expect(chips[1]).toHaveAttribute('data-state', 'active')
  })
})
