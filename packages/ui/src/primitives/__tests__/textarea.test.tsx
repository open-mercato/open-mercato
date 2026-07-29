import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Textarea } from '../textarea'

function stubScrollHeight(element: HTMLElement, value: number) {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value })
}

describe('Textarea', () => {
  it('keeps the manual resize handle when autoResize is off', () => {
    render(<Textarea aria-label="notes" />)
    const field = screen.getByLabelText('notes')
    expect(field.className).toContain('resize-y')
    expect(field.className).not.toContain('resize-none')
  })

  it('drops the manual resize handle when autoResize is on', () => {
    render(<Textarea aria-label="notes" autoResize />)
    const field = screen.getByLabelText('notes')
    expect(field.className).toContain('resize-none')
  })

  it('forwards the ref while owning the element internally', () => {
    const ref = React.createRef<HTMLTextAreaElement>()
    render(<Textarea aria-label="notes" autoResize ref={ref} />)
    expect(ref.current).toBe(screen.getByLabelText('notes'))
  })

  it('grows to fit content and stops scrolling below the row cap', () => {
    render(<Textarea aria-label="notes" autoResize maxRows={4} defaultValue="" />)
    const field = screen.getByLabelText('notes') as HTMLTextAreaElement
    stubScrollHeight(field, 60)
    fireEvent.change(field, { target: { value: 'two\nlines' } })
    expect(field.style.overflowY).toBe('hidden')
    expect(field.style.height).not.toBe('auto')
  })

  it('scrolls once the content exceeds the row cap', () => {
    render(<Textarea aria-label="notes" autoResize maxRows={2} defaultValue="" />)
    const field = screen.getByLabelText('notes') as HTMLTextAreaElement
    stubScrollHeight(field, 4000)
    fireEvent.change(field, { target: { value: 'a'.repeat(4000) } })
    expect(field.style.overflowY).toBe('auto')
  })

  it('still renders the character counter', () => {
    render(<Textarea aria-label="notes" autoResize showCount maxLength={10} defaultValue="abc" />)
    expect(screen.getByText('3/10')).toBeInTheDocument()
  })
})
