import { keyValuePropsSchema } from '../key-value'

const readOnlyItems = [
  { key: 'email', label: 'Email', value: 'jan@example.com' },
  { key: 'phone', label: 'Phone', value: '+48 600 000 000', hint: 'Work' },
]

describe('KeyValue contract', () => {
  it('accepts read-only items without onEdit', () => {
    expect(keyValuePropsSchema.safeParse({ items: readOnlyItems }).success).toBe(true)
  })

  it('accepts rich values as slots', () => {
    expect(keyValuePropsSchema.safeParse({ items: [{ key: 'tags', label: 'Tags', value: { type: 'span' } }] }).success).toBe(
      true,
    )
  })

  it('accepts editable items with an editor and onEdit', () => {
    const result = keyValuePropsSchema.safeParse({
      items: [
        { key: 'name', label: 'Name', value: 'Jan', editable: true, editor: 'text' },
        {
          key: 'stage',
          label: 'Stage',
          value: 'Lead',
          editable: true,
          editor: 'select',
          options: [{ value: 'lead', label: 'Lead' }],
        },
      ],
      columns: 2,
      onEdit: async () => undefined,
    })
    expect(result.success).toBe(true)
  })

  it('rejects editable items without an editor', () => {
    const result = keyValuePropsSchema.safeParse({
      items: [{ key: 'name', label: 'Name', value: 'Jan', editable: true }],
      onEdit: async () => undefined,
    })
    expect(result.success).toBe(false)
  })

  it('rejects select editors without options', () => {
    const result = keyValuePropsSchema.safeParse({
      items: [{ key: 'stage', label: 'Stage', value: 'Lead', editable: true, editor: 'select' }],
      onEdit: async () => undefined,
    })
    expect(result.success).toBe(false)
  })

  it('rejects editable items without onEdit', () => {
    const result = keyValuePropsSchema.safeParse({
      items: [{ key: 'name', label: 'Name', value: 'Jan', editable: true, editor: 'text' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects duplicate keys and unsupported column counts', () => {
    expect(keyValuePropsSchema.safeParse({ items: [readOnlyItems[0], readOnlyItems[0]] }).success).toBe(false)
    expect(keyValuePropsSchema.safeParse({ items: readOnlyItems, columns: 3 }).success).toBe(false)
  })
})
