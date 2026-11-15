/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { RatingBar, type RatingBarProps } from '../rating-bar'

function ControlledBar({ variant, disabled = false }: Pick<RatingBarProps, 'variant' | 'disabled'>) {
  const [value, setValue] = React.useState(0)
  return (
    <I18nProvider locale="en" dict={{}}>
      <RatingBar value={value} onChange={setValue} variant={variant} disabled={disabled} aria-label="Experience" />
    </I18nProvider>
  )
}

describe('RatingBar', () => {
  it.each(['emoji', 'number', 'star', 'heart'] as const)('offers five exclusive choices for %s', variant => {
    render(<ControlledBar variant={variant} />)
    expect(screen.getByRole('radiogroup', { name: 'Experience' })).toBeInTheDocument()
    const options = screen.getAllByRole('radio')
    expect(options).toHaveLength(5)
    expect(screen.queryByRole('radio', { checked: true })).toBeNull()
    fireEvent.click(options[3])
    expect(screen.getByRole('radio', { checked: true })).toBe(options[3])
    fireEvent.click(options[1])
    expect(screen.getByRole('radio', { checked: true })).toBe(options[1])
  })

  it('moves keyboard focus and selection together', async () => {
    render(<ControlledBar variant="number" />)
    const options = screen.getAllByRole('radio')
    act(() => options[0].focus())
    fireEvent.keyDown(options[0], { key: 'ArrowRight', code: 'ArrowRight' })
    await waitFor(() => expect(options[1]).toHaveFocus())
    expect(screen.getByRole('radio', { checked: true })).toBe(options[1])
    fireEvent.keyUp(options[1], { key: 'ArrowRight', code: 'ArrowRight' })
    fireEvent.keyDown(options[1], { key: 'ArrowLeft', code: 'ArrowLeft' })
    await waitFor(() => expect(options[0]).toHaveFocus())
    expect(screen.getByRole('radio', { checked: true })).toBe(options[0])
    fireEvent.keyUp(options[0], { key: 'ArrowLeft', code: 'ArrowLeft' })
  })

  it('blocks clicks and keyboard selection while disabled', async () => {
    render(<ControlledBar disabled />)
    const options = screen.getAllByRole('radio')
    expect(options.every(option => option.hasAttribute('disabled'))).toBe(true)
    fireEvent.click(options[3])
    fireEvent.keyDown(options[1], { key: 'ArrowRight', code: 'ArrowRight' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    fireEvent.keyUp(options[1], { key: 'ArrowRight', code: 'ArrowRight' })
    expect(screen.queryByRole('radio', { checked: true })).toBeNull()
  })

  it('embeds all five exported emoji without expiring remote image URLs', () => {
    const { container } = render(<ControlledBar variant="emoji" />)
    const images = Array.from(container.querySelectorAll('img'))
    expect(images).toHaveLength(5)
    expect(new Set(images.map(image => image.src)).size).toBe(5)
    images.forEach(image => {
      expect(image.src).toMatch(/^data:image\/png;base64,iVBOR/)
      expect(image.alt).toBe('')
    })
  })
})
