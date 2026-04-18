/**
 * Step 3.9 — verifies the module-root customers ai-tools aggregator.
 */
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

import aiTools from '../../ai-tools'
import { knownFeatureIds } from './shared'

describe('customers module-root ai-tools aggregator', () => {
  it('exports every required read-only tool', () => {
    const names = aiTools.map((tool) => tool.name).sort()
    expect(names).toEqual(
      [
        'customers.list_people',
        'customers.get_person',
        'customers.list_companies',
        'customers.get_company',
        'customers.list_deals',
        'customers.get_deal',
        'customers.list_activities',
        'customers.list_tasks',
        'customers.list_addresses',
        'customers.list_tags',
        'customers.get_settings',
      ].sort(),
    )
  })

  it('every tool declares requiredFeatures that exist in acl.ts and none is a mutation', () => {
    for (const tool of aiTools) {
      expect(tool.requiredFeatures?.length ?? 0).toBeGreaterThan(0)
      for (const feature of tool.requiredFeatures!) {
        expect(knownFeatureIds.has(feature)).toBe(true)
      }
      expect(tool.isMutation).toBeFalsy()
    }
  })
})
