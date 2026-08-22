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

describe('LookupSelect keyboard accessibility', () => {
  const ITEMS = [
    { id: 'plot-1', title: 'Fazenda Norte' },
    { id: 'plot-2', title: 'Fazenda Sul' },
  ]

  function renderWithResults(onChange: (next: string | null) => void) {
    const utils = render(
      <LookupSelect
        value={null}
        onChange={onChange}
        fetchItems={async () => ITEMS}
        minQuery={2}
      />,
    )
    return utils
  }

  it('exposes combobox/listbox/option semantics once results render', async () => {
    const { container } = renderWithResults(() => {})
    const input = getInput(container)
    expect(input).toHaveAttribute('role', 'combobox')
    expect(input).toHaveAttribute('aria-autocomplete', 'list')

    fireEvent.change(input, { target: { value: 'Faz' } })
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(2)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'true')
  })

  it('selects the highlighted result with ArrowDown + Enter', async () => {
    const onChange = jest.fn()
    const { container } = renderWithResults(onChange)
    const input = getInput(container)

    fireEvent.change(input, { target: { value: 'Faz' } })
    await screen.findAllByRole('option')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('plot-1')
  })

  it('moves the highlight with repeated arrows and wraps', async () => {
    const onChange = jest.fn()
    const { container } = renderWithResults(onChange)
    const input = getInput(container)

    fireEvent.change(input, { target: { value: 'Faz' } })
    await screen.findAllByRole('option')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('plot-2')
  })

  it('clears the query with Escape instead of leaking it to the dialog', async () => {
    const escapeSpy = jest.fn()
    const { container } = render(
      <div onKeyDown={escapeSpy}>
        <LookupSelect value={null} onChange={() => {}} fetchItems={async () => ITEMS} minQuery={2} />
      </div>,
    )
    const input = getInput(container)
    fireEvent.change(input, { target: { value: 'Faz' } })
    await screen.findAllByRole('option')

    escapeSpy.mockClear()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
    expect(escapeSpy).not.toHaveBeenCalled()
  })

  // Issue #5456 item 3: a `minQuery` of 0 makes `shouldSearch` true for the empty
  // query, so the full option list renders before any interaction. Callers that
  // want the collapsed "start typing" affordance must keep minQuery >= 1.
  it('renders pre-expanded with minQuery=0 and collapsed with minQuery=1', async () => {
    const expanded = render(
      <LookupSelect value={null} onChange={() => {}} fetchItems={async () => ITEMS} minQuery={0} />,
    )
    expect(await expanded.findAllByRole('option')).toHaveLength(2)
    expanded.unmount()

    const collapsed = render(
      <LookupSelect value={null} onChange={() => {}} fetchItems={async () => ITEMS} minQuery={1} />,
    )
    expect(collapsed.queryByRole('listbox')).toBeNull()
    expect(collapsed.getByText('Start typing to search.')).toBeInTheDocument()

    fireEvent.change(getInput(collapsed.container), { target: { value: 'F' } })
    expect(await collapsed.findAllByRole('option')).toHaveLength(2)
  })

  // A selection must never be invisible. Before this, `shouldSearch` only made an
  // exception for a set `value` when the caller ALSO passed `options`, so a
  // minQuery >= 1 lookup without that prop collapsed over its own selection: no
  // selected row, no checkmark and no clear control — the user could not see or
  // undo what was chosen (review of #5481, order-line Status field).
  it('keeps a made selection visible while collapsed, without an options prop', async () => {
    const onChange = jest.fn()
    const view = render(
      <LookupSelect
        value="plot-1"
        onChange={onChange}
        fetchItems={async () => ITEMS}
        minQuery={1}
      />,
    )

    const selected = await view.findByRole('option', { selected: true })
    expect(selected).toHaveTextContent(ITEMS[0].title)

    const clear = view.getByRole('button', { name: 'Clear selection' })
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('stays collapsed at minQuery >= 1 once the selection is cleared', async () => {
    const view = render(
      <LookupSelect value={null} onChange={() => {}} fetchItems={async () => ITEMS} minQuery={1} />,
    )
    expect(view.queryByRole('listbox')).toBeNull()
    expect(view.getByText('Start typing to search.')).toBeInTheDocument()
  })
})
