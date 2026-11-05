import { render } from '@testing-library/react'
import { Heart } from 'lucide-react'
import {
  resolveRegisteredLucideIcon,
  resolveRegisteredLucideIconNode,
  LUCIDE_ICON_REGISTRY,
  registerAdditionalIcons,
} from '../lucideRegistry'

describe('resolveRegisteredLucideIcon', () => {
  it('returns an icon component for a known kebab-case name', () => {
    const icon = resolveRegisteredLucideIcon('alert-circle')
    expect(icon).toBeTruthy()
    expect(typeof icon).toBe('object')
  })

  it('returns null for an unknown icon name', () => {
    expect(resolveRegisteredLucideIcon('nonexistent-icon-xyz')).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(resolveRegisteredLucideIcon(undefined)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(resolveRegisteredLucideIcon('')).toBeNull()
  })

  it('returns null for whitespace-only input', () => {
    expect(resolveRegisteredLucideIcon('   ')).toBeNull()
  })

  it('normalizes PascalCase to kebab-case for lookup', () => {
    const direct = resolveRegisteredLucideIcon('alert-circle')
    const pascal = resolveRegisteredLucideIcon('AlertCircle')
    expect(direct).toBeTruthy()
    expect(pascal).toBe(direct)
  })

  it('normalizes snake_case to kebab-case for lookup', () => {
    const direct = resolveRegisteredLucideIcon('alert-circle')
    const snake = resolveRegisteredLucideIcon('alert_circle')
    expect(direct).toBeTruthy()
    expect(snake).toBe(direct)
  })

  it('handles single-word names', () => {
    const icon = resolveRegisteredLucideIcon('bell')
    expect(icon).toBeTruthy()
  })

  it('handles names with numeric segments', () => {
    const icon = resolveRegisteredLucideIcon('bar-chart-2')
    expect(icon).toBeTruthy()
  })
})

describe('resolveRegisteredLucideIconNode', () => {
  it('returns a React node for a valid icon', () => {
    const node = resolveRegisteredLucideIconNode('bell', 'size-4')
    expect(node).not.toBeNull()
    const { container } = render(<>{node}</>)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('applies the className to the rendered icon', () => {
    const node = resolveRegisteredLucideIconNode('bell', 'custom-class')
    expect(node).not.toBeNull()
    const { container } = render(<>{node}</>)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class')).toContain('custom-class')
  })

  it('returns null for an unknown icon', () => {
    expect(resolveRegisteredLucideIconNode('nonexistent-xyz', 'size-4')).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(resolveRegisteredLucideIconNode(undefined, 'size-4')).toBeNull()
  })
})

describe('registerAdditionalIcons', () => {
  afterEach(() => {
    delete (LUCIDE_ICON_REGISTRY as Record<string, unknown>)['test-custom-icon']
  })

  it('adds new icons to the registry', () => {
    expect(resolveRegisteredLucideIcon('test-custom-icon')).toBeNull()

    registerAdditionalIcons({ 'test-custom-icon': Heart })

    const resolved = resolveRegisteredLucideIcon('test-custom-icon')
    expect(resolved).toBe(Heart)
  })

  it('makes registered icons available through resolveRegisteredLucideIconNode', () => {
    registerAdditionalIcons({ 'test-custom-icon': Heart })

    const node = resolveRegisteredLucideIconNode('test-custom-icon', 'size-4')
    expect(node).not.toBeNull()
    const { container } = render(<>{node}</>)
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
