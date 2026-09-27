import * as React from 'react'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { FlashMessages, flash } from '../FlashMessages'

function setReferrer(value: string) {
  Object.defineProperty(document, 'referrer', {
    configurable: true,
    value,
  })
}

describe('FlashMessages', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    window.history.replaceState({}, '', 'http://localhost/backend')
    setReferrer('')
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    window.history.replaceState({}, '', 'http://localhost/backend')
    setReferrer('')
  })

  it('auto-dismisses URL-based flashes after stripping query params', () => {
    window.history.replaceState({}, '', 'http://localhost/backend/checkout/pay-links?flash=Saved&type=success')

    renderWithProviders(<FlashMessages />)

    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(window.location.search).toBe('')

    act(() => {
      jest.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('honors same-origin referrer flashes', () => {
    setReferrer('http://localhost/backend/checkout/templates')
    window.history.replaceState({}, '', 'http://localhost/backend/checkout/pay-links?flash=Saved&type=success')

    renderWithProviders(<FlashMessages />)

    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('suppresses cross-origin referrer flashes but still strips the params', () => {
    setReferrer('https://attacker.example.com/phish')
    window.history.replaceState(
      {},
      '',
      'http://localhost/backend/dashboard?flash=Your+account+was+suspended&type=error',
    )

    renderWithProviders(<FlashMessages />)

    expect(screen.queryByText('Your account was suspended')).not.toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('falls back to a safe kind when the type param is not an allowed FlashKind', () => {
    window.history.replaceState(
      {},
      '',
      'http://localhost/backend/dashboard?flash=Saved&type=javascript',
    )

    renderWithProviders(<FlashMessages />)

    expect(screen.getByText('Saved')).toBeInTheDocument()
    const badge = document.querySelector('[data-slot="alert-icon-badge"]')
    expect(badge?.getAttribute('data-status')).toBe('success')
  })

  it('renders a single toast when several hosts mount it on the same page', () => {
    renderWithProviders(
      <>
        <FlashMessages />
        <FlashMessages />
      </>,
    )

    act(() => {
      flash('Project team updated.', 'success')
    })

    expect(screen.getAllByText('Project team updated.')).toHaveLength(1)
  })

  /**
   * The handover is the half of the primary-host election that nothing else
   * exercises. Only the first host to mount renders, so if it unmounts while a
   * toast is up — a backend page tearing its `AppShell` down on navigation, with
   * `FrontendLayout`'s host still mounted above it — the surviving host has to
   * take over. If it did not, the message would vanish, which is worse than the
   * duplicate this election replaced.
   */
  it('hands a displayed toast over when the primary host unmounts', () => {
    function Hosts({ withPrimary }: { withPrimary: boolean }) {
      return (
        <>
          {withPrimary ? <FlashMessages /> : null}
          <FlashMessages />
        </>
      )
    }

    const { rerender } = renderWithProviders(<Hosts withPrimary />)

    act(() => {
      flash('Project team updated.', 'success')
    })

    expect(screen.getAllByText('Project team updated.')).toHaveLength(1)

    act(() => {
      rerender(<Hosts withPrimary={false} />)
    })

    expect(screen.getAllByText('Project team updated.')).toHaveLength(1)
  })

  /**
   * Regression for #6402: a page that flashes from its own mount effect runs
   * before the layout's host attaches its listener (child effects fire first),
   * so on a full page load the event used to be dropped and the user saw nothing.
   */
  it('shows a flash dispatched before any host was listening once a host mounts', () => {
    function FlashesOnMount() {
      React.useEffect(() => {
        flash('Channel connected (gmail).', 'success')
      }, [])
      return null
    }

    renderWithProviders(
      <>
        <FlashMessages />
        <FlashesOnMount />
      </>,
    )

    expect(screen.getByText('Channel connected (gmail).')).toBeInTheDocument()
    const badge = document.querySelector('[data-slot="alert-icon-badge"]')
    expect(badge?.getAttribute('data-status')).toBe('success')
  })

  it('renders an early flash once when several hosts mount in the same commit', () => {
    flash('This connection link was already used.', 'error')

    renderWithProviders(
      <>
        <FlashMessages />
        <FlashMessages />
      </>,
    )

    expect(screen.getAllByText('This connection link was already used.')).toHaveLength(1)
    const badge = document.querySelector('[data-slot="alert-icon-badge"]')
    expect(badge?.getAttribute('data-status')).toBe('error')
  })

  it('does not replay an early flash to a host that mounts later', () => {
    flash('Already delivered.', 'success')
    const first = renderWithProviders(<FlashMessages />)
    expect(screen.getByText('Already delivered.')).toBeInTheDocument()
    first.unmount()

    act(() => {
      jest.advanceTimersByTime(0)
    })

    renderWithProviders(<FlashMessages />)
    expect(screen.queryByText('Already delivered.')).not.toBeInTheDocument()
  })

  it('drops an undelivered flash that is older than the pending window', () => {
    flash('Too old to show.', 'success')

    act(() => {
      jest.advanceTimersByTime(5001)
    })

    renderWithProviders(<FlashMessages />)
    expect(screen.queryByText('Too old to show.')).not.toBeInTheDocument()
  })

  it('auto-dismisses programmatic flashes', () => {
    renderWithProviders(<FlashMessages />)

    act(() => {
      flash('Pay link published', 'success')
    })

    expect(screen.getByText('Pay link published')).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(3000)
    })

    expect(screen.queryByText('Pay link published')).not.toBeInTheDocument()
  })
})
