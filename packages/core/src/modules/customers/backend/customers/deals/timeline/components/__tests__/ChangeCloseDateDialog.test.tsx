/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ChangeCloseDateDialog, buildQuickDateChips } from '../ChangeCloseDateDialog'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useLocale: () => 'en',
  useT: () => (key: string, fallback?: string, params?: Record<string, unknown>) =>
    (fallback ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? '')),
}))

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
    return { onSubmit, onCancel, input: screen.getByLabelText('New close date') as HTMLInputElement }
  }

  it('starts from the current date and keeps save disabled until it changes', () => {
    const { input } = renderDialog()
    expect(input.value).toBe('2026-11-04')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('applies a quick chip and saves with Cmd/Ctrl+Enter', async () => {
    const { input, onSubmit } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '+1 week' }))
    expect(input.value).toBe('2026-11-11')
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    })
    expect(onSubmit).toHaveBeenCalledWith('2026-11-11')
  })

  it('submits an exact date typed into the input', async () => {
    const { input, onSubmit } = renderDialog()
    fireEvent.change(input, { target: { value: '2026-12-24' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    expect(onSubmit).toHaveBeenCalledWith('2026-12-24')
  })

  it('cancels with Escape', () => {
    const { input, onCancel, onSubmit } = renderDialog()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
