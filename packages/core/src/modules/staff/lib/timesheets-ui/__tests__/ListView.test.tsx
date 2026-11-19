/**
 * @jest-environment jsdom
 */
// T5.3 — screen 12. The four notes: the author only when more than one person is
// in view, one expanded day, the start-time prefill, and the weekend that reads
// `—` rather than `0:00`.

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ListView } from '../ListView'
import { buildTimesheetDays, type TimesheetEntry } from '../../time-tracking-ui/timesheetData'
import { projectTarget, taskTarget } from '../../time-tracking-ui/timesheetTargets'

const mockTranslate = (
  key: string,
  fallbackOrParams?: string | Record<string, string | number>,
  params?: Record<string, string | number>,
): string => {
  const template = typeof fallbackOrParams === 'string' ? fallbackOrParams : key
  const values = typeof fallbackOrParams === 'string' ? params : fallbackOrParams
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    values[name] === undefined ? match : String(values[name]),
  )
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

// Radix Select measures its trigger; jsdom ships neither observer nor pointer capture.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false)
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {})

const WEEK = { from: '2026-07-13', to: '2026-07-19' }
const PROJECT = { id: 'p1', name: 'Nordvik — B2B', code: 'NORDVIK', color: null }
const TASK = { id: 't1', title: 'Contract discounts', timeProjectId: 'p1' }

function entry(overrides: Partial<TimesheetEntry> & { id: string; date: string }): TimesheetEntry {
  return {
    taskId: null,
    taskTitle: 'Contract discounts',
    timeProjectId: 'p1',
    projectLabel: 'Nordvik — B2B',
    description: null,
    startText: '09:15',
    endText: '13:30',
    durationMinutes: 255,
    roundedMinutes: null,
    isBillable: true,
    cost: null,
    currencyCode: null,
    rateOverrideAmount: null,
    isLocked: false,
    lockedReportId: null,
    updatedAt: null,
    tagIds: [],
    staffMemberId: 'staff-1',
    ...overrides,
  }
}

function renderList(overrides: Partial<React.ComponentProps<typeof ListView>> = {}) {
  const onQuickAdd = jest.fn()
  const onExpandedDateChange = jest.fn()
  const props: React.ComponentProps<typeof ListView> = {
    days: buildTimesheetDays(WEEK, [entry({ id: 'e1', date: '2026-07-17' })]),
    scaleMinutes: 480,
    dailyTargetMinutes: 480,
    expandedDate: '2026-07-17',
    onExpandedDateChange,
    targets: [projectTarget(PROJECT), taskTarget(PROJECT, TASK)],
    showAuthor: false,
    authorNames: new Map([['staff-1', 'Anna Nowak']]),
    canManage: true,
    onQuickAdd,
    onEditEntry: jest.fn(),
    onDuplicateEntry: jest.fn(),
    locale: 'en-GB',
    ...overrides,
  }
  render(<ListView {...props} />)
  return { onQuickAdd, onExpandedDateChange, props }
}

describe('ListView day bars', () => {
  it('renders one bar per day of the period and a dash for an empty weekend (note 4)', () => {
    renderList()
    const bars = screen.getAllByRole('button', { expanded: false })
    // Seven day bars; the expanded one reports `expanded: true`.
    expect(bars.length + 1).toBeGreaterThanOrEqual(7)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('badges a day that falls short of the target', () => {
    renderList()
    expect(screen.getAllByText('3:45 below target').length).toBeGreaterThan(0)
  })

  it('drops the target badge entirely when the tenant has no daily target', () => {
    renderList({ dailyTargetMinutes: null })
    expect(screen.queryByText(/below target/)).not.toBeInTheDocument()
  })

  it('lets any day be expanded by clicking its bar (note 2)', () => {
    const { onExpandedDateChange } = renderList()
    fireEvent.click(screen.getByRole('button', { name: /Mon 13 Jul/ }))
    expect(onExpandedDateChange).toHaveBeenCalledWith('2026-07-13')
  })

  it('collapses the open day when its own bar is clicked again', () => {
    const { onExpandedDateChange } = renderList()
    fireEvent.click(screen.getByRole('button', { name: /Fri 17 Jul/ }))
    expect(onExpandedDateChange).toHaveBeenCalledWith(null)
  })
})

describe('ListView expanded day', () => {
  it('signs a row with its author only when more than one person is in view (note 1)', () => {
    renderList()
    expect(screen.queryByText(/Anna Nowak/)).not.toBeInTheDocument()
    screen.getByText('09:15 – 13:30')

    renderList({ showAuthor: true })
    expect(screen.getAllByText(/Anna Nowak/).length).toBeGreaterThan(0)
  })

  it('prefills the quick-add start with the end of the previous entry (note 3)', () => {
    renderList()
    expect((screen.getByLabelText('Start time') as HTMLInputElement).value).toBe('13:30')
  })

  it('leaves the start empty on a day whose entries carry no clocks', () => {
    renderList({
      days: buildTimesheetDays(WEEK, [
        entry({ id: 'e1', date: '2026-07-17', startText: '', endText: '' }),
      ]),
    })
    expect((screen.getByLabelText('Start time') as HTMLInputElement).value).toBe('')
  })

  it('submits a quick-add with the parsed duration and the chosen day', async () => {
    const { onQuickAdd } = renderList()
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '1h 40m' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    })
    expect(onQuickAdd).toHaveBeenCalledWith({
      date: '2026-07-17',
      targetKey: 'p1',
      durationMinutes: 100,
      startClock: '13:30',
    })
  })

  it('keeps Add disabled until a duration parses', () => {
    renderList()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: 'lunch' } })
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('hides every editing affordance for a reader who cannot manage entries', () => {
    renderList({ canManage: false })
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('refuses to edit or duplicate a locked entry', () => {
    renderList({
      days: buildTimesheetDays(WEEK, [entry({ id: 'e1', date: '2026-07-17', isLocked: true })]),
    })
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeDisabled()
    expect(screen.getByText('locked')).toBeInTheDocument()
  })
})
