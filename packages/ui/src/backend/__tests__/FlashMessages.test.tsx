import * as React from 'react'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { FlashMessages, flash } from '../FlashMessages'

describe('FlashMessages', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    window.history.replaceState({}, '', 'http://localhost/backend')
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    window.history.replaceState({}, '', 'http://localhost/backend')
  })

  it('auto-dismisses URL-based flashes after stripping query params', () => {
    window.history.replaceState({}, '', 'http://localhost/backend/checkout/pay-links?flash=Saved&type=success')

    renderWithProviders(<FlashMessages />, {
      dict: { 'notifications.actions.dismiss': 'Dismiss' },
    })

    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(window.location.search).toBe('')

    act(() => {
      jest.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('auto-dismisses programmatic flashes', () => {
    renderWithProviders(<FlashMessages />, {
      dict: { 'notifications.actions.dismiss': 'Dismiss' },
    })

    act(() => {
      flash('Pay link published', 'success')
    })

    expect(screen.getByText('Pay link published')).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('Pay link published')).not.toBeInTheDocument()
  })

  it('uses assertive alert semantics for error flashes', () => {
    renderWithProviders(<FlashMessages />, {
      dict: { 'notifications.actions.dismiss': 'Dismiss' },
    })

    act(() => {
      flash('Something failed', 'error')
    })

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
  })
})
