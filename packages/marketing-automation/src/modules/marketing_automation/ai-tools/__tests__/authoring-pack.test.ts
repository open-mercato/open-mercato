import { marketingAuthoringAiTools } from '../authoring-pack'
import { requireToolScope } from '../types'
import aiTools from '../../ai-tools'

const tools = marketingAuthoringAiTools as unknown as Array<{
  name: string
  description: string
  requiredFeatures?: string[]
  isMutation?: boolean
  inputSchema: { safeParse: (value: unknown) => { success: boolean } }
}>

describe('the marketing AI tool pack', () => {
  test('is what the module root exports, so the generator picks up the same list', () => {
    // The root spreads the pack into a new array, so compare CONTENTS: what matters is that the
    // generator sees every tool the pack defines, not that it sees the same array object.
    const rootNames = (aiTools as unknown as Array<{ name: string }>).map((tool) => tool.name)
    expect(rootNames).toEqual(tools.map((tool) => tool.name))
    expect(tools.length).toBeGreaterThan(0)
  })

  /**
   * The invariant that matters most.
   *
   * Enabling a campaign is what starts messaging real customers. It is gated behind its own human
   * permission, and an agent that could do it would turn a misunderstood sentence into mail nobody
   * approved. This test exists so that adding such a tool has to be a deliberate act against a stated
   * rule rather than an oversight.
   */
  test('contains no tool that can enable, publish or delete a campaign', () => {
    const forbidden = /enable|disable|publish|delete|remove/i
    // Listed rather than asserted one by one, so a failure names the offending tool.
    expect(tools.filter((tool) => forbidden.test(tool.name)).map((tool) => tool.name)).toEqual([])
    expect(tools.some((tool) => tool.requiredFeatures?.includes('marketing_automation.campaigns.publish'))).toBe(false)
  })

  // Never empty for a tool that touches tenant data — the platform's own rule for MCP tools.
  test('every tool declares the features it needs', () => {
    const featureless = tools.filter((tool) => (tool.requiredFeatures ?? []).length === 0).map((tool) => tool.name)
    expect(featureless).toEqual([])
    const foreign = tools.flatMap((tool) => (tool.requiredFeatures ?? [])
      .filter((feature) => !feature.startsWith('marketing_automation.'))
      .map((feature) => `${tool.name}:${feature}`))
    expect(foreign).toEqual([])
  })

  test('every name is namespaced by the module id', () => {
    expect(tools.filter((tool) => !tool.name.startsWith('marketing_automation.')).map((tool) => tool.name)).toEqual([])
  })

  test('every writing tool is flagged as a mutation, so approval applies', () => {
    const writers = tools.filter((tool) => /create|save|update|apply/i.test(tool.name))
    expect(writers.length).toBeGreaterThan(0)
    expect(writers.filter((tool) => tool.isMutation !== true).map((tool) => tool.name)).toEqual([])
  })

  test('no read-only tool is flagged as a mutation', () => {
    const readers = tools.filter((entry) => /list|get|describe|estimate/i.test(entry.name))
    expect(readers.filter((tool) => tool.isMutation === true).map((tool) => tool.name)).toEqual([])
  })

  test('every tool describes itself well enough for a model to choose it', () => {
    expect(tools.filter((tool) => tool.description.length <= 40).map((tool) => tool.name)).toEqual([])
  })

  test('the save tool demands the version it read, so a blind write is impossible', () => {
    const save = tools.find((tool) => tool.name.endsWith('save_campaign_graph'))!
    expect(save.inputSchema.safeParse({
      campaignId: '11111111-1111-4111-8111-111111111111',
      name: 'x',
      triggers: [],
      definition: {},
    }).success).toBe(false)
  })
})

describe('requireToolScope', () => {
  const base = { userId: null, container: {} as never, userFeatures: [], isSuperAdmin: false }

  test('returns the scope when both parts are present', () => {
    expect(requireToolScope({ ...base, tenantId: 't1', organizationId: 'o1' }))
      .toEqual({ tenantId: 't1', organizationId: 'o1' })
  })

  // An agent principal without a tenant is not one this module can serve: answering with data from
  // "somewhere" is what a cross-tenant leak looks like from the inside.
  test.each([
    ['no tenant', null, 'o1'],
    ['no organization', 't1', null],
    ['neither', null, null],
    ['blank tenant', '   ', 'o1'],
  ])('refuses %s', (_label, tenantId, organizationId) => {
    expect(() => requireToolScope({ ...base, tenantId, organizationId })).toThrow()
  })
})
