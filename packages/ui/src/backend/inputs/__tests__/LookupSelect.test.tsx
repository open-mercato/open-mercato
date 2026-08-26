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
})

describe('LookupSelect selected value display', () => {
  const RECORD_ID = 'd7f88312-f4b3-44b7-b03a-dc10e561cf8e'

  it('shows the selected item once the list is collapsed', () => {
    // The visible input is the search box and reverts to its placeholder, so
    // without this the control looked empty after a selection even though the
    // form held the id — the user could not tell what they had picked.
    render(
      <LookupSelect
        value="cust-1"
        onChange={() => {}}
        fetchItems={async () => []}
        selectedHintLabel={(id) => (id === 'cust-1' ? 'ExcelMed' : id)}
      />,
    )

    expect(screen.getByTestId('lookup-select-selected')).toHaveTextContent('ExcelMed')
  })

  it('never renders the raw id when no label resolver is given', () => {
    const { container } = render(
      <LookupSelect value={RECORD_ID} onChange={() => {}} fetchItems={async () => []} />,
    )

    expect(screen.queryByTestId('lookup-select-selected')).not.toBeInTheDocument()
    expect(container.textContent ?? '').not.toContain(RECORD_ID)
  })

  it('adds no second summary when the consumer renders its own selected label', () => {
    // Mirrors eudr's LookupSelectField: the host already prints the resolved
    // order label above the picker, so the collapsed block would both duplicate
    // it and expose the uuid (TC-EUDR-013).
    const { container } = render(
      <div>
        <p>Order ORDER-20260820-0000</p>
        <LookupSelect value={RECORD_ID} onChange={() => {}} fetchItems={async () => []} />
      </div>,
    )

    expect(screen.queryByTestId('lookup-select-selected')).not.toBeInTheDocument()
    expect(container.textContent ?? '').not.toContain(RECORD_ID)
    expect(screen.getAllByText(/ORDER-20260820-0000/)).toHaveLength(1)
  })

  it('shows the fetched title when the resolver has not resolved the id yet', async () => {
    // The staff CustomerPicker resolves names from a map it fills
    // asynchronously and falls back to `id` until then — that fallback must not
    // put a uuid on screen once the list collapses.
    function CustomerPickerHarness() {
      const [value, setValue] = React.useState<string | null>(null)
      return (
        <LookupSelect
          value={value}
          onChange={setValue}
          fetchItems={async () => [{ id: RECORD_ID, title: 'ExcelMed' }]}
          selectedHintLabel={(id) => id}
        />
      )
    }

    const { container } = render(<CustomerPickerHarness />)
    const input = getInput(container)

    fireEvent.change(input, { target: { value: 'Exc' } })
    fireEvent.click(await screen.findByRole('option'))
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.getByTestId('lookup-select-selected')).toHaveTextContent('ExcelMed')
    expect(container.textContent ?? '').not.toContain(RECORD_ID)
  })

  it('clears the selection from the collapsed summary', () => {
    const onChange = jest.fn()
    render(
      <LookupSelect
        value="cust-1"
        onChange={onChange}
        fetchItems={async () => []}
        selectedHintLabel={() => 'ExcelMed'}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('renders nothing selected when there is no value', () => {
    render(<LookupSelect value={null} onChange={() => {}} fetchItems={async () => []} />)
    expect(screen.queryByTestId('lookup-select-selected')).not.toBeInTheDocument()

// `disabled` used to gate only the search box, so a caller that locked the
// control still shipped a live option list: the selected card kept its click and
// Enter/Space handlers, "Clear selection" stayed reachable, and the action slot
// could still create a new record. Issue #5248 depended on `disabled` meaning
// "no interaction at all", so every one of those paths is pinned here.
describe('LookupSelect disabled', () => {
  const SELECTED = [{ id: 'product-1', title: 'Product One' }]

  function renderDisabled(onChange: (next: string | null) => void) {
    return render(
      <LookupSelect
        value="product-1"
        onChange={onChange}
        options={SELECTED}
        disabled
        actionSlot={
          <button type="button" data-testid="quick-create">
            Create
          </button>
        }
        clearLabel="Clear selection"
      />,
    )
  }

  it('still shows the current selection so the value stays readable', () => {
    renderDisabled(() => {})
    expect(screen.getByRole('option')).toHaveTextContent('Product One')
  })

  it('ignores clicks on the option row', () => {
    const onChange = jest.fn()
    renderDisabled(onChange)

    fireEvent.click(screen.getByRole('option'))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('ignores Enter and Space on the option row and keeps it out of the tab order', () => {
    const onChange = jest.fn()
    renderDisabled(onChange)
    const option = screen.getByRole('option')

    fireEvent.keyDown(option, { key: 'Enter' })
    fireEvent.keyDown(option, { key: ' ' })

    expect(onChange).not.toHaveBeenCalled()
    expect(option).toHaveAttribute('tabindex', '-1')
    expect(option).toHaveAttribute('aria-disabled', 'true')
  })

  it('hides the clear-selection button so the value cannot be nulled', () => {
    renderDisabled(() => {})
    expect(screen.queryByRole('button', { name: /clear selection/i })).toBeNull()
  })

  it('hides the action slot so no new record can be created into a locked field', () => {
    renderDisabled(() => {})
    expect(screen.queryByTestId('quick-create')).toBeNull()
  })

  it('keeps the search box disabled and its keyboard path inert', () => {
    const onChange = jest.fn()
    const { container } = renderDisabled(onChange)
    const input = getInput(container)

    expect(input.disabled).toBe(true)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onChange).not.toHaveBeenCalled()
  })
})
