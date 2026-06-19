/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

import { RecordConflictBanner } from '../RecordConflictBanner'
import { dismissRecordConflict, showRecordConflict } from '../store'

describe('RecordConflictBanner', () => {
  beforeEach(() => dismissRecordConflict())
  afterEach(() => dismissRecordConflict())

  it('renders nothing when there is no active conflict', () => {
    const { container } = render(<RecordConflictBanner />)
    expect(container.querySelector('[data-testid="record-conflict-banner"]')).toBeNull()
  })

  it('renders the localized message + Refresh/Dismiss as an alert when a conflict is active', () => {
    render(<RecordConflictBanner />)
    act(() => {
      showRecordConflict({
        message: 'This record was modified by someone else. Refresh and try again.',
      })
    })
    const banner = screen.getByTestId('record-conflict-banner')
    expect(banner.getAttribute('role')).toBe('alert')
    expect(banner.textContent).toContain('Record changed')
    expect(banner.textContent).toContain('This record was modified by someone else. Refresh and try again.')
    expect(screen.getByRole('button', { name: 'Refresh' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Dismiss' })).not.toBeNull()
  })

  it('invokes a custom onRefresh and clears the bar when Refresh is clicked', () => {
    const onRefresh = jest.fn()
    render(<RecordConflictBanner />)
    act(() => {
      showRecordConflict({ message: 'Changed', onRefresh })
    })
    act(() => {
      screen.getByRole('button', { name: 'Refresh' }).click()
    })
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('record-conflict-banner')).toBeNull()
  })

  it('Dismiss clears the bar without refreshing', () => {
    const onRefresh = jest.fn()
    render(<RecordConflictBanner />)
    act(() => {
      showRecordConflict({ message: 'Changed', onRefresh })
    })
    act(() => {
      screen.getByRole('button', { name: 'Dismiss' }).click()
    })
    expect(onRefresh).not.toHaveBeenCalled()
    expect(screen.queryByTestId('record-conflict-banner')).toBeNull()
  })
})
