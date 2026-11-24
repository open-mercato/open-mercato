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
      status: { label: 'Active', tone: 'success' },
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
})
