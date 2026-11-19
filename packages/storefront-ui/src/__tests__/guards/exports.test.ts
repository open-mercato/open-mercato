import * as pkg from '../../index'

// storefront-app spec §3.2: exactly these 24 components, in this order of the contract list.
export const EXPORTED_COMPONENTS = [
  'Button', 'Badge', 'Input', 'Select', 'Checkbox', 'RadioGroup', 'Dialog', 'Sheet', 'Popover', 'Tooltip',
  'Tabs', 'Accordion', 'Skeleton', 'Spinner', 'Toast', 'Combobox', 'Pagination', 'Breadcrumbs', 'VisuallyHidden',
  'SkipLink', 'AspectRatio', 'Separator', 'Alert', 'Card',
] as const

describe('storefront-ui export budget (storefront-app spec §3.2)', () => {
  it('exports exactly the 24 contracted components and nothing else', () => {
    const actual = Object.keys(pkg).sort()
    expect(actual).toEqual([...EXPORTED_COMPONENTS].sort())
    expect(actual).toHaveLength(24)
  })

  it('every export is a component or a compound component object', () => {
    for (const name of EXPORTED_COMPONENTS) {
      const value = (pkg as Record<string, unknown>)[name]
      expect(['function', 'object']).toContain(typeof value)
      expect(value).toBeTruthy()
    }
  })
})
