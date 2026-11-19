/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MetadataEditor } from '../MetadataEditor'

jest.mock('lucide-react', () => ({
  ChevronDown: (props: Record<string, unknown>) => <svg data-testid="chevron-down" {...props} />,
  ChevronRight: (props: Record<string, unknown>) => <svg data-testid="chevron-right" {...props} />,
  Plus: (props: Record<string, unknown>) => <svg data-testid="plus-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <svg data-testid="trash-icon" {...props} />,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild, ...props }: any) => (
    <button {...props} type={props.type || 'button'}>{children}</button>
  ),
}))
jest.mock('@open-mercato/ui/primitives/input', () => ({
  Input: ({ children, ...props }: any) => <input {...props}>{children}</input>,
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: string, vars?: Record<string, unknown>) => {
    const base = (fallback ?? key) as string
    if (vars) return base.replace(/\{\{(\w+)\}\}/g, (_, token) => String(vars[token] ?? ''))
    return base
  }
  return { useT: () => translate }
})

let localIdCounter = 0
jest.mock('../productForm', () => ({
  createLocalId: () => `local-${++localIdCounter}`,
}))

describe('MetadataEditor', () => {
  beforeEach(() => {
    localIdCounter = 0
  })

  it('starts collapsed by default', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{ foo: 'bar' }} onChange={onChange} />)
    expect(screen.getByText('Show metadata')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('foo')).not.toBeInTheDocument()
  })

  it('expands when the toggle button is clicked', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{ foo: 'bar' }} onChange={onChange} />)
    fireEvent.click(screen.getByText('Show metadata'))
    expect(screen.getByText('Hide metadata')).toBeInTheDocument()
    expect(screen.getByDisplayValue('foo')).toBeInTheDocument()
    expect(screen.getByDisplayValue('bar')).toBeInTheDocument()
  })

  it('collapses when the toggle button is clicked while expanded', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{ foo: 'bar' }} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getByDisplayValue('foo')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Hide metadata'))
    expect(screen.getByText('Show metadata')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('foo')).not.toBeInTheDocument()
  })

  it('starts expanded when defaultCollapsed is false', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{ key1: 'val1' }} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getByDisplayValue('key1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('val1')).toBeInTheDocument()
  })

  it('shows empty message when there are no entries', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{}} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getByText('No metadata. Add your first entry.')).toBeInTheDocument()
  })

  it('shows empty message when value is null', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={null} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getByText('No metadata. Add your first entry.')).toBeInTheDocument()
  })

  it('adds a new empty entry when Add button is clicked', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{}} onChange={onChange} defaultCollapsed={false} />)
    fireEvent.click(screen.getByText('Add entry'))
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.length).toBe(2)
  })

  it('auto-expands when adding an entry while collapsed', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{}} onChange={onChange} />)
    expect(screen.getByText('Show metadata')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Add entry'))
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.length).toBe(2)
  })

  it('retains a blank draft entry across equivalent parent values', () => {
    const onChange = jest.fn()
    const { rerender } = render(<MetadataEditor value={{}} onChange={onChange} />)
    fireEvent.click(screen.getByText('Add entry'))
    rerender(<MetadataEditor value={{}} onChange={onChange} />)
    rerender(<MetadataEditor value={{}} onChange={onChange} />)
    expect(screen.getByPlaceholderText('Key')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Value')).toBeInTheDocument()
  })

  it('still synchronizes a genuine external change after an equivalent echo', () => {
    const onChange = jest.fn()
    const { rerender } = render(<MetadataEditor value={{ existing: 'before' }} onChange={onChange} />)
    fireEvent.click(screen.getByText('Add entry'))
    rerender(<MetadataEditor value={{ existing: 'before' }} onChange={onChange} />)
    rerender(<MetadataEditor value={{ existing: 'before' }} onChange={onChange} />)
    rerender(<MetadataEditor value={{ existing: 'external update' }} onChange={onChange} />)
    expect(screen.getByDisplayValue('external update')).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
  })

  it('removes an entry when trash button is clicked', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{ alpha: 'one', beta: 'two' }} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getByDisplayValue('alpha')).toBeInTheDocument()
    const removeButtons = screen.getAllByText('Remove entry')
    fireEvent.click(removeButtons[0])
    expect(onChange).toHaveBeenCalledWith({ beta: 'two' })
  })

  it('calls onChange when a key input is edited', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{ mykey: 'myval' }} onChange={onChange} defaultCollapsed={false} />)
    const keyInput = screen.getByDisplayValue('mykey')
    fireEvent.change(keyInput, { target: { value: 'newkey' } })
    expect(onChange).toHaveBeenCalledWith({ newkey: 'myval' })
  })

  it('calls onChange when a value input is edited', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{ color: 'red' }} onChange={onChange} defaultCollapsed={false} />)
    const valueInput = screen.getByDisplayValue('red')
    fireEvent.change(valueInput, { target: { value: 'blue' } })
    expect(onChange).toHaveBeenCalledWith({ color: 'blue' })
  })

  it('parses boolean "true" string to boolean true', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{ flag: 'placeholder' }} onChange={onChange} defaultCollapsed={false} />)
    const valueInput = screen.getByDisplayValue('placeholder')
    fireEvent.change(valueInput, { target: { value: 'true' } })
    expect(onChange).toHaveBeenCalledWith({ flag: true })
  })

  it('parses numeric strings to numbers', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{ count: 'placeholder' }} onChange={onChange} defaultCollapsed={false} />)
    const valueInput = screen.getByDisplayValue('placeholder')
    fireEvent.change(valueInput, { target: { value: '42' } })
    expect(onChange).toHaveBeenCalledWith({ count: 42 })
  })

  it('parses valid JSON objects from value strings', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{ data: 'placeholder' }} onChange={onChange} defaultCollapsed={false} />)
    const valueInput = screen.getByDisplayValue('placeholder')
    fireEvent.change(valueInput, { target: { value: '{"nested":"obj"}' } })
    expect(onChange).toHaveBeenCalledWith({ data: { nested: 'obj' } })
  })

  /**
   * `addEntry`'s own `emitChange` arms `skipSyncRef` so the resync effect
   * ignores the very next `value`-prop change (it assumes that change is its
   * own edit echoing back through a controlled parent). In these tests the
   * parent is a plain mock, so no such echo ever arrives — the ref would
   * stay armed into the rerender meant to exercise the resync comparison,
   * which would then skip `entriesMatchValue` entirely and pass for the
   * wrong reason. Rerendering once with a new-but-equal `value` reference
   * consumes that stale flag so the following rerender is a genuine test.
   */
  function addBlankDraftRowAndConsumeSkip(
    rerender: (element: React.ReactElement) => void,
    onChange: jest.Mock,
    baseValue: Record<string, unknown>,
  ) {
    fireEvent.click(screen.getByText('Add entry'))
    rerender(<MetadataEditor value={{ ...baseValue }} onChange={onChange} defaultCollapsed={false} />)
  }

  const lastPlaceholderInput = (placeholder: string) => screen.getAllByPlaceholderText(placeholder).at(-1)

  it('preserves a blank draft row when an unrelated rerender reorders nested metadata keys, and still resyncs on a real change', () => {
    const onChange = jest.fn()
    const baseValue = { nested: { longKey: 1, a: 2 } }
    const { rerender } = render(
      <MetadataEditor value={baseValue} onChange={onChange} defaultCollapsed={false} />,
    )
    addBlankDraftRowAndConsumeSkip(rerender, onChange, baseValue)
    expect(lastPlaceholderInput('Key')).toHaveValue('')
    expect(lastPlaceholderInput('Value')).toHaveValue('')

    // Same nested value, keys in a different order — e.g. a JSONB round-trip.
    rerender(
      <MetadataEditor value={{ nested: { a: 2, longKey: 1 } }} onChange={onChange} defaultCollapsed={false} />,
    )
    expect(screen.getAllByPlaceholderText('Key')).toHaveLength(2)
    expect(lastPlaceholderInput('Key')).toHaveValue('')
    expect(lastPlaceholderInput('Value')).toHaveValue('')

    // A genuinely different value must still resync and drop the draft —
    // proving the check above isn't vacuously true.
    rerender(<MetadataEditor value={{ nested: { a: 3 } }} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getAllByPlaceholderText('Key')).toHaveLength(1)
  })

  it('preserves a blank draft row across an unrelated rerender of an unchanged null-valued entry, and still resyncs on a real change', () => {
    const onChange = jest.fn()
    const baseValue = { note: null }
    const { rerender } = render(
      <MetadataEditor value={baseValue} onChange={onChange} defaultCollapsed={false} />,
    )
    addBlankDraftRowAndConsumeSkip(rerender, onChange, baseValue)
    expect(lastPlaceholderInput('Key')).toHaveValue('')
    expect(lastPlaceholderInput('Value')).toHaveValue('')

    // `note` is unchanged — still null — but re-parsing its blank text-input
    // representation ('') back to a value yields '' (an empty string), not
    // null, so a naive re-parsed comparison would wrongly treat this as a
    // real change and wipe the draft below.
    rerender(<MetadataEditor value={{ note: null }} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getAllByPlaceholderText('Key')).toHaveLength(2)
    expect(lastPlaceholderInput('Key')).toHaveValue('')
    expect(lastPlaceholderInput('Value')).toHaveValue('')

    // A genuinely different value must still resync and drop the draft.
    rerender(<MetadataEditor value={{ note: 'now set' }} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getAllByPlaceholderText('Key')).toHaveLength(1)
  })

  it('preserves a blank draft row across an unrelated rerender of an unchanged numeric-looking string value, and still resyncs on a real change', () => {
    const onChange = jest.fn()
    const baseValue = { code: '42' }
    const { rerender } = render(
      <MetadataEditor value={baseValue} onChange={onChange} defaultCollapsed={false} />,
    )
    addBlankDraftRowAndConsumeSkip(rerender, onChange, baseValue)
    expect(lastPlaceholderInput('Key')).toHaveValue('')
    expect(lastPlaceholderInput('Value')).toHaveValue('')

    // `code` is unchanged — still the string "42" — but re-parsing its text
    // input ("42") back to a value yields the number 42, not the string
    // "42", so a naive re-parsed comparison would wrongly treat this as a
    // real change and wipe the draft below.
    rerender(<MetadataEditor value={{ code: '42' }} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getAllByPlaceholderText('Key')).toHaveLength(2)
    expect(lastPlaceholderInput('Key')).toHaveValue('')
    expect(lastPlaceholderInput('Value')).toHaveValue('')

    // A genuinely different value must still resync and drop the draft.
    rerender(<MetadataEditor value={{ code: '43' }} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getAllByPlaceholderText('Key')).toHaveLength(1)
  })

  it('preserves a blank draft row across an unrelated rerender of an unchanged JSON-looking string value', () => {
    const onChange = jest.fn()
    // A literal string that happens to look like JSON — not an object.
    const baseValue = { config: '{"enabled":true}' }
    const { rerender } = render(
      <MetadataEditor value={baseValue} onChange={onChange} defaultCollapsed={false} />,
    )
    addBlankDraftRowAndConsumeSkip(rerender, onChange, baseValue)
    expect(lastPlaceholderInput('Key')).toHaveValue('')
    expect(lastPlaceholderInput('Value')).toHaveValue('')

    // `config` is unchanged — still the literal string '{"enabled":true}' —
    // but re-parsing that text input yields an object, which must not be
    // compared against the (still-string) incoming value structurally.
    rerender(<MetadataEditor value={{ config: '{"enabled":true}' }} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getAllByPlaceholderText('Key')).toHaveLength(2)
    expect(lastPlaceholderInput('Key')).toHaveValue('')
    expect(lastPlaceholderInput('Value')).toHaveValue('')

    // A genuinely different value must still resync and drop the draft.
    rerender(<MetadataEditor value={{ config: '{"enabled":false}' }} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getAllByPlaceholderText('Key')).toHaveLength(1)
  })

  it('preserves a blank draft row across an unrelated rerender when a stored key has surrounding whitespace', () => {
    const onChange = jest.fn()
    const baseValue = { ' spacedKey ': 'value' }
    const { rerender } = render(
      <MetadataEditor value={baseValue} onChange={onChange} defaultCollapsed={false} />,
    )
    addBlankDraftRowAndConsumeSkip(rerender, onChange, baseValue)
    expect(lastPlaceholderInput('Key')).toHaveValue('')
    expect(lastPlaceholderInput('Value')).toHaveValue('')

    // The stored key itself has surrounding whitespace and is unchanged —
    // the lookup must match it verbatim, not a trimmed version of it.
    rerender(<MetadataEditor value={{ ' spacedKey ': 'value' }} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getAllByPlaceholderText('Key')).toHaveLength(2)
    expect(lastPlaceholderInput('Key')).toHaveValue('')
    expect(lastPlaceholderInput('Value')).toHaveValue('')
  })

  it('preserves a blank draft row across an unrelated rerender when a stored key is itself whitespace-only', () => {
    const onChange = jest.fn()
    const baseValue = { ' ': 'legacy' }
    const { rerender } = render(
      <MetadataEditor value={baseValue} onChange={onChange} defaultCollapsed={false} />,
    )
    addBlankDraftRowAndConsumeSkip(rerender, onChange, baseValue)
    expect(lastPlaceholderInput('Key')).toHaveValue('')
    expect(lastPlaceholderInput('Value')).toHaveValue('')

    // The metadata schema allows a stored key that is itself whitespace-only
    // (`' '`); it must stay counted as committed, not discarded as a
    // draft-in-progress, or the comparison undercounts and wrongly wipes the
    // genuinely blank draft row added above.
    rerender(<MetadataEditor value={{ ' ': 'legacy' }} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getAllByPlaceholderText('Key')).toHaveLength(2)
    expect(lastPlaceholderInput('Key')).toHaveValue('')
    expect(lastPlaceholderInput('Value')).toHaveValue('')
  })

  it('renders without border in embedded mode', () => {
    const onChange = jest.fn()
    const { container } = render(
      <MetadataEditor value={{}} onChange={onChange} embedded={true} defaultCollapsed={false} />,
    )
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).not.toContain('border')
  })

  it('renders with border when not embedded', () => {
    const onChange = jest.fn()
    const { container } = render(
      <MetadataEditor value={{}} onChange={onChange} embedded={false} defaultCollapsed={false} />,
    )
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('border')
  })

  it('renders default title "Metadata"', () => {
    const onChange = jest.fn()
    render(<MetadataEditor value={{}} onChange={onChange} defaultCollapsed={false} />)
    expect(screen.getByText('Metadata')).toBeInTheDocument()
  })

  it('renders custom title when provided', () => {
    const onChange = jest.fn()
    render(
      <MetadataEditor value={{}} onChange={onChange} title="Custom Properties" defaultCollapsed={false} />,
    )
    expect(screen.getByText('Custom Properties')).toBeInTheDocument()
    expect(screen.queryByText('Metadata')).not.toBeInTheDocument()
  })
})
