/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ChangeCloseDateDialog, buildQuickDateChips, dateKeyToLocalDate, localDateToDateKey } from '../ChangeCloseDateDialog'

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, params?: Record<string, unknown>) =>
    (fallback ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))
  return {
    useLocale: () => 'en',
    useOptionalLocale: () => 'en',
    useT: () => translate,
    useOptionalT: () => translate,
  }
})

describe('buildQuickDateChips', () => {
  it('computes chips relative to the current close date', () => {
    expect(buildQuickDateChips('2026-11-04')).toEqual([
      { id: 'plusWeek', value: '2026-11-11' },
      { id: 'plusTwoWeeks', value: '2026-11-18' },
      { id: 'endOfMonth', value: '2026-11-30' },
      { id: 'endOfQuarter', value: '2026-12-31' },
    ])
  })

  it('falls back to today when the deal has no close date', () => {
    const chips = buildQuickDateChips(null, new Date('2026-01-10T12:00:00.000Z'))
    expect(chips[0]).toEqual({ id: 'plusWeek', value: '2026-01-17' })
    expect(chips[3]).toEqual({ id: 'endOfQuarter', value: '2026-03-31' })
  })
})

describe('date key conversion for the date picker', () => {
  it('maps a UTC date key to the same local calendar day and back without shifting', () => {
    const local = dateKeyToLocalDate('2026-12-31')
    expect(local?.getFullYear()).toBe(2026)
    expect(local?.getMonth()).toBe(11)
    expect(local?.getDate()).toBe(31)
    expect(localDateToDateKey(local)).toBe('2026-12-31')
    expect(localDateToDateKey(new Date(2027, 0, 1, 23, 59))).toBe('2027-01-01')
  })

  it('rejects invalid keys and empty dates', () => {
    expect(dateKeyToLocalDate('2026-13-01')).toBeNull()
    expect(dateKeyToLocalDate(null)).toBeNull()
    expect(localDateToDateKey(null)).toBe('')
  })
})

describe('ChangeCloseDateDialog', () => {
  function renderDialog(overrides: Partial<React.ComponentProps<typeof ChangeCloseDateDialog>> = {}) {
    const onSubmit = jest.fn().mockResolvedValue(undefined)
    const onCancel = jest.fn()
    render(
      <ChangeCloseDateDialog
        open
        currentDate="2026-11-04T00:00:00.000Z"
        onCancel={onCancel}
        onSubmit={onSubmit}
        {...overrides}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'New close date' })
    return { onSubmit, onCancel, trigger }
  }

  it('uses the house date picker showing the current date and keeps save disabled until it changes', () => {
    const { trigger } = renderDialog()
    expect(trigger).toHaveAttribute('data-slot', 'date-picker-trigger')
    expect(document.querySelector('input[type="date"]')).toBeNull()
    expect(trigger.textContent).toMatch(/2026|Nov|11/)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('applies a quick chip and saves with Cmd/Ctrl+Enter', async () => {
    const { trigger, onSubmit } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '+1 week' }))
    await act(async () => {
      fireEvent.keyDown(trigger, { key: 'Enter', ctrlKey: true })
    })
    expect(onSubmit).toHaveBeenCalledWith('2026-11-11')
  })

  it('submits an exact day picked in the calendar as a date key', async () => {
    const { trigger, onSubmit } = renderDialog()
    await act(async () => {
      fireEvent.click(trigger)
    })
    const day = document.querySelector<HTMLElement>('[data-day="2026-11-24"] button')
    expect(day).not.toBeNull()
    await act(async () => {
      fireEvent.click(day!)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(onSubmit).toHaveBeenCalledWith('2026-11-24')
  })

  it('cancels with Escape', () => {
    const { trigger, onCancel, onSubmit } = renderDialog()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
