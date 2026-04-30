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
})
