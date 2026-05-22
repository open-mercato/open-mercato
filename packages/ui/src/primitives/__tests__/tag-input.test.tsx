/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { TagInput } from '../tag-input'

function Harness({
  initial,
  ...rest
}: {
  initial?: string[]
} & Omit<React.ComponentProps<typeof TagInput>, 'value' | 'onChange'>) {
  const [value, setValue] = React.useState<string[]>(initial ?? [])
  return <TagInput value={value} onChange={setValue} {...rest} />
}

function getInput(): HTMLInputElement {
  return screen.getByRole('textbox') as HTMLInputElement
}

describe('TagInput primitive', () => {
  it('adds a tag on Enter', () => {
    render(<Harness aria-label="tags" />)
    const input = getInput()
    fireEvent.change(input, { target: { value: 'alpha' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('alpha')).toBeInTheDocument()
    expect(input.value).toBe('')
  })

  it('adds a tag when separator (",") is typed', () => {
    render(<Harness aria-label="tags" />)
    const input = getInput()
    fireEvent.change(input, { target: { value: 'beta,' } })
    expect(screen.getByText('beta')).toBeInTheDocument()
    expect(input.value).toBe('')
  })

  it('splits multiple tags on bulk paste with separator', () => {
    render(<Harness aria-label="tags" />)
    const input = getInput()
    fireEvent.change(input, { target: { value: 'a,b,c,' } })
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
    expect(screen.getByText('c')).toBeInTheDocument()
    expect(input.value).toBe('')
  })

  it('removes the last tag on Backspace when input is empty', () => {
    render(<Harness initial={['x', 'y']} aria-label="tags" />)
    const input = getInput()
    expect(screen.getByText('y')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(screen.queryByText('y')).not.toBeInTheDocument()
    expect(screen.getByText('x')).toBeInTheDocument()
  })

  it('does not remove a tag on Backspace when input has content', () => {
    render(<Harness initial={['keep']} aria-label="tags" />)
    const input = getInput()
    fireEvent.change(input, { target: { value: 'typing' } })
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(screen.getByText('keep')).toBeInTheDocument()
  })

  it('removes a tag when its × button is clicked', () => {
    render(<Harness initial={['removeMe', 'stay']} aria-label="tags" />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove removeMe' }))
    expect(screen.queryByText('removeMe')).not.toBeInTheDocument()
    expect(screen.getByText('stay')).toBeInTheDocument()
  })

  it('blocks further additions when maxTags is reached', () => {
    render(<Harness initial={['a', 'b']} maxTags={2} aria-label="tags" />)
    const input = getInput()
    expect(input).toBeDisabled()
    fireEvent.change(input, { target: { value: 'c' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByText('c')).not.toBeInTheDocument()
  })

  it('rejects silently when validate returns false', () => {
    const validate = (tag: string) => tag !== 'bad'
    render(<Harness validate={validate} aria-label="tags" />)
    const input = getInput()
    fireEvent.change(input, { target: { value: 'bad' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByText('bad')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows error message when validate returns a string', () => {
    const validate = (tag: string) =>
      tag.length < 3 ? 'Tag must be at least 3 characters' : true
    render(<Harness validate={validate} aria-label="tags" />)
    const input = getInput()
    fireEvent.change(input, { target: { value: 'ab' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.queryByText('ab')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Tag must be at least 3 characters')
  })

  it('clears error after typing again', () => {
    const validate = (tag: string) =>
      tag.length < 3 ? 'Too short' : true
    render(<Harness validate={validate} aria-label="tags" />)
    const input = getInput()
    fireEvent.change(input, { target: { value: 'ab' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('skips duplicate tags silently when allowDuplicates is false', () => {
    render(<Harness initial={['dup']} aria-label="tags" />)
    const input = getInput()
    fireEvent.change(input, { target: { value: 'dup' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const matches = screen.getAllByText('dup')
    expect(matches.length).toBe(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('allows duplicates when allowDuplicates is true', () => {
    render(<Harness initial={['dup']} allowDuplicates aria-label="tags" />)
    const input = getInput()
    fireEvent.change(input, { target: { value: 'dup' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getAllByText('dup').length).toBe(2)
  })

  it('supports a custom RegExp separator', () => {
    render(<Harness separator={/[,\s]/} aria-label="tags" />)
    const input = getInput()
    fireEvent.change(input, { target: { value: 'a b,' } })
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
    expect(input.value).toBe('')
  })

  it('renders placeholder when empty', () => {
    render(<Harness placeholder="Add tag..." aria-label="tags" />)
    expect(getInput()).toHaveAttribute('placeholder', 'Add tag...')
  })

  it('keeps placeholder visible even with existing tags (Figma two-row layout)', () => {
    render(<Harness initial={['one']} placeholder="Add tag..." aria-label="tags" />)
    expect(getInput()).toHaveAttribute('placeholder', 'Add tag...')
  })

  it('renders chips below the input row (two-row layout)', () => {
    const { container } = render(<Harness initial={['a', 'b']} aria-label="tags" />)
    const root = container.querySelector('[data-slot="tag-input"]')
    expect(root).not.toBeNull()
    const inputField = root!.querySelector('[data-slot="tag-input-field"]')
    const chips = root!.querySelector('[data-slot="tag-input-chips"]')
    expect(inputField).not.toBeNull()
    expect(chips).not.toBeNull()
    const inputIndex = Array.from(root!.children).indexOf(inputField!.closest('[data-slot="input-wrapper"]')!)
    const chipsIndex = Array.from(root!.children).indexOf(chips!)
    expect(inputIndex).toBeLessThan(chipsIndex)
  })

  it('renders chips with shape="square" (Figma rectangular tag)', () => {
    const { container } = render(<Harness initial={['x']} aria-label="tags" />)
    const chip = container.querySelector('[data-slot="tag"][data-shape="square"]')
    expect(chip).not.toBeNull()
  })

  it('supports lg size matching Figma Medium (40)', () => {
    render(<Harness size="lg" aria-label="tags" />)
    expect(getInput().closest('[data-slot="input-wrapper"]')!.className).toContain('h-10')
  })

  it('forwards id and name to underlying input', () => {
    render(<Harness id="tags-field" name="tags[]" aria-label="tags" />)
    const input = getInput()
    expect(input).toHaveAttribute('id', 'tags-field')
    expect(input).toHaveAttribute('name', 'tags[]')
  })

  it('disables input and remove buttons when disabled prop is true', () => {
    render(<Harness initial={['locked']} disabled aria-label="tags" />)
    expect(getInput()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove locked' })).toBeDisabled()
  })

  it('works in uncontrolled mode (no value/onChange props)', () => {
    render(<TagInput aria-label="tags" />)
    const input = getInput()
    fireEvent.change(input, { target: { value: 'standalone' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('standalone')).toBeInTheDocument()
  })
})
