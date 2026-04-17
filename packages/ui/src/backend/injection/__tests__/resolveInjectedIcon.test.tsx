import { render } from '@testing-library/react'
import { resolveInjectedIcon } from '../resolveInjectedIcon'

describe('resolveInjectedIcon', () => {
  it('returns a React node for a known icon', () => {
    const node = resolveInjectedIcon('bell')
    expect(node).not.toBeNull()
    const { container } = render(<>{node}</>)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('applies default className size-4', () => {
    const node = resolveInjectedIcon('bell')
    expect(node).not.toBeNull()
    const { container } = render(<>{node}</>)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class')).toContain('size-4')
  })

  it('applies a custom className', () => {
    const node = resolveInjectedIcon('bell', 'size-6')
    expect(node).not.toBeNull()
    const { container } = render(<>{node}</>)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class')).toContain('size-6')
  })

  it('returns null for undefined', () => {
    expect(resolveInjectedIcon(undefined)).toBeNull()
  })

  it('returns null for an unknown icon', () => {
    expect(resolveInjectedIcon('nonexistent-icon-xyz')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(resolveInjectedIcon('')).toBeNull()
  })
})
