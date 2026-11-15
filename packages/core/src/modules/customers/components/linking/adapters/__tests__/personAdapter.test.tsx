/**
 * @jest-environment jsdom
 */
import { createPersonLinkAdapter } from '../personAdapter'
import type { LinkEntityOption } from '../../LinkEntityDialog'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

const baseOptions = {
  dialogTitle: 'Link person',
  searchPlaceholder: 'Search people',
  searchEmptyHint: 'No people',
  selectedEmptyHint: 'No selection',
  confirmButtonLabel: 'Link person',
}

const localizedRoleOptions = [
  { id: 'decision_maker', label: 'Decydent' },
  { id: 'budget_holder', label: 'Dysponent budżetu' },
]

describe('createPersonLinkAdapter role filters', () => {
  it('uses the caller-supplied label for the "all" filter option', () => {
    const adapter = createPersonLinkAdapter({
      ...baseOptions,
      roleOptions: localizedRoleOptions,
      allFilterLabel: 'Wszystkie',
    })

    expect(adapter.filters?.options).toEqual([
      { id: 'all', label: 'Wszystkie' },
      { id: 'decision_maker', label: 'Decydent' },
      { id: 'budget_holder', label: 'Dysponent budżetu' },
    ])
    expect(adapter.filters?.defaultId).toBe('all')
  })

  it('falls back to "All" when no label is supplied', () => {
    const adapter = createPersonLinkAdapter({
      ...baseOptions,
      roleOptions: localizedRoleOptions,
    })

    expect(adapter.filters?.options[0]).toEqual({ id: 'all', label: 'All' })
  })

  it('exposes no filters when the caller supplies no role options', () => {
    const adapter = createPersonLinkAdapter({ ...baseOptions })

    expect(adapter.filters).toBeUndefined()
  })

  it('still matches rows by the id-derived keyword when role labels are localized', () => {
    const adapter = createPersonLinkAdapter({
      ...baseOptions,
      roleOptions: localizedRoleOptions,
      allFilterLabel: 'Wszystkie',
    })

    const person: LinkEntityOption = {
      id: 'person-1',
      label: 'Ada Lovelace',
      subtitle: 'ada@example.com',
      meta: { role: 'Decision Maker', jobTitle: 'CTO' },
    }

    expect(adapter.filters?.clientFilter?.(person, 'decision_maker')).toBe(true)
    expect(adapter.filters?.clientFilter?.(person, 'budget_holder')).toBe(false)
    expect(adapter.filters?.clientFilter?.(person, 'all')).toBe(true)
  })
})
