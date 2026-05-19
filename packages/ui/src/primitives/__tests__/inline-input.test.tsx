/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { InlineInput } from '../inline-input'

describe('InlineInput primitive', () => {
  it('renders an input element', () => {
    render(<InlineInput placeholder="Edit value" />)
    expect(screen.getByPlaceholderText('Edit value')).toBeInTheDocument()
  })

  it('renders without a visible border at rest (border-transparent + bg-transparent)', () => {
    const { container } = render(<InlineInput value="hello" onChange={() => {}} />)
    const wrapper = container.querySelector('[data-slot="input-wrapper"]')
    expect(wrapper).toHaveClass('border-transparent')
    expect(wrapper).toHaveClass('bg-transparent')
    expect(wrapper).toHaveClass('shadow-none')
  })

  it('reveals a hover border by default', () => {
    const { container } = render(<InlineInput value="x" onChange={() => {}} />)
    const wrapper = container.querySelector('[data-slot="input-wrapper"]')
    expect(wrapper).toHaveClass('hover:border-input')
  })

  it('omits the hover border when showBorderOnHover is false', () => {
    const { container } = render(
      <InlineInput value="x" onChange={() => {}} showBorderOnHover={false} />,
    )
    const wrapper = container.querySelector('[data-slot="input-wrapper"]')
    expect(wrapper).not.toHaveClass('hover:border-input')
    expect(wrapper).toHaveClass('hover:bg-transparent')
  })

  it('defaults to the sm size (h-8)', () => {
    const { container } = render(<InlineInput value="x" onChange={() => {}} />)
    const wrapper = container.querySelector('[data-slot="input-wrapper"]')
    expect(wrapper).toHaveClass('h-8')
  })

  it('supports size="default" (h-9)', () => {
    const { container } = render(
      <InlineInput value="x" onChange={() => {}} size="default" />,
    )
    const wrapper = container.querySelector('[data-slot="input-wrapper"]')
    expect(wrapper).toHaveClass('h-9')
  })

  it('forwards value / onChange like a regular Input', () => {
    const onChange = jest.fn()
    render(<InlineInput value="hello" onChange={onChange} />)
    const input = screen.getByDisplayValue('hello') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'world' } })
    expect(onChange).toHaveBeenCalled()
  })

  it('forwards onBlur for save-on-blur consumer flows', () => {
    const onBlur = jest.fn()
    render(<InlineInput value="hello" onChange={() => {}} onBlur={onBlur} />)
    const input = screen.getByDisplayValue('hello')
    fireEvent.blur(input)
    expect(onBlur).toHaveBeenCalled()
  })

  it('forwards refs to the underlying input element', () => {
    const ref = React.createRef<HTMLInputElement>()
    render(<InlineInput ref={ref} value="hello" onChange={() => {}} />)
    expect(ref.current).not.toBeNull()
    expect(ref.current?.tagName).toBe('INPUT')
  })

  it('merges consumer className alongside the borderless baseline', () => {
    const { container } = render(
      <InlineInput value="x" onChange={() => {}} className="text-right font-mono" />,
    )
    const wrapper = container.querySelector('[data-slot="input-wrapper"]')
    expect(wrapper).toHaveClass('text-right')
    expect(wrapper).toHaveClass('font-mono')
    expect(wrapper).toHaveClass('border-transparent')
  })

  it('renders aria-invalid via the underlying Input wrapper', () => {
    const { container } = render(
      <InlineInput value="x" onChange={() => {}} aria-invalid />,
    )
    const input = container.querySelector('input')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('honors a custom input type', () => {
    const { container } = render(
      <InlineInput value="user@example.com" onChange={() => {}} type="email" />,
    )
    const input = container.querySelector('input')
    expect(input).toHaveAttribute('type', 'email')
  })
})
