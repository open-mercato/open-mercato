/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  })
})

// A set `value` opens the list and fires a browse fetch with an empty query. Its
// result used to replace the items outright, so an edit form hydrated with
// `value={storedId}` + `options={[storedOption]}` lost the stored selection from
// the list whenever the record fell outside that arbitrary first page — the form
// still held the id, but nothing on screen was marked as chosen.
describe('LookupSelect keeps the selection across browse fetches', () => {
  const STORED = { id: 'contractor-99', title: 'Stored Contractor' }
  const FIRST_PAGE = [
    { id: 'contractor-1', title: 'Alpha' },
    { id: 'contractor-2', title: 'Beta' },
  ]

  it('keeps a hydrated selection that is missing from the first page', async () => {
    const fetchItems = jest.fn(async () => FIRST_PAGE)
    render(
      <LookupSelect
        value={STORED.id}
        onChange={() => {}}
        options={[STORED]}
        fetchItems={fetchItems}
      />,
    )

    await screen.findByText('Alpha')
    expect(fetchItems).toHaveBeenCalledWith('')
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent(STORED.title)
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('uses the fetched copy and adds no duplicate when the page contains the selection', async () => {
    const fetchItems = jest.fn(async () => [
      ...FIRST_PAGE,
      { id: STORED.id, title: 'Stored Contractor (renamed)' },
    ])
    render(
      <LookupSelect
        value={STORED.id}
        onChange={() => {}}
        options={[STORED]}
        fetchItems={fetchItems}
      />,
    )

    await screen.findByText('Alpha')
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Stored Contractor (renamed)')
  })

  it('does not inject the selection into the results of a typed search', async () => {
    const fetchItems = jest.fn(async (query: string) => (query ? [FIRST_PAGE[0]] : FIRST_PAGE))
    const { container } = render(
      <LookupSelect
        value={STORED.id}
        onChange={() => {}}
        options={[STORED]}
        fetchItems={fetchItems}
      />,
    )
    await screen.findByText('Beta')

    fireEvent.change(getInput(container), { target: { value: 'Alp' } })
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull())

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('Alpha')
  })

  it('restores the selection once the typed query is cleared again', async () => {
    const fetchItems = jest.fn(async (query: string) => (query ? [FIRST_PAGE[0]] : FIRST_PAGE))
    const { container } = render(
      <LookupSelect
        value={STORED.id}
        onChange={() => {}}
        options={[STORED]}
        fetchItems={fetchItems}
      />,
    )
    const input = getInput(container)
    await screen.findByText('Beta')

    fireEvent.change(input, { target: { value: 'Alp' } })
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull())
    fireEvent.change(input, { target: { value: '' } })

    await screen.findByText('Beta')
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent(STORED.title)
  })

  it('keeps a selection picked from a search when the list goes back to browsing', async () => {
    const fetchItems = jest.fn(async (query: string) => (query ? [STORED] : FIRST_PAGE))
    function Harness() {
      const [value, setValue] = React.useState<string | null>(null)
      return <LookupSelect value={value} onChange={setValue} fetchItems={fetchItems} />
    }
    const { container } = render(<Harness />)
    const input = getInput(container)

    fireEvent.change(input, { target: { value: 'Stored' } })
    fireEvent.click(await screen.findByRole('option'))
    fireEvent.change(input, { target: { value: '' } })

    await screen.findByText('Alpha')
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent(STORED.title)
  })

  it('keeps a known selection listed when the browse fetch comes back empty', async () => {
    const fetchItems = jest.fn(async (query: string) => (query ? [STORED] : []))
    function Harness() {
      const [value, setValue] = React.useState<string | null>(null)
      return <LookupSelect value={value} onChange={setValue} fetchItems={fetchItems} />
    }
    const { container } = render(<Harness />)
    const input = getInput(container)

    fireEvent.change(input, { target: { value: 'Stored' } })
    fireEvent.click(await screen.findByRole('option'))
    fireEvent.change(input, { target: { value: '' } })

    await waitFor(() => expect(fetchItems).toHaveBeenLastCalledWith(''))
    await waitFor(() => expect(screen.queryByText('Searching…')).toBeNull())
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent(STORED.title)
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeInTheDocument()
  })

  it('never re-adds a previous selection after the value moves on', async () => {
    const fetchItems = jest.fn(async (query: string) => (query ? [FIRST_PAGE[0]] : FIRST_PAGE))
    const view = render(
      <LookupSelect
        value={STORED.id}
        onChange={() => {}}
        options={[STORED]}
        fetchItems={fetchItems}
      />,
    )
    await screen.findByText('Beta')

    view.rerender(
      <LookupSelect
        value="contractor-unknown"
        onChange={() => {}}
        options={[STORED]}
        fetchItems={fetchItems}
      />,
    )
    const input = getInput(view.container)
    fireEvent.change(input, { target: { value: 'Alp' } })
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull())
    fireEvent.change(input, { target: { value: '' } })

    await screen.findByText('Beta')
    expect(screen.queryByText(STORED.title)).toBeNull()
    expect(screen.queryByRole('option', { selected: true })).toBeNull()
  })

  it('leaves the browse results untouched when nothing is selected', async () => {
    render(
      <LookupSelect value={null} onChange={() => {}} fetchItems={async () => FIRST_PAGE} minQuery={0} />,
    )

    expect(await screen.findAllByRole('option')).toHaveLength(2)
    expect(screen.queryByRole('option', { selected: true })).toBeNull()
  })
})

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
