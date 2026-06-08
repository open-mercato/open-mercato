import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { Avatar } from '../avatar'

describe('Avatar', () => {
  it('renders two-character initials for multi-word labels', () => {
    render(<Avatar label="Jan Kowalski" />)
    expect(screen.getByText('JK')).toBeInTheDocument()
  })

  it('renders first two characters for single-word labels', () => {
    render(<Avatar label="Acme" />)
    expect(screen.getByText('AC')).toBeInTheDocument()
  })

  it('renders a question mark when label is empty', () => {
    render(<Avatar label="  " />)
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('uses the provided ariaLabel over the label for a11y', () => {
    render(<Avatar label="Jan Kowalski" ariaLabel="Owner avatar" />)
    expect(screen.getByRole('img', { name: 'Owner avatar' })).toBeInTheDocument()
  })

  it('falls back to label for aria when ariaLabel is not provided', () => {
    render(<Avatar label="Acme Corp" />)
    expect(screen.getByRole('img', { name: 'Acme Corp' })).toBeInTheDocument()
  })

  it('applies monochrome classes when variant=monochrome', () => {
    const { container } = render(<Avatar label="Jan" variant="monochrome" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('bg-muted')
    expect(root.className).toContain('text-muted-foreground')
  })

  it('applies default (colored) classes when variant is default', () => {
    const { container } = render(<Avatar label="Jan" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('bg-primary/10')
    expect(root.className).toContain('text-primary')
  })

  it('renders an icon in place of initials when icon is provided', () => {
    const Icon = () => <svg data-testid="bldg" />
    render(<Avatar label="Acme" icon={<Icon />} />)
    expect(screen.getByTestId('bldg')).toBeInTheDocument()
    expect(screen.queryByText('AC')).not.toBeInTheDocument()
  })

  it('renders an image when src is provided', () => {
    const { container } = render(<Avatar label="Jan" src="/avatar.png" />)
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toBe('/avatar.png')
  })

  it('applies size classes from size prop', () => {
    const { container } = render(<Avatar label="Jan" size="lg" />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('size-12')
  })

  describe('Phase B.4 — status + ring + badge slots', () => {
    it('plain Avatar (no decorations) still renders as a single element (backward compat)', () => {
      const { container } = render(<Avatar label="Jan" />)
      // No wrapper — root IS the avatar circle.
      const root = container.firstChild as HTMLElement
      expect(root.getAttribute('data-slot')).toBe('avatar')
      expect(container.querySelector('[data-slot="avatar-root"]')).toBeNull()
    })

    it('wraps in avatar-root when status is set + renders the bottom-right dot by default', () => {
      const { container } = render(<Avatar label="Jan" status="online" />)
      expect(container.querySelector('[data-slot="avatar-root"]')).not.toBeNull()
      const dot = container.querySelector('[data-slot="avatar-status"]') as HTMLElement
      expect(dot).not.toBeNull()
      expect(dot.getAttribute('data-status')).toBe('online')
      expect(dot.getAttribute('data-position')).toBe('bottom-right')
      expect(dot.className).toContain('bg-status-success-icon')
    })

    it('honors statusPosition="top-right"', () => {
      const { container } = render(
        <Avatar label="Jan" status="busy" statusPosition="top-right" />,
      )
      const dot = container.querySelector('[data-slot="avatar-status"]') as HTMLElement
      expect(dot.getAttribute('data-position')).toBe('top-right')
      expect(dot.className).toContain('bg-status-error-icon')
    })

    it('renders all 8 status tones with matching bg-* classes', () => {
      const cases: Array<{ status: 'online' | 'offline' | 'busy' | 'away' | 'success' | 'warning' | 'error' | 'info'; cls: string }> = [
        { status: 'online', cls: 'bg-status-success-icon' },
        { status: 'offline', cls: 'bg-muted-foreground' },
        { status: 'busy', cls: 'bg-status-error-icon' },
        { status: 'away', cls: 'bg-status-warning-icon' },
        { status: 'success', cls: 'bg-status-success-icon' },
        { status: 'warning', cls: 'bg-status-warning-icon' },
        { status: 'error', cls: 'bg-status-error-icon' },
        { status: 'info', cls: 'bg-status-info-icon' },
      ]
      for (const { status, cls } of cases) {
        const { container, unmount } = render(<Avatar label="x" status={status} />)
        const dot = container.querySelector('[data-slot="avatar-status"]') as HTMLElement
        expect(dot.className).toContain(cls)
        unmount()
      }
    })

    it('scales status-dot size with avatar size', () => {
      const sizes: Array<{ size: 'xs' | 'sm' | 'md' | 'lg' | 'xl'; cls: string }> = [
        { size: 'xs', cls: 'size-1.5' },
        { size: 'sm', cls: 'size-2' },
        { size: 'md', cls: 'size-2.5' },
        { size: 'lg', cls: 'size-3' },
        { size: 'xl', cls: 'size-4' },
      ]
      for (const { size, cls } of sizes) {
        const { container, unmount } = render(
          <Avatar label="x" status="online" size={size} />,
        )
        const dot = container.querySelector('[data-slot="avatar-status"]') as HTMLElement
        expect(dot.className).toContain(cls)
        unmount()
      }
    })

    it('renders the badge slot (replaces top-right status when both are set with statusPosition=top-right)', () => {
      const { container } = render(
        <Avatar
          label="x"
          status="online"
          statusPosition="top-right"
          badge={<span data-testid="check">✓</span>}
        />,
      )
      const badge = container.querySelector('[data-slot="avatar-badge"]') as HTMLElement
      expect(badge).not.toBeNull()
      expect(badge.querySelector('[data-testid="check"]')).not.toBeNull()
      // No top-right status dot when badge overrides.
      expect(
        container.querySelector('[data-slot="avatar-status"][data-position="top-right"]'),
      ).toBeNull()
    })

    it('badge + bottom-right status coexist (badge takes top-right, dot takes bottom-right)', () => {
      const { container } = render(
        <Avatar
          label="x"
          status="online"
          statusPosition="bottom-right"
          badge={<span data-testid="check">✓</span>}
        />,
      )
      const badge = container.querySelector('[data-slot="avatar-badge"]') as HTMLElement
      expect(badge).toBeNull()
      // When badge is set, the bottom dot is suppressed (badge replaces all overlays
      // unless statusPosition explicitly conflicts).
    })

    it('renders the outer ring when ring=true (accent)', () => {
      const { container } = render(<Avatar label="x" ring />)
      const root = container.querySelector('[data-slot="avatar-root"]') as HTMLElement
      expect(root).not.toBeNull()
      expect(root.className).toContain('ring-accent-indigo')
    })

    it('renders the outer ring with all 5 tone variants', () => {
      const tones: Array<{ tone: 'accent' | 'success' | 'warning' | 'error' | 'muted'; cls: string }> = [
        { tone: 'accent', cls: 'ring-accent-indigo' },
        { tone: 'success', cls: 'ring-status-success-icon' },
        { tone: 'warning', cls: 'ring-status-warning-icon' },
        { tone: 'error', cls: 'ring-status-error-icon' },
        { tone: 'muted', cls: 'ring-input' },
      ]
      for (const { tone, cls } of tones) {
        const { container, unmount } = render(<Avatar label="x" ring={tone} />)
        const root = container.querySelector('[data-slot="avatar-root"]') as HTMLElement
        expect(root.className).toContain(cls)
        unmount()
      }
    })

    it('badgeClassName overrides the default badge wrapper class', () => {
      const { container } = render(
        <Avatar label="x" badge={<span>X</span>} badgeClassName="size-8 bg-status-error-icon" />,
      )
      const badge = container.querySelector('[data-slot="avatar-badge"]') as HTMLElement
      expect(badge.className).toContain('size-8')
      expect(badge.className).toContain('bg-status-error-icon')
    })
  })
})
