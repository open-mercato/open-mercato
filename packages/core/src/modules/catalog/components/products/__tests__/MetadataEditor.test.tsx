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
