import { sectionPropsSchema } from '../section'

const noop = () => undefined
const base = { title: 'Delivery addresses' }

describe('Section contract', () => {
  it('accepts a section with only a title', () => {
    expect(sectionPropsSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a full section', () => {
    const result = sectionPropsSchema.safeParse({
      ...base,
      description: 'Where orders are shipped',
      icon: 'map-pin',
      count: 3,
      headingLevel: 3,
      actions: [
        { key: 'add', label: 'Add address', icon: 'plus' },
        { key: 'export', label: 'Export', href: '/export' },
        { key: 'remove-all', label: 'Remove all', tone: 'destructive' },
      ],
      maxVisibleActions: 1,
      onAction: noop,
      variant: 'plain',
      tone: 'error',
      padding: 'none',
      layout: 'split',
      divider: false,
      summary: 'Two addresses',
      footerNote: 'Applies to new orders',
      emptyTitle: 'No addresses yet',
      emptyDescription: 'Add the first address',
      collapsible: true,
      collapsed: false,
      onCollapsedChange: noop,
      children: 'Body',
      footer: 'Footer',
      headerTrailing: 'Switch',
      status: 'ready',
      className: 'mt-4',
    })
    expect(result.success).toBe(true)
  })

  it('requires a non-empty title', () => {
    expect(sectionPropsSchema.safeParse({}).success).toBe(false)
    expect(sectionPropsSchema.safeParse({ title: '' }).success).toBe(false)
  })

  it('rejects unknown variants, tones, paddings and heading levels', () => {
    expect(sectionPropsSchema.safeParse({ ...base, variant: 'outlined' }).success).toBe(false)
    expect(sectionPropsSchema.safeParse({ ...base, tone: 'warning' }).success).toBe(false)
    expect(sectionPropsSchema.safeParse({ ...base, padding: 'large' }).success).toBe(false)
    expect(sectionPropsSchema.safeParse({ ...base, layout: 'grid' }).success).toBe(false)
    expect(sectionPropsSchema.safeParse({ ...base, headingLevel: 1 }).success).toBe(false)
    expect(sectionPropsSchema.safeParse({ ...base, headingLevel: 5 }).success).toBe(false)
  })

  it('rejects a negative or fractional count and an icon that is not kebab-case', () => {
    expect(sectionPropsSchema.safeParse({ ...base, count: -1 }).success).toBe(false)
    expect(sectionPropsSchema.safeParse({ ...base, count: 1.5 }).success).toBe(false)
    expect(sectionPropsSchema.safeParse({ ...base, count: 0 }).success).toBe(true)
    expect(sectionPropsSchema.safeParse({ ...base, icon: 'MapPin' }).success).toBe(false)
  })

  it('rejects actions without onAction', () => {
    const result = sectionPropsSchema.safeParse({ ...base, actions: [{ key: 'add', label: 'Add address' }] })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['onAction'])
  })

  it('accepts an empty action list without onAction', () => {
    expect(sectionPropsSchema.safeParse({ ...base, actions: [] }).success).toBe(true)
  })

  it('rejects duplicate action keys', () => {
    const result = sectionPropsSchema.safeParse({
      ...base,
      actions: [
        { key: 'add', label: 'Add address' },
        { key: 'add', label: 'Add another' },
      ],
      onAction: noop,
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['actions'])
  })

  it('rejects a disabled reason on an enabled action', () => {
    const result = sectionPropsSchema.safeParse({
      ...base,
      actions: [{ key: 'add', label: 'Add address', disabledReason: 'Limit reached' }],
      onAction: noop,
    })
    expect(result.success).toBe(false)
  })

  it('rejects collapse props without collapsible', () => {
    const result = sectionPropsSchema.safeParse({ ...base, defaultCollapsed: true })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['collapsible'])
    expect(sectionPropsSchema.safeParse({ ...base, onCollapsedChange: noop }).success).toBe(false)
  })

  it('rejects a summary without collapsible', () => {
    const result = sectionPropsSchema.safeParse({ ...base, summary: 'Two addresses' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['collapsible'])
    expect(sectionPropsSchema.safeParse({ ...base, collapsible: true, summary: 'Two addresses' }).success).toBe(true)
  })

  it('rejects empty summary, footer note and empty-state texts', () => {
    expect(sectionPropsSchema.safeParse({ ...base, collapsible: true, summary: '' }).success).toBe(false)
    expect(sectionPropsSchema.safeParse({ ...base, footerNote: '' }).success).toBe(false)
    expect(sectionPropsSchema.safeParse({ ...base, emptyTitle: '' }).success).toBe(false)
    expect(sectionPropsSchema.safeParse({ ...base, emptyDescription: '' }).success).toBe(false)
  })

  it('accepts both layouts and an explicit divider', () => {
    expect(sectionPropsSchema.safeParse({ ...base, layout: 'stacked', divider: true }).success).toBe(true)
    expect(sectionPropsSchema.safeParse({ ...base, layout: 'split' }).success).toBe(true)
    expect(sectionPropsSchema.safeParse({ ...base, divider: 'yes' }).success).toBe(false)
  })

  it('requires onCollapsedChange for a controlled collapsed value', () => {
    const result = sectionPropsSchema.safeParse({ ...base, collapsible: true, collapsed: true })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['onCollapsedChange'])
    expect(
      sectionPropsSchema.safeParse({ ...base, collapsible: true, collapsed: true, onCollapsedChange: noop }).success,
    ).toBe(true)
  })

  it('accepts an uncontrolled collapsible section', () => {
    expect(sectionPropsSchema.safeParse({ ...base, collapsible: true, defaultCollapsed: true }).success).toBe(true)
  })

  it('rejects a callback that is not a function', () => {
    expect(sectionPropsSchema.safeParse({ ...base, collapsible: true, onCollapsedChange: 'toggle' }).success).toBe(false)
    expect(sectionPropsSchema.safeParse({ ...base, onRetry: 'retry' }).success).toBe(false)
  })
})
