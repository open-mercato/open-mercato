import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { SocialButton } from '../social-button'

describe('SocialButton', () => {
  it.each(['apple', 'github', 'x', 'google', 'facebook', 'dropbox', 'linkedin'] as const)(
    'uses theme-aware text and border roles for the %s stroke button', (brand) => {
      render(<SocialButton brand={brand} appearance="stroke">Continue</SocialButton>)
      const button = screen.getByRole('button', { name: 'Continue' })
      expect(button).toHaveClass('text-foreground', 'border-input', 'bg-background', 'h-10', 'rounded-lg')
      expect(button.className).not.toContain(`text-brand-${brand}`)
    },
  )

  it('keeps the white Google source mark visible on its filled brand surface', () => {
    render(<SocialButton brand="google">Continue with Google</SocialButton>)
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toHaveClass('bg-brand-google-text-bg', 'text-white')
  })

  it('keeps filled as the default and retains accessible icon-only content', () => {
    render(<SocialButton brand="github" iconOnly aria-label="Continue with GitHub"><svg aria-hidden="true" /></SocialButton>)
    const button = screen.getByRole('button', { name: 'Continue with GitHub' })
    expect(button).toHaveAttribute('data-appearance', 'filled')
    expect(button).toHaveClass('h-10', 'w-10', 'px-0', 'bg-brand-github')
  })
})
