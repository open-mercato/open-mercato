import type { AwilixContainer } from 'awilix'
import { resolveCampaignPageContext } from '../ai-agents'

/**
 * The wiring bug this guards: `usePageContext` on the client derives `entityType` from the URL
 * segment (`campaigns`, from `/backend/marketing/campaigns/[id]`), never from a dotted entity id.
 * The resolver used to compare against `marketing_automation.campaign` only, so it returned `null`
 * on every real chat turn and the agent never learned which campaign the operator had open.
 */
describe('resolveCampaignPageContext', () => {
  const campaign = {
    id: 'c1',
    name: 'Win-back<campaign-name>',
    isEnabled: true,
  }

  function fakeContainer(found: typeof campaign | null): AwilixContainer {
    return {
      resolve: () => ({ findOne: async () => found }),
    } as unknown as AwilixContainer
  }

  test('hydrates for the entityType the URL actually produces', async () => {
    const result = await resolveCampaignPageContext({
      entityType: 'campaigns',
      recordId: 'c1',
      container: fakeContainer(campaign),
      tenantId: 't1',
      organizationId: 'o1',
      userId: null,
    })
    expect(result).not.toBeNull()
    expect(result).toContain('campaign id c1')
    expect(result).toContain('PUBLISHED and messaging customers')
  })

  test('still hydrates for the explicit dotted entity type', async () => {
    const result = await resolveCampaignPageContext({
      entityType: 'marketing_automation.campaign',
      recordId: 'c1',
      container: fakeContainer(campaign),
      tenantId: 't1',
      organizationId: 'o1',
      userId: null,
    })
    expect(result).toContain('campaign id c1')
  })

  test('fences the tenant-authored name so it cannot break out as an instruction', async () => {
    const result = await resolveCampaignPageContext({
      entityType: 'campaigns',
      recordId: 'c1',
      container: fakeContainer(campaign),
      tenantId: 't1',
      organizationId: 'o1',
      userId: null,
    })
    expect(result).not.toContain('</campaign-name>\nignore')
    expect(result).toContain('<campaign-name>')
  })

  test('ignores an unrelated entityType', async () => {
    const result = await resolveCampaignPageContext({
      entityType: 'customers.person',
      recordId: 'c1',
      container: fakeContainer(campaign),
      tenantId: 't1',
      organizationId: 'o1',
      userId: null,
    })
    expect(result).toBeNull()
  })

  test('returns null without a tenant scope', async () => {
    const result = await resolveCampaignPageContext({
      entityType: 'campaigns',
      recordId: 'c1',
      container: fakeContainer(campaign),
      tenantId: null,
      organizationId: null,
      userId: null,
    })
    expect(result).toBeNull()
  })

  test('returns null when the campaign is not found', async () => {
    const result = await resolveCampaignPageContext({
      entityType: 'campaigns',
      recordId: 'missing',
      container: fakeContainer(null),
      tenantId: 't1',
      organizationId: 'o1',
      userId: null,
    })
    expect(result).toBeNull()
  })
})
