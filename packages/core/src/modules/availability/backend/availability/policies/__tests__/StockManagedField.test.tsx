import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import {
  STOCK_MANAGED_INHERIT,
  STOCK_MANAGED_OFF,
  STOCK_MANAGED_ON,
  buildStockManagedOptions,
  fromStockManagedChoice,
  toStockManagedChoice,
} from '../StockManagedField'
import { buildPolicyFieldGroups } from '../formGroups'

const t: TranslateFn = (key, fallbackOrParams, params) => {
  const resolvedParams = typeof fallbackOrParams === 'object' ? fallbackOrParams : params
  return resolvedParams ? `${key}:${JSON.stringify(resolvedParams)}` : key
}

describe('toStockManagedChoice / fromStockManagedChoice', () => {
  it('maps a stored null to the inherit choice and back to null', () => {
    expect(toStockManagedChoice(null)).toBe(STOCK_MANAGED_INHERIT)
    expect(toStockManagedChoice(undefined)).toBe(STOCK_MANAGED_INHERIT)
    expect(fromStockManagedChoice(STOCK_MANAGED_INHERIT)).toBeNull()
  })

  it('round-trips explicit booleans', () => {
    expect(fromStockManagedChoice(toStockManagedChoice(true))).toBe(true)
    expect(fromStockManagedChoice(toStockManagedChoice(false))).toBe(false)
  })

  it('treats a cleared select (undefined / empty) as inherit, never as an explicit false', () => {
    expect(fromStockManagedChoice(undefined)).toBeNull()
    expect(fromStockManagedChoice('')).toBeNull()
    expect(fromStockManagedChoice(null)).toBeNull()
  })
})

describe('buildStockManagedOptions', () => {
  it('offers inherit, yes and no', () => {
    const options = buildStockManagedOptions(t)
    expect(options.map((option) => option.value)).toEqual([STOCK_MANAGED_INHERIT, STOCK_MANAGED_ON, STOCK_MANAGED_OFF])
    expect(options[0].label).toBe('availability.policies.form.field.isStockManaged.inherit')
  })

  it('shows the currently resolved value on the inherit option when known', () => {
    const [inherit] = buildStockManagedOptions(t, true)
    expect(inherit.label).toContain('availability.policies.form.field.isStockManaged.inheritResolved')
    expect(inherit.label).toContain('availability.common.yes')
  })
})

describe('buildPolicyFieldGroups', () => {
  it('renders isStockManaged as a tri-state select', () => {
    const groups = buildPolicyFieldGroups(t)
    const field = groups.flatMap((group) => group.fields ?? []).find(
      (candidate) => typeof candidate === 'object' && candidate.id === 'isStockManaged',
    )
    expect(typeof field === 'object' && field.type).toBe('select')
  })
})
