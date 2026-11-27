import { entityHeaderPropsSchema } from '../entity-header'

const base = { title: 'Acme Corp' }

describe('EntityHeader contract', () => {
  it('accepts a title-only header', () => {
    expect(entityHeaderPropsSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a full header', () => {
    const result = entityHeaderPropsSchema.safeParse({
      ...base,
      subtitle: 'Customer since 2021',
      avatar: { initials: 'AC' },
      badge: { label: 'Active', tone: 'success' },
      meta: [{ key: 'owner', label: 'Owner', value: 'Jan Kowalski' }],
      actions: [
        { key: 'edit', label: 'Edit' },
        { key: 'delete', label: 'Delete', tone: 'destructive' },
      ],
      primaryActionKey: 'edit',
      onAction: () => undefined,
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty title', () => {
    expect(entityHeaderPropsSchema.safeParse({ title: '' }).success).toBe(false)
  })

  it('rejects actions without onAction', () => {
    expect(entityHeaderPropsSchema.safeParse({ ...base, actions: [{ key: 'edit', label: 'Edit' }] }).success).toBe(false)
  })

  it('rejects a primaryActionKey when there are no actions', () => {
    expect(
      entityHeaderPropsSchema.safeParse({ ...base, primaryActionKey: 'edit', onAction: () => undefined }).success,
    ).toBe(false)
  })

  it('rejects a primaryActionKey that matches no action', () => {
    const result = entityHeaderPropsSchema.safeParse({
      ...base,
      actions: [{ key: 'edit', label: 'Edit' }],
      primaryActionKey: 'archive',
      onAction: () => undefined,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a primaryActionKey that references a destructive action', () => {
    const result = entityHeaderPropsSchema.safeParse({
      ...base,
      actions: [{ key: 'delete', label: 'Delete', tone: 'destructive' }],
      primaryActionKey: 'delete',
      onAction: () => undefined,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('primaryActionKey must not reference a destructive action')
      expect(result.error.issues[0]?.path).toEqual(['primaryActionKey'])
    }
  })

  it('accepts a primaryActionKey that references a non-destructive action', () => {
    const result = entityHeaderPropsSchema.safeParse({
      ...base,
      actions: [
        { key: 'edit', label: 'Edit' },
        { key: 'delete', label: 'Delete', tone: 'destructive' },
      ],
      primaryActionKey: 'edit',
      onAction: () => undefined,
    })
    expect(result.success).toBe(true)
  })

  it('rejects duplicate action and meta keys', () => {
    expect(
      entityHeaderPropsSchema.safeParse({
        ...base,
        actions: [{ key: 'edit', label: 'Edit' }, { key: 'edit', label: 'Edit again' }],
        onAction: () => undefined,
      }).success,
    ).toBe(false)
    expect(
      entityHeaderPropsSchema.safeParse({
        ...base,
        meta: [{ key: 'a', label: 'A', value: '1' }, { key: 'a', label: 'B', value: '2' }],
      }).success,
    ).toBe(false)
  })

  it('limits avatar initials to three characters', () => {
    expect(entityHeaderPropsSchema.safeParse({ ...base, avatar: { initials: 'ABCD' } }).success).toBe(false)
  })

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'deals', label: 'Deals', icon: 'handshake', count: 12 },
    { key: 'billing', label: 'Billing', disabled: true },
  ]

  function firstIssue(input: unknown) {
    const result = entityHeaderPropsSchema.safeParse(input)
    return result.success ? null : { message: result.error.issues[0]?.message, path: result.error.issues[0]?.path }
  }

  it('accepts tabs with an active key and onTabChange', () => {
    const result = entityHeaderPropsSchema.safeParse({
      ...base,
      tabs,
      activeTabKey: 'deals',
      onTabChange: () => undefined,
      tabsLabel: 'Customer sections',
      idBase: 'customer-sections',
    })
    expect(result.success).toBe(true)
  })

  it('rejects duplicate tab keys', () => {
    expect(
      firstIssue({
        ...base,
        tabs: [...tabs, { key: 'deals', label: 'Deals again' }],
        activeTabKey: 'overview',
        onTabChange: () => undefined,
      }),
    ).toEqual({ message: 'Tab keys must be unique', path: ['tabs'] })
  })

  it('rejects tabs without an activeTabKey', () => {
    expect(firstIssue({ ...base, tabs, onTabChange: () => undefined })).toEqual({
      message: 'tabs require an activeTabKey that matches a tab key',
      path: ['activeTabKey'],
    })
  })

  it('rejects an activeTabKey that matches no tab', () => {
    expect(firstIssue({ ...base, tabs, activeTabKey: 'history', onTabChange: () => undefined })?.path).toEqual([
      'activeTabKey',
    ])
  })

  it('rejects tabs without onTabChange unless every tab has an href', () => {
    expect(firstIssue({ ...base, tabs, activeTabKey: 'overview' })).toEqual({
      message: 'tabs require onTabChange unless every tab has an href',
      path: ['onTabChange'],
    })
    const mixed = [{ key: 'overview', label: 'Overview', href: '/customers/1' }, { key: 'deals', label: 'Deals' }]
    expect(entityHeaderPropsSchema.safeParse({ ...base, tabs: mixed, activeTabKey: 'overview' }).success).toBe(false)
    const linked = mixed.map((tab) => ({ ...tab, href: `/customers/1/${tab.key}` }))
    expect(entityHeaderPropsSchema.safeParse({ ...base, tabs: linked, activeTabKey: 'overview' }).success).toBe(true)
  })

  it('rejects an empty tab list, a negative tab count and an invalid icon name', () => {
    expect(entityHeaderPropsSchema.safeParse({ ...base, tabs: [], onTabChange: () => undefined }).success).toBe(false)
    const withTab = (tab: Record<string, unknown>) =>
      entityHeaderPropsSchema.safeParse({
        ...base,
        tabs: [{ key: 'overview', label: 'Overview', ...tab }],
        activeTabKey: 'overview',
        onTabChange: () => undefined,
      }).success
    expect(withTab({ count: -1 })).toBe(false)
    expect(withTab({ icon: 'Not An Icon' })).toBe(false)
    expect(withTab({ count: 0, icon: 'star' })).toBe(true)
  })

  it('accepts activeTabKey and onTabChange without tabs', () => {
    expect(entityHeaderPropsSchema.safeParse({ ...base, activeTabKey: 'overview', onTabChange: () => undefined }).success).toBe(true)
  })

  it('rejects an idBase that is not a valid id prefix', () => {
    expect(entityHeaderPropsSchema.safeParse({ ...base, idBase: 'customer sections' }).success).toBe(false)
    expect(entityHeaderPropsSchema.safeParse({ ...base, idBase: 'customer-sections' }).success).toBe(true)
  })

  it('requires backHref or onBack with backLabel', () => {
    expect(firstIssue({ ...base, backLabel: 'Customers' })).toEqual({
      message: 'backLabel requires backHref or onBack',
      path: ['backLabel'],
    })
    expect(entityHeaderPropsSchema.safeParse({ ...base, backLabel: 'Customers', backHref: '/customers' }).success).toBe(true)
    expect(entityHeaderPropsSchema.safeParse({ ...base, backLabel: 'Customers', onBack: () => undefined }).success).toBe(true)
  })

  it('accepts a non-negative integer count and rejects other numbers', () => {
    expect(entityHeaderPropsSchema.safeParse({ ...base, count: 0 }).success).toBe(true)
    expect(entityHeaderPropsSchema.safeParse({ ...base, count: 128 }).success).toBe(true)
    expect(entityHeaderPropsSchema.safeParse({ ...base, count: -1 }).success).toBe(false)
    expect(entityHeaderPropsSchema.safeParse({ ...base, count: 1.5 }).success).toBe(false)
  })
})
