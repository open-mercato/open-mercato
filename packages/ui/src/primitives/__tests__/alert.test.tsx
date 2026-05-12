/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Alert, AlertDescription, AlertTitle } from '../alert'

describe('Alert primitive', () => {
  it('renders with role="alert"', () => {
    render(<Alert>Hello</Alert>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('defaults to status="information" + style="light" + size="sm"', () => {
    const { container } = render(<Alert>Body</Alert>)
    const alert = container.querySelector('[data-slot="alert"]')
    expect(alert).toHaveAttribute('data-status', 'information')
    expect(alert).toHaveAttribute('data-style', 'light')
    expect(alert).toHaveClass('min-h-9')
    expect(alert).toHaveClass('rounded-lg')
  })

  describe('Figma tokens — status × style matrix', () => {
    it('error / filled: bg-status-error-icon + text-white', () => {
      const { container } = render(<Alert status="error" style="filled">Oops</Alert>)
      const alert = container.querySelector('[data-slot="alert"]')
      expect(alert).toHaveClass('bg-status-error-icon')
      expect(alert).toHaveClass('text-white')
    })

    it('error / light: bg-status-error-border + text-status-error-text (Figma #fecaca)', () => {
      const { container } = render(<Alert status="error" style="light">Oops</Alert>)
      const alert = container.querySelector('[data-slot="alert"]')
      expect(alert).toHaveClass('bg-status-error-border')
      expect(alert).toHaveClass('text-foreground')
    })

    it('error / lighter: bg-status-error-bg + text-status-error-text (Figma #fef2f2)', () => {
      const { container } = render(<Alert status="error" style="lighter">Oops</Alert>)
      const alert = container.querySelector('[data-slot="alert"]')
      expect(alert).toHaveClass('bg-status-error-bg')
      expect(alert).toHaveClass('text-foreground')
    })

    it('stroke style: bg-background + text-foreground + border-border + shadow-lg', () => {
      const { container } = render(<Alert status="warning" style="stroke">Heads up</Alert>)
      const alert = container.querySelector('[data-slot="alert"]')
      expect(alert).toHaveClass('bg-background')
      expect(alert).toHaveClass('text-foreground')
      expect(alert).toHaveClass('border-border')
      expect(alert).toHaveClass('shadow-lg')
    })

    it('feature status maps to status-neutral tokens (NOT brand-violet)', () => {
      const { container } = render(<Alert status="feature" style="light">New release</Alert>)
      const alert = container.querySelector('[data-slot="alert"]')
      expect(alert).toHaveClass('bg-status-neutral-border')
      expect(alert).toHaveClass('text-foreground')
      expect(alert).not.toHaveClass('bg-brand-violet')
    })

    it('feature / filled: bg-status-neutral-icon + text-white', () => {
      const { container } = render(<Alert status="feature" style="filled">Hi</Alert>)
      const alert = container.querySelector('[data-slot="alert"]')
      expect(alert).toHaveClass('bg-status-neutral-icon')
      expect(alert).toHaveClass('text-white')
    })
  })

  describe('Sizes', () => {
    it('size="xs" applies min-h-8 + rounded-lg + text-xs', () => {
      const { container } = render(<Alert size="xs">xs</Alert>)
      const alert = container.querySelector('[data-slot="alert"]')
      expect(alert).toHaveClass('min-h-8')
      expect(alert).toHaveClass('rounded-lg')
      expect(alert).toHaveClass('text-xs')
    })

    it('size="sm" applies min-h-9 + rounded-lg + text-sm (Figma Paragraph/Small)', () => {
      const { container } = render(<Alert size="sm">sm</Alert>)
      const alert = container.querySelector('[data-slot="alert"]')
      expect(alert).toHaveClass('min-h-9')
      expect(alert).toHaveClass('rounded-lg')
      expect(alert).toHaveClass('text-sm')
    })

    it('size="default" applies rounded-xl + larger padding + no min height', () => {
      const { container } = render(<Alert size="default">default</Alert>)
      const alert = container.querySelector('[data-slot="alert"]')
      expect(alert).toHaveClass('rounded-xl')
      expect(alert).toHaveClass('text-sm')
    })
  })

  describe('Icon badge (non-filled styles)', () => {
    it('renders a badge wrap with status-x-icon bg + white icon for light style', () => {
      const { container } = render(<Alert status="success" style="light">Saved</Alert>)
      const badge = container.querySelector('[data-slot="alert-icon-badge"]')
      expect(badge).not.toBeNull()
      expect(badge).toHaveAttribute('data-status', 'success')
      expect(badge).toHaveClass('bg-status-success-icon')
      expect(badge).toHaveClass('rounded-full')
      expect(badge).toHaveClass('text-white')
    })

    it('renders a badge wrap for lighter style too', () => {
      const { container } = render(<Alert status="information" style="lighter">FYI</Alert>)
      expect(container.querySelector('[data-slot="alert-icon-badge"]')).not.toBeNull()
    })

    it('renders a badge wrap for stroke style too', () => {
      const { container } = render(<Alert status="error" style="stroke">Oops</Alert>)
      expect(container.querySelector('[data-slot="alert-icon-badge"]')).not.toBeNull()
    })

    it('does NOT render a badge wrap for filled style — plain icon instead', () => {
      const { container } = render(<Alert status="error" style="filled">Oops</Alert>)
      expect(container.querySelector('[data-slot="alert-icon-badge"]')).toBeNull()
      expect(container.querySelector('[data-slot="alert-icon"]')).not.toBeNull()
    })

    it('hides the icon entirely when showIcon is false', () => {
      const { container } = render(
        <Alert status="success" showIcon={false}>Done</Alert>,
      )
      expect(container.querySelector('[data-slot="alert-icon-badge"]')).toBeNull()
      expect(container.querySelector('[data-slot="alert-icon"]')).toBeNull()
    })

    it('respects a custom icon override inside the badge', () => {
      const Custom = () => <svg data-testid="custom-icon" aria-hidden="true" />
      render(<Alert status="information" style="light" icon={<Custom />}>Info</Alert>)
      expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    })
  })

  describe('Action slot + dismiss', () => {
    it('renders an inline action slot to the right of the description', () => {
      render(
        <Alert action={<button data-testid="action-link">Undo</button>}>Saved</Alert>,
      )
      expect(screen.getByTestId('action-link')).toBeInTheDocument()
    })

    it('renders a dismiss button when dismissible is true', () => {
      render(<Alert dismissible onDismiss={() => {}}>Closable</Alert>)
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    })

    it('fires onDismiss when the dismiss button is clicked', () => {
      const onDismiss = jest.fn()
      render(<Alert dismissible onDismiss={onDismiss}>Closable</Alert>)
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(onDismiss).toHaveBeenCalledTimes(1)
    })

    it('honors a custom dismissAriaLabel for i18n', () => {
      render(
        <Alert dismissible onDismiss={() => {}} dismissAriaLabel="Zamknij">
          Closable
        </Alert>,
      )
      expect(screen.getByRole('button', { name: 'Zamknij' })).toBeInTheDocument()
    })
  })

  it('AlertTitle and AlertDescription compose inside the body slot', () => {
    render(
      <Alert status="success">
        <AlertTitle>Saved</AlertTitle>
        <AlertDescription>Your changes were saved.</AlertDescription>
      </Alert>,
    )
    expect(screen.getByText('Saved').tagName).toBe('H5')
    expect(screen.getByText('Your changes were saved.').tagName).toBe('P')
  })

  describe('legacy variant prop (BC)', () => {
    it('maps variant="destructive" to status="error" with the new light default', () => {
      const { container } = render(<Alert variant="destructive">Oops</Alert>)
      const alert = container.querySelector('[data-slot="alert"]')
      expect(alert).toHaveAttribute('data-status', 'error')
      expect(alert).toHaveAttribute('data-style', 'light')
      expect(alert).toHaveClass('bg-status-error-border')
      expect(alert).toHaveClass('text-foreground')
    })

    it('maps variant="info" to status="information"', () => {
      const { container } = render(<Alert variant="info">FYI</Alert>)
      expect(container.querySelector('[data-slot="alert"]')).toHaveAttribute('data-status', 'information')
    })

    it('maps variant="default" to status="information"', () => {
      const { container } = render(<Alert variant="default">Hello</Alert>)
      expect(container.querySelector('[data-slot="alert"]')).toHaveAttribute('data-status', 'information')
    })

    it('explicit status overrides the legacy variant prop', () => {
      const { container } = render(<Alert variant="destructive" status="success">Saved</Alert>)
      expect(container.querySelector('[data-slot="alert"]')).toHaveAttribute('data-status', 'success')
    })
  })
})
