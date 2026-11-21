import { cn } from '../lib/cn'

describe('cn', () => {
  it('keeps a storefront text size next to a text colour', () => {
    expect(cn('text-primary-foreground', 'text-sf-body')).toBe('text-primary-foreground text-sf-body')
    expect(cn('text-sf-body', 'text-sf-body-sm')).toBe('text-sf-body-sm')
  })

  it('merges storefront radii and control sizes as the same groups', () => {
    expect(cn('rounded-sf-button', 'rounded-sf-chip')).toBe('rounded-sf-chip')
    expect(cn('h-sf-md', 'h-sf-lg')).toBe('h-sf-lg')
    expect(cn('rounded-sf-field', 'rounded-full')).toBe('rounded-full')
  })

  it('does not confuse focus shadows with elevation', () => {
    expect(cn('shadow-xs', 'focus-visible:shadow-focus')).toBe('shadow-xs focus-visible:shadow-focus')
  })
})
