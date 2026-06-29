/** @jest-environment jsdom */

import * as React from 'react'
import { render as rtlRender, fireEvent } from '@testing-library/react'
import { Rating } from '../rating'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

// Rating uses useT() for read-only summary + item aria-labels.
// Wrap every render in an empty-dict I18nProvider so the primitive
// falls back to its English fallbacks without real translations.
const render: typeof rtlRender = (ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(
    <I18nProvider locale="en" dict={{}}>
      {ui}
    </I18nProvider>,
    options,
  )

describe('Rating', () => {
  describe('read-only mode (no onChange)', () => {
    it('renders role="img" with aria-label "{value} out of {max}" by default', () => {
      const { getByRole } = render(<Rating value={3} max={5} />)
      const node = getByRole('img')
      expect(node.getAttribute('aria-label')).toBe('3 out of 5')
    })

    it('honors a custom aria-label', () => {
      const { getByRole } = render(<Rating value={4} max={5} aria-label="Average review score" />)
      expect(getByRole('img').getAttribute('aria-label')).toBe('Average review score')
    })

    it('renders max items, marking the first `value` as filled', () => {
      const { container } = render(<Rating value={3} max={5} />)
      const items = container.querySelectorAll('[data-slot="rating-item"]')
      expect(items.length).toBe(5)
      expect(items[0].getAttribute('data-fill')).toBe('full')
      expect(items[1].getAttribute('data-fill')).toBe('full')
      expect(items[2].getAttribute('data-fill')).toBe('full')
      expect(items[3].getAttribute('data-fill')).toBe('empty')
      expect(items[4].getAttribute('data-fill')).toBe('empty')
    })

    it('does NOT render buttons when no onChange is provided', () => {
      const { container } = render(<Rating value={3} max={5} />)
      expect(container.querySelector('button')).toBeNull()
    })

    it('renders a half-fill state when allowHalf and value falls between integers', () => {
      const { container } = render(<Rating value={3.5} max={5} allowHalf />)
      const items = container.querySelectorAll('[data-slot="rating-item"]')
      expect(items[2].getAttribute('data-fill')).toBe('full')
      expect(items[3].getAttribute('data-fill')).toBe('half')
      expect(items[4].getAttribute('data-fill')).toBe('empty')
    })

    it('treats half values as full when allowHalf is false (default)', () => {
      const { container } = render(<Rating value={3.5} max={5} />)
      const items = container.querySelectorAll('[data-slot="rating-item"]')
      // 3.5 with allowHalf=false → first 3 full, 4th is empty (cannot half)
      expect(items[2].getAttribute('data-fill')).toBe('full')
      expect(items[3].getAttribute('data-fill')).toBe('empty')
    })
  })

  describe('interactive mode (onChange provided)', () => {
    it('renders role="radiogroup" with N role="radio" buttons', () => {
      const { getByRole, getAllByRole } = render(
        <Rating value={2} max={5} onChange={() => {}} aria-label="Rate" />,
      )
      expect(getByRole('radiogroup', { name: 'Rate' })).toBeInTheDocument()
      expect(getAllByRole('radio').length).toBe(5)
    })

    it('fires onChange with (index + 1) on full-click without allowHalf', () => {
      const onChange = jest.fn()
      const { getAllByRole } = render(
        <Rating value={0} max={5} onChange={onChange} aria-label="Rate" />,
      )
      fireEvent.click(getAllByRole('radio')[2])
      expect(onChange).toHaveBeenCalledWith(3)
    })

    it('does not fire onChange when disabled', () => {
      const onChange = jest.fn()
      const { getAllByRole } = render(
        <Rating value={0} max={5} onChange={onChange} disabled aria-label="Rate" />,
      )
      fireEvent.click(getAllByRole('radio')[3])
      expect(onChange).not.toHaveBeenCalled()
    })

    it('marks aria-checked on items that are filled (full or half)', () => {
      const { getAllByRole } = render(
        <Rating value={2.5} max={5} onChange={() => {}} allowHalf aria-label="Rate" />,
      )
      const items = getAllByRole('radio')
      expect(items[0].getAttribute('aria-checked')).toBe('true')
      expect(items[1].getAttribute('aria-checked')).toBe('true')
      expect(items[2].getAttribute('aria-checked')).toBe('true') // half counts as checked
      expect(items[3].getAttribute('aria-checked')).toBe('false')
    })

    it('moves the value with ArrowRight / ArrowLeft keys', () => {
      const onChange = jest.fn()
      const { getAllByRole } = render(
        <Rating value={2} max={5} onChange={onChange} aria-label="Rate" />,
      )
      fireEvent.keyDown(getAllByRole('radio')[1], { key: 'ArrowRight' })
      expect(onChange).toHaveBeenLastCalledWith(3)
      fireEvent.keyDown(getAllByRole('radio')[1], { key: 'ArrowLeft' })
      expect(onChange).toHaveBeenLastCalledWith(1)
    })

    it('Home / End keys snap to the first / last position', () => {
      const onChange = jest.fn()
      const { getAllByRole } = render(
        <Rating value={3} max={5} onChange={onChange} aria-label="Rate" />,
      )
      fireEvent.keyDown(getAllByRole('radio')[2], { key: 'Home' })
      expect(onChange).toHaveBeenLastCalledWith(1)
      fireEvent.keyDown(getAllByRole('radio')[2], { key: 'End' })
      expect(onChange).toHaveBeenLastCalledWith(5)
    })

    it('keyboard step with allowHalf is 0.5', () => {
      const onChange = jest.fn()
      const { getAllByRole } = render(
        <Rating value={2} max={5} onChange={onChange} allowHalf aria-label="Rate" />,
      )
      fireEvent.keyDown(getAllByRole('radio')[1], { key: 'ArrowRight' })
      expect(onChange).toHaveBeenLastCalledWith(2.5)
    })

    it('clamps keyboard moves at 0 and max', () => {
      const onChange = jest.fn()
      const { getAllByRole } = render(
        <Rating value={0} max={5} onChange={onChange} aria-label="Rate" />,
      )
      fireEvent.keyDown(getAllByRole('radio')[0], { key: 'ArrowLeft' })
      expect(onChange).toHaveBeenLastCalledWith(0)
    })
  })

  describe('shape & sizing', () => {
    it('applies default size (size-5 via [&>*]:size-5) when size prop omitted', () => {
      const { container } = render(<Rating value={1} max={3} />)
      const root = container.querySelector('[data-slot="rating"]') as HTMLElement
      expect(root.className).toContain('size-5')
    })

    it('applies sm and lg size classes', () => {
      const small = render(<Rating value={1} max={3} size="sm" />)
      expect(small.container.querySelector('[data-slot="rating"]')?.className).toContain('size-4')
      const large = render(<Rating value={1} max={3} size="lg" />)
      expect(large.container.querySelector('[data-slot="rating"]')?.className).toContain('size-6')
    })

    it('forwards ref to the root element', () => {
      const ref = React.createRef<HTMLSpanElement>()
      render(<Rating ref={ref} value={1} max={3} />)
      expect(ref.current?.getAttribute('data-slot')).toBe('rating')
    })
  })
})
