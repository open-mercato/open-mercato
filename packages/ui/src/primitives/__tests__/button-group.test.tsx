/** @jest-environment jsdom */

import * as React from 'react'
import { render } from '@testing-library/react'
import { ButtonGroup, buttonGroupVariants } from '../button-group'

describe('ButtonGroup', () => {
  it('renders all children inside a role="group" wrapper', () => {
    const { container, getByText } = render(
      <ButtonGroup>
        <button type="button">One</button>
        <button type="button">Two</button>
        <button type="button">Three</button>
      </ButtonGroup>,
    )
    expect(getByText('One')).toBeInTheDocument()
    expect(getByText('Two')).toBeInTheDocument()
    expect(getByText('Three')).toBeInTheDocument()
    const wrapper = container.querySelector('[data-slot="button-group"]')
    expect(wrapper).not.toBeNull()
    expect(wrapper?.getAttribute('role')).toBe('group')
    expect(wrapper?.children.length).toBe(3)
  })

  it('applies horizontal flex-row layout by default', () => {
    const { container } = render(
      <ButtonGroup>
        <button type="button">A</button>
        <button type="button">B</button>
      </ButtonGroup>,
    )
    const wrapper = container.querySelector('[data-slot="button-group"]') as HTMLElement
    expect(wrapper.className).toContain('flex-row')
    expect(wrapper.className).toContain('rounded-md')
    expect(wrapper.className).not.toContain('flex-col')
  })

  it('applies vertical flex-col layout when orientation="vertical"', () => {
    const { container } = render(
      <ButtonGroup orientation="vertical">
        <button type="button">Up</button>
        <button type="button">Down</button>
      </ButtonGroup>,
    )
    const wrapper = container.querySelector('[data-slot="button-group"]') as HTMLElement
    expect(wrapper.className).toContain('flex-col')
    expect(wrapper.className).not.toContain('flex-row')
  })

  it('maps size="2xs" to rounded-sm per Figma 2X-Small (24) cornerRadius 6', () => {
    const { container } = render(
      <ButtonGroup size="2xs">
        <button type="button">A</button>
      </ButtonGroup>,
    )
    const wrapper = container.querySelector('[data-slot="button-group"]') as HTMLElement
    expect(wrapper.className).toContain('rounded-sm')
    expect(wrapper.className).not.toMatch(/\brounded-md\b/)
  })

  it('maps size="sm" and size="default" to rounded-md', () => {
    const small = render(
      <ButtonGroup size="sm">
        <button type="button">A</button>
      </ButtonGroup>,
    )
    expect(small.container.querySelector('[data-slot="button-group"]')?.className).toContain('rounded-md')

    const def = render(
      <ButtonGroup size="default">
        <button type="button">A</button>
      </ButtonGroup>,
    )
    expect(def.container.querySelector('[data-slot="button-group"]')?.className).toContain('rounded-md')
  })

  it('forwards className to the wrapper without dropping variant classes', () => {
    const { container } = render(
      <ButtonGroup className="custom-class">
        <button type="button">A</button>
      </ButtonGroup>,
    )
    const wrapper = container.querySelector('[data-slot="button-group"]') as HTMLElement
    expect(wrapper.className).toContain('custom-class')
    expect(wrapper.className).toContain('rounded-md')
    expect(wrapper.className).toContain('border')
  })

  it('forwards ref to the wrapper element', () => {
    const ref = React.createRef<HTMLDivElement>()
    render(
      <ButtonGroup ref={ref}>
        <button type="button">A</button>
      </ButtonGroup>,
    )
    expect(ref.current).not.toBeNull()
    expect(ref.current?.getAttribute('data-slot')).toBe('button-group')
  })

  it('forwards aria-label to the wrapper for screen-reader context', () => {
    const { container } = render(
      <ButtonGroup aria-label="View mode">
        <button type="button">List</button>
        <button type="button">Grid</button>
      </ButtonGroup>,
    )
    const wrapper = container.querySelector('[data-slot="button-group"]') as HTMLElement
    expect(wrapper.getAttribute('aria-label')).toBe('View mode')
  })

  it('exposes the buttonGroupVariants cva helper for reuse', () => {
    expect(typeof buttonGroupVariants).toBe('function')
    expect(buttonGroupVariants({ orientation: 'horizontal', size: 'default' })).toContain('rounded-md')
    expect(buttonGroupVariants({ orientation: 'vertical', size: '2xs' })).toContain('flex-col')
    expect(buttonGroupVariants({ orientation: 'vertical', size: '2xs' })).toContain('rounded-sm')
  })
})
