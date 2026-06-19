/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { LookupSelect } from '../LookupSelect'

function getInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input')
  if (!el) throw new Error('input not found')
  return el as HTMLInputElement
}

// Mirrors the inline editors in the sales document detail page: a parent that
// re-renders (e.g. when a fetch toggles a loading flag) passes a brand-new
// `onReady` callback each render, and that callback force-prefills the search
// box. Regression for issue #2389 — typed text must survive parent re-renders.
function PrefillHarness({ prefill = '' }: { prefill?: string }) {
  const [, force] = React.useState(0)
  return (
    <div>
      <LookupSelect
        value={null}
        onChange={() => {}}
        fetchItems={async () => []}
        onReady={({ setQuery }) => {
          setQuery(prefill)
        }}
      />
      <button type="button" data-testid="rerender" onClick={() => force((n) => n + 1)}>
        rerender
      </button>
    </div>
  )
}

describe('LookupSelect onReady stability', () => {
  it('keeps the typed query after a parent re-render replaces onReady (issue #2389)', () => {
    const { container } = render(<PrefillHarness prefill="" />)
    const input = getInput(container)

    fireEvent.change(input, { target: { value: 'Me' } })
    expect(input.value).toBe('Me')

    // Force a parent re-render — this hands LookupSelect a new onReady identity.
    fireEvent.click(screen.getByTestId('rerender'))

    expect(input.value).toBe('Me')
  })

  it('invokes onReady once on mount and not again on subsequent re-renders', () => {
    const onReady = jest.fn()
    function Harness() {
      const [, force] = React.useState(0)
      return (
        <div>
          {/* fresh inline callback every render — identity changes each time */}
          <LookupSelect
            value={null}
            onChange={() => {}}
            fetchItems={async () => []}
            onReady={(controls) => onReady(controls)}
          />
          <button type="button" data-testid="rerender" onClick={() => force((n) => n + 1)}>
            rerender
          </button>
        </div>
      )
    }

    render(<Harness />)
    expect(onReady).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('rerender'))
    fireEvent.click(screen.getByTestId('rerender'))

    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('still prefills the search box once via onReady on mount', () => {
    const { container } = render(<PrefillHarness prefill="Mercato Fashion Online" />)
    const input = getInput(container)
    expect(input.value).toBe('Mercato Fashion Online')
  })
})
