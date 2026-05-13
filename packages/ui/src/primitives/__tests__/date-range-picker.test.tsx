import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DateRangePicker } from '../date-range-picker'
import { defaultDateRangePresets } from '../date-picker-helpers'

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider locale="en" dict={{}}>{ui}</I18nProvider>)
}

function getTrigger(): HTMLElement {
  const trigger = document.querySelector('[data-slot="date-range-picker-trigger"]')
  if (!trigger) throw new Error('DateRangePicker trigger not found')
  return trigger as HTMLElement
}

async function openPopover() {
  await act(async () => {
    fireEvent.click(getTrigger())
  })
}

describe('DateRangePicker primitive', () => {
  it('renders the placeholder when value is null', () => {
    renderWithI18n(<DateRangePicker value={null} onChange={() => {}} placeholder="Pick a range" />)
    expect(screen.getByText('Pick a range')).toBeInTheDocument()
  })

  it('renders the formatted range when value is provided', () => {
    renderWithI18n(
      <DateRangePicker
        value={{ start: new Date(2026, 4, 1), end: new Date(2026, 4, 9) }}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText('May 1, 2026 – May 9, 2026')).toBeInTheDocument()
  })

  it('opens the popover and renders two month grids by default', async () => {
    renderWithI18n(<DateRangePicker value={null} onChange={() => {}} />)
    await openPopover()
    expect(screen.getAllByRole('grid')).toHaveLength(2)
  })

  it('renders one month grid when numberOfMonths={1}', async () => {
    renderWithI18n(<DateRangePicker value={null} onChange={() => {}} numberOfMonths={1} />)
    await openPopover()
    expect(screen.getAllByRole('grid')).toHaveLength(1)
  })

  it('renders the preset sidebar with default 8 presets (Figma 446:7412)', async () => {
    renderWithI18n(<DateRangePicker value={null} onChange={() => {}} />)
    await openPopover()
    const sidebar = document.querySelector('[data-slot="date-range-presets"]')
    expect(sidebar).toBeInTheDocument()
    const buttons = sidebar!.querySelectorAll('button')
    expect(buttons.length).toBe(8)
  })

  it('hides the preset sidebar when showPresets={false}', async () => {
    renderWithI18n(<DateRangePicker value={null} onChange={() => {}} showPresets={false} />)
    await openPopover()
    expect(document.querySelector('[data-slot="date-range-presets"]')).toBeNull()
  })

  it('renders Apply and Cancel buttons in the footer by default', async () => {
    renderWithI18n(<DateRangePicker value={null} onChange={() => {}} />)
    await openPopover()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('does not render footer when withFooter={false}', async () => {
    renderWithI18n(<DateRangePicker value={null} onChange={() => {}} withFooter={false} />)
    await openPopover()
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('Cancel reverts the draft and does not call onChange', async () => {
    const onChange = jest.fn()
    renderWithI18n(<DateRangePicker value={null} onChange={onChange} />)
    await openPopover()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clicking a preset stages a draft range matching the preset', async () => {
    const onChange = jest.fn()
    renderWithI18n(<DateRangePicker value={null} onChange={onChange} />)
    await openPopover()
    const sidebar = document.querySelector('[data-slot="date-range-presets"]')
    expect(sidebar).toBeInTheDocument()
    const todayPreset = Array.from(sidebar!.querySelectorAll('button'))
      .find((btn) => btn.textContent?.trim() === 'today')
      || Array.from(sidebar!.querySelectorAll('button'))[0]
    expect(todayPreset).toBeDefined()
    await act(async () => {
      fireEvent.click(todayPreset!)
    })
    // withFooter=true means draft is staged, not committed yet
    expect(onChange).not.toHaveBeenCalled()
    // Apply commits the staged preset range
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    })
    expect(onChange).toHaveBeenCalledTimes(1)
    const committed = onChange.mock.calls[0][0]
    expect(committed).toMatchObject({ start: expect.any(Date), end: expect.any(Date) })
  })

  it('blocks open when disabled', () => {
    renderWithI18n(<DateRangePicker value={null} onChange={() => {}} disabled />)
    const trigger = getTrigger()
    expect(trigger).toBeDisabled()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('forwards aria-label to the trigger', () => {
    renderWithI18n(
      <DateRangePicker value={null} onChange={() => {}} aria-label="Date filter" />,
    )
    expect(screen.getByRole('button', { name: 'Date filter' })).toBeInTheDocument()
  })
})

describe('defaultDateRangePresets()', () => {
  it('returns 8 presets (Figma 446:7412)', () => {
    const presets = defaultDateRangePresets()
    expect(presets).toHaveLength(8)
  })

  it('exposes preset id, labelKey, and a callable range function', () => {
    const presets = defaultDateRangePresets()
    for (const preset of presets) {
      expect(typeof preset.id).toBe('string')
      expect(typeof preset.labelKey).toBe('string')
      expect(preset.labelKey).toMatch(/^ui\.dateRangePicker\.presets\./)
      expect(typeof preset.range).toBe('function')
      const range = preset.range()
      expect(range.start).toBeInstanceOf(Date)
      expect(range.end).toBeInstanceOf(Date)
      expect(range.end.getTime()).toBeGreaterThanOrEqual(range.start.getTime())
    }
  })

  it('includes the canonical Figma preset ids', () => {
    const presets = defaultDateRangePresets()
    const ids = presets.map((p) => p.id)
    expect(ids).toEqual([
      'today',
      'last_7_days',
      'last_30_days',
      'last_3_months',
      'last_12_months',
      'month_to_date',
      'year_to_date',
      'all_time',
    ])
  })

  it('today preset returns a range that contains the current date', () => {
    const presets = defaultDateRangePresets()
    const today = presets.find((p) => p.id === 'today')
    expect(today).toBeDefined()
    const range = today!.range()
    const now = Date.now()
    expect(range.start.getTime()).toBeLessThanOrEqual(now)
    expect(range.end.getTime()).toBeGreaterThanOrEqual(now)
  })
})
