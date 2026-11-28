import { bulkActionBarPropsSchema } from '../bulk-action-bar'

const noop = () => undefined
const base = {
  selectedCount: 3,
  actions: [
    { key: 'assign', label: 'Assign owner' },
    { key: 'delete', label: 'Delete', tone: 'destructive' as const },
  ],
  onAction: noop,
  onClear: noop,
}

describe('BulkActionBar contract', () => {
  it('accepts the minimal bar', () => {
    expect(bulkActionBarPropsSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a full bar', () => {
    const result = bulkActionBarPropsSchema.safeParse({
      ...base,
      totalCount: 128,
      allMatchingSelected: false,
      summary: 'Total 12,400.00 USD',
      maxVisibleActions: 2,
      pendingActionKey: 'assign',
      progress: { label: 'Updating records', done: 12, total: 40 },
      position: 'inline',
      clearOnEscape: false,
      onSelectAllMatching: noop,
      trailing: null,
      className: 'mt-2',
    })
    expect(result.success).toBe(true)
  })

  it('accepts an empty action list and a zero selection', () => {
    expect(bulkActionBarPropsSchema.safeParse({ ...base, selectedCount: 0, actions: [] }).success).toBe(true)
  })

  it('requires onAction and onClear', () => {
    expect(bulkActionBarPropsSchema.safeParse({ ...base, onAction: undefined }).success).toBe(false)
    expect(bulkActionBarPropsSchema.safeParse({ ...base, onClear: undefined }).success).toBe(false)
  })

  it('rejects duplicate action keys', () => {
    const result = bulkActionBarPropsSchema.safeParse({
      ...base,
      actions: [
        { key: 'assign', label: 'Assign owner' },
        { key: 'assign', label: 'Assign again' },
      ],
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toBe('Action keys must be unique')
  })

  it('rejects a pendingActionKey that matches no action', () => {
    const result = bulkActionBarPropsSchema.safeParse({ ...base, pendingActionKey: 'export' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['pendingActionKey'])
  })

  it.each([
    ['selectedCount', -1],
    ['selectedCount', 2.5],
    ['totalCount', -4],
    ['totalCount', 10.2],
    ['maxVisibleActions', 0],
    ['maxVisibleActions', 1.5],
  ])('rejects %s = %s', (field, value) => {
    expect(bulkActionBarPropsSchema.safeParse({ ...base, onSelectAllMatching: noop, [field]: value }).success).toBe(false)
  })

  it('rejects negative, fractional or inconsistent progress numbers', () => {
    const withProgress = (progress: unknown) => bulkActionBarPropsSchema.safeParse({ ...base, progress }).success
    expect(withProgress({ label: 'Updating', done: -1, total: 4 })).toBe(false)
    expect(withProgress({ label: 'Updating', done: 1.5, total: 4 })).toBe(false)
    expect(withProgress({ label: 'Updating', done: 5, total: 4 })).toBe(false)
    expect(withProgress({ label: '', done: 1, total: 4 })).toBe(false)
    expect(withProgress({ label: 'Updating' })).toBe(true)
    expect(withProgress({ label: 'Updating', done: 4, total: 4 })).toBe(true)
  })

  it('requires onSelectAllMatching when totalCount exceeds selectedCount', () => {
    const missing = bulkActionBarPropsSchema.safeParse({ ...base, totalCount: 128 })
    expect(missing.success).toBe(false)
    if (!missing.success) expect(missing.error.issues[0]?.path).toEqual(['onSelectAllMatching'])
    expect(bulkActionBarPropsSchema.safeParse({ ...base, totalCount: 128, onSelectAllMatching: noop }).success).toBe(true)
    expect(bulkActionBarPropsSchema.safeParse({ ...base, totalCount: 3 }).success).toBe(true)
  })

  it('rejects an unknown position', () => {
    expect(bulkActionBarPropsSchema.safeParse({ ...base, position: 'sticky' }).success).toBe(false)
  })

  it('accepts both destructive placements and rejects an unknown one', () => {
    expect(bulkActionBarPropsSchema.safeParse({ ...base, destructivePlacement: 'overflow' }).success).toBe(true)
    expect(bulkActionBarPropsSchema.safeParse({ ...base, destructivePlacement: 'inline' }).success).toBe(true)
    expect(bulkActionBarPropsSchema.safeParse({ ...base, destructivePlacement: 'first' }).success).toBe(false)
  })

  it('accepts an ariaLabel and rejects an empty one', () => {
    expect(bulkActionBarPropsSchema.safeParse({ ...base, ariaLabel: 'Bulk actions for deals' }).success).toBe(true)
    expect(bulkActionBarPropsSchema.safeParse({ ...base, ariaLabel: '' }).success).toBe(false)
  })

  it('rejects a disabledReason on an enabled action', () => {
    const result = bulkActionBarPropsSchema.safeParse({
      ...base,
      actions: [{ key: 'assign', label: 'Assign owner', disabledReason: 'Not allowed' }],
    })
    expect(result.success).toBe(false)
  })
})
