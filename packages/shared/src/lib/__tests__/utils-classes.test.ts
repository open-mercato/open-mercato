import { cn } from '../utils'

describe('DS class merging', () => {
  it('preserves the overline size alongside a semantic text color', () => {
    expect(cn('text-overline leading-3', 'text-badge-purple-text')).toBe('text-overline leading-3 text-badge-purple-text')
    expect(cn('text-muted-foreground', 'text-overline')).toBe('text-muted-foreground text-overline')
  })

  it('lets later font sizes and colors override only their own groups', () => {
    expect(cn('text-sm text-foreground', 'text-overline text-muted-foreground')).toBe('text-overline text-muted-foreground')
    expect(cn('text-overline text-muted-foreground', 'text-sm')).toBe('text-muted-foreground text-sm')
    expect(cn('md:text-overline md:text-foreground', 'md:text-sm')).toBe('md:text-foreground md:text-sm')
  })

  it('retains conditional and ordinary layout merging', () => {
    expect(cn(['px-2', false, 'py-1'], { 'text-overline': true }, 'px-4')).toBe('py-1 text-overline px-4')
  })

  it.each(['compact', 'title-4', 'ai-body'])('retains the %s source type scale with semantic colors', size => {
    expect(cn('text-sm text-muted-foreground', `text-${size}`)).toBe(`text-muted-foreground text-${size}`)
    expect(cn(`text-${size}`, 'text-status-success-text')).toBe(`text-${size} text-status-success-text`)
  })

  it('lets source radii override inherited primitive radii in both directions', () => {
    expect(cn('rounded-md border border-border', 'rounded-ai-control')).toBe('border border-border rounded-ai-control')
    expect(cn('rounded-ai-prompt', 'rounded-none')).toBe('rounded-none')
    expect(cn('rounded-md', 'rounded-content-card')).toBe('rounded-content-card')
    expect(cn('rounded-ai-prompt', 'rounded-t-ai-prompt-inner')).toBe('rounded-ai-prompt rounded-t-ai-prompt-inner')
  })
})
