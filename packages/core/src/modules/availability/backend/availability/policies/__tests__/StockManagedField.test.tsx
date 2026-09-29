import type { CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { resolveStockManagedValue, withResolvedStockManagedField } from '../StockManagedField'

describe('resolveStockManagedValue', () => {
  it('prefers the value the user explicitly chose', () => {
    expect(resolveStockManagedValue(false, true)).toBe(false)
    expect(resolveStockManagedValue(true, false)).toBe(true)
  })

  it('falls back to the resolved scope value while the field is untouched', () => {
    expect(resolveStockManagedValue(undefined, true)).toBe(true)
    expect(resolveStockManagedValue(undefined, false)).toBe(false)
  })

  it('stays undefined when nothing was chosen or resolved, so the server default applies', () => {
    expect(resolveStockManagedValue(undefined, null)).toBeUndefined()
  })
})

describe('withResolvedStockManagedField', () => {
  it('swaps only the isStockManaged checkbox for a custom field', () => {
    const groups: CrudFormGroup[] = [
      {
        id: 'sell-policy',
        fields: [
          { id: 'isStockManaged', type: 'checkbox', label: 'Stock managed', description: 'help' },
          { id: 'allowBackorder', type: 'checkbox', label: 'Allow backorder' },
        ],
      },
    ]
    const [group] = withResolvedStockManagedField(groups)
    const [stockManaged, backorder] = group.fields ?? []
    expect(typeof stockManaged === 'object' && stockManaged.type).toBe('custom')
    expect(typeof stockManaged === 'object' && stockManaged.description).toBe('help')
    expect(backorder).toBe(groups[0].fields?.[1])
  })
})
