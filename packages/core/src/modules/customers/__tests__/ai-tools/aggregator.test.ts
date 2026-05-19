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
  it('exports every required tool (read-only + mutation)', () => {
    const names = aiTools.map((tool) => tool.name).sort()
    expect(names).toEqual(
      [
        'customers.list_people',
        'customers.get_person',
        'customers.list_companies',
        'customers.get_company',
        'customers.list_deals',
        'customers.get_deal',
        'customers.update_deal_stage',
        'customers.list_activities',
        'customers.list_tasks',
        'customers.list_deal_comments',
        'customers.manage_deal_comment',
        'customers.manage_deal_activity',
        'customers.list_record_comments',
        'customers.manage_record_comment',
        'customers.manage_record_activity',
        'customers.list_addresses',
        'customers.list_tags',
        'customers.get_settings',
        'customers.analyze_deals',
      ].sort(),
    )
  })

  it('every tool declares requiredFeatures that exist in acl.ts', () => {
    for (const tool of aiTools) {
      expect(tool.requiredFeatures?.length ?? 0).toBeGreaterThan(0)
      for (const feature of tool.requiredFeatures!) {
        expect(knownFeatureIds.has(feature)).toBe(true)
      }
    }
  })

  it('every read-only tool does not declare isMutation', () => {
    for (const tool of aiTools) {
      if (tool.isMutation) continue
      expect(tool.isMutation).toBeFalsy()
    }
  })
})
