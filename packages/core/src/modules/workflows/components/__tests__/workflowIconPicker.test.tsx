/**
 * @jest-environment jsdom
 *
 * Step 3.10 (workflows UX Phase 3b): the searchable icon grid that replaces the
 * free-text `metadata.icon` input. Search filters the grid, clicking a tile
 * writes the registry's kebab-case name, an existing free-text value still
 * loads with its icon selected, and a name the registry does not know is kept
 * verbatim rather than dropped.
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { WorkflowIconPicker } from '../WorkflowIconPicker'

const TRIGGER_LABEL = 'Choose an icon'
const SEARCH_LABEL = 'Search icons'
const NO_RESULTS_TEXT = 'No icon matches "zzzznope"'
const CUSTOM_LABEL = 'Or enter a name'
const UNKNOWN_TEXT = 'This name is not in the icon set — it is kept as written and no icon renders.'
const NONE_TEXT = 'No icon'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  })
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
})

function Harness({ initialValue = '', onValueChange }: { initialValue?: string; onValueChange?: (value: string) => void }) {
  const [value, setValue] = React.useState(initialValue)
  return (
    <WorkflowIconPicker
      id="icon"
      value={value}
      onChange={(next) => {
        setValue(next)
        onValueChange?.(next)
      }}
    />
  )
}

const openPicker = () => fireEvent.click(screen.getByRole('button', { name: TRIGGER_LABEL }))

describe('WorkflowIconPicker', () => {
  it('renders an unset icon as "no icon" and opens a searchable grid', async () => {
    renderWithProviders(<Harness />)
    expect(screen.getByText(NONE_TEXT)).toBeInTheDocument()

    openPicker()
    await waitFor(() => {
      expect(screen.getByLabelText(SEARCH_LABEL)).toBeInTheDocument()
    })
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0)
  })

  it('filters the grid as the author types', async () => {
    renderWithProviders(<Harness />)
    openPicker()
    await waitFor(() => expect(screen.getByLabelText(SEARCH_LABEL)).toBeInTheDocument())

    const before = screen.getAllByRole('option').length
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: 'clock' } })

    await waitFor(() => {
      expect(screen.getAllByRole('option').length).toBeLessThan(before)
    })
    for (const option of screen.getAllByRole('option')) {
      expect(option.getAttribute('aria-label')).toContain('clock')
    }
  })

  it('shows an empty state when nothing matches', async () => {
    renderWithProviders(<Harness />)
    openPicker()
    await waitFor(() => expect(screen.getByLabelText(SEARCH_LABEL)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: 'zzzznope' } })
    await waitFor(() => {
      expect(screen.getByText(NO_RESULTS_TEXT)).toBeInTheDocument()
    })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('writes the registry name when a tile is selected', async () => {
    const onValueChange = jest.fn()
    renderWithProviders(<Harness onValueChange={onValueChange} />)
    openPicker()
    await waitFor(() => expect(screen.getByLabelText(SEARCH_LABEL)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: 'clock' } })
    await waitFor(() => expect(screen.getByRole('option', { name: 'clock' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('option', { name: 'clock' }))

    expect(onValueChange).toHaveBeenCalledWith('clock')
    await waitFor(() => expect(screen.getByText('clock')).toBeInTheDocument())
  })

  it('loads an existing free-text PascalCase value with that icon selected', async () => {
    renderWithProviders(<Harness initialValue="ShoppingCart" />)
    expect(screen.getByText('ShoppingCart')).toBeInTheDocument()

    openPicker()
    await waitFor(() => expect(screen.getByLabelText(SEARCH_LABEL)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: 'shopping-cart' } })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'shopping-cart' })).toHaveAttribute('aria-selected', 'true')
    })
    expect(screen.queryByText(UNKNOWN_TEXT)).not.toBeInTheDocument()
  })

  it('keeps a free-text value the registry does not know and says so', async () => {
    const onValueChange = jest.fn()
    renderWithProviders(<Harness initialValue="" onValueChange={onValueChange} />)
    openPicker()
    await waitFor(() => expect(screen.getByText(CUSTOM_LABEL)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(CUSTOM_LABEL), { target: { value: 'my-house-brand-glyph' } })

    expect(onValueChange).toHaveBeenCalledWith('my-house-brand-glyph')
    await waitFor(() => expect(screen.getByText(UNKNOWN_TEXT)).toBeInTheDocument())
  })
})
