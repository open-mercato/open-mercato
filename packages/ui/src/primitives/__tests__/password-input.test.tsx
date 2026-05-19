/** @jest-environment jsdom */

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { PasswordInput } from '../password-input'

describe('PasswordInput primitive', () => {
  it('renders the inner input as type="password" by default', () => {
    const { container } = render(<PasswordInput defaultValue="secret" />)
    const input = container.querySelector('input') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.type).toBe('password')
  })

  it('toggles the input type when the reveal button is clicked', () => {
    const { container } = render(<PasswordInput defaultValue="secret" />)
    const input = container.querySelector('input') as HTMLInputElement
    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(input.type).toBe('password')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(toggle)

    expect(input.type).toBe('text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('respects the controlled reveal state via revealed prop', () => {
    const onRevealedChange = jest.fn()
    const { container, rerender } = render(
      <PasswordInput defaultValue="secret" revealed={false} onRevealedChange={onRevealedChange} />,
    )
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.type).toBe('password')

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(onRevealedChange).toHaveBeenCalledWith(true)
    expect(input.type).toBe('password')

    rerender(<PasswordInput defaultValue="secret" revealed onRevealedChange={onRevealedChange} />)
    expect(input.type).toBe('text')
  })

  it('hides the reveal toggle when revealable is false', () => {
    render(<PasswordInput defaultValue="secret" revealable={false} />)
    expect(screen.queryByRole('button', { name: /show password|hide password/i })).toBeNull()
  })

  it('hides the leading lock icon when showLockIcon is false', () => {
    const { container } = render(<PasswordInput showLockIcon={false} defaultValue="secret" />)
    expect(container.querySelector('svg.lucide-lock')).toBeNull()
  })

  it('forwards consumer-supplied autoComplete to the input element', () => {
    const { container } = render(
      <PasswordInput defaultValue="secret" autoComplete="new-password" />,
    )
    const input = container.querySelector('input') as HTMLInputElement
    expect(input).toHaveAttribute('autocomplete', 'new-password')
  })

  it('does not set autoComplete when the consumer omits it (lets browser heuristics decide)', () => {
    const { container } = render(<PasswordInput defaultValue="secret" />)
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.getAttribute('autocomplete')).toBeNull()
  })

  it('forwards name and id to the input element', () => {
    const { container } = render(<PasswordInput id="signup-password" name="password" />)
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.id).toBe('signup-password')
    expect(input.name).toBe('password')
  })

  it('disables both the input and the reveal toggle when disabled', () => {
    const { container } = render(<PasswordInput defaultValue="secret" disabled />)
    const input = container.querySelector('input') as HTMLInputElement
    const toggle = screen.getByRole('button', { name: 'Show password' }) as HTMLButtonElement
    expect(input.disabled).toBe(true)
    expect(toggle.disabled).toBe(true)
  })

  it('forwards refs to the underlying input element', () => {
    const ref = React.createRef<HTMLInputElement>()
    render(<PasswordInput ref={ref} defaultValue="secret" />)
    expect(ref.current).not.toBeNull()
    expect(ref.current?.tagName).toBe('INPUT')
  })
})
