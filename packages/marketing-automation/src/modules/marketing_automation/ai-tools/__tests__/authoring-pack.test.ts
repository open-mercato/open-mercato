const reportError = jest.fn()
jest.mock('@open-mercato/telemetry', () => ({ reportError: (...a: unknown[]) => reportError(...a) }))

import { marketingAuthoringAiTools } from '../authoring-pack'
import { requireToolScope } from '../types'
import aiTools from '../../ai-tools'
import { estimateAudienceSize } from '../../lib/audience/estimate'

jest.mock('../../lib/audience/estimate', () => ({
  estimateAudienceSize: jest.fn(),
}))

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

  /**
   * The root cause this guards: the AI tool and the audience-estimate API route each had their own
   * estimation logic and could report different counts for the same audience. Both now delegate to
   * `estimateAudienceSize`, so this asserts the tool is a thin wrapper around it rather than a second
   * implementation drifting back in.
   */
  test('estimate_audience delegates to the SAME estimator the audience-estimate API route calls', async () => {
    const mocked = estimateAudienceSize as jest.Mock
    mocked.mockReset()
    mocked.mockResolvedValue({ count: 42, qualifier: 'exact', narrowing: 'all', candidates: null, queries: 0 })

    const estimate = marketingAuthoringAiTools.find((tool) => tool.name.endsWith('estimate_audience'))!
    const context = {
      tenantId: 't1',
      organizationId: 'o1',
      userId: null,
      userFeatures: [],
      isSuperAdmin: false,
      container: { resolve: () => ({}) },
    }
    const result = await estimate.handler({ audience: null }, context as never)

    expect(mocked).toHaveBeenCalledWith({}, { tenantId: 't1', organizationId: 'o1' }, null, expect.any(Date))
    expect(result).toEqual({ ok: true, count: 42, narrowing: 'all', qualifier: 'exact', candidates: null })
  })

  /**
   * The gap this guards: EVERY error from `commandBus.execute` — a validation refusal AND an
   * unexpected infra/DB failure alike — used to collapse into the same generic `{ ok:false, message:
   * 'save failed' }` tool result with no telemetry at all. A validation refusal is the command
   * speaking and needs no report; anything without that shape is a real failure the agent's answer
   * was quietly absorbing.
   */
  /**
   * The two AI-driven write paths this pack exposes. Both had their failure branches tested only
   * through input-schema validation; neither had a test proving a SUCCESSFUL write actually reaches
   * the command bus with the scope and name the agent supplied.
   */
  describe('create_campaign writes through the command bus', () => {
    test('creates a disabled draft and returns its id', async () => {
      const execute = jest.fn().mockResolvedValue({ result: { id: 'camp-1' } })
      const create = marketingAuthoringAiTools.find((tool) => tool.name.endsWith('create_campaign'))!
      const context = {
        tenantId: 't1',
        organizationId: 'o1',
        userId: null,
        userFeatures: [],
        isSuperAdmin: false,
        container: { resolve: () => ({ execute }) },
      }
      const result = await create.handler({ name: 'Win-back' }, context as never)
      expect(execute).toHaveBeenCalledWith(
        'marketing_automation.campaigns.create',
        expect.objectContaining({ input: { name: 'Win-back', tenantId: 't1', organizationId: 'o1' } }),
      )
      expect(result).toEqual({ id: 'camp-1', isEnabled: false })
    })
  })

  describe('save_campaign_graph error reporting', () => {
    const save = marketingAuthoringAiTools.find((tool) => tool.name.endsWith('save_campaign_graph'))!
    const input = {
      campaignId: '11111111-1111-4111-8111-111111111111',
      updatedAt: '2026-10-20T00:00:00.000Z',
      name: 'x',
      triggers: [],
      definition: {},
    }

    function contextWithCommandBus(execute: jest.Mock) {
      return {
        tenantId: 't1',
        organizationId: 'o1',
        userId: null,
        userFeatures: [],
        isSuperAdmin: false,
        container: { resolve: () => ({ execute }) },
      }
    }

    beforeEach(() => {
      reportError.mockReset()
    })

    test('a successful save reaches the command bus and reports the new version', async () => {
      const execute = jest.fn().mockResolvedValue({ result: { updatedAt: '2026-10-21T00:00:00.000Z', waitingRuns: 3 } })
      const result = await save.handler(input, contextWithCommandBus(execute) as never)
      expect(execute).toHaveBeenCalledWith(
        'marketing_automation.campaigns.save_graph',
        expect.objectContaining({ input: expect.objectContaining({ id: input.campaignId, updatedAt: input.updatedAt }) }),
      )
      expect(result).toEqual({ ok: true, updatedAt: '2026-10-21T00:00:00.000Z', waitingRuns: 3 })
      expect(reportError).not.toHaveBeenCalled()
    })

    test('a validation refusal from the command is surfaced without reporting it', async () => {
      const execute = jest.fn().mockRejectedValue({
        status: 409,
        body: { code: 'marketing_automation.validation.staleVersion', error: 'stale' },
      })
      const result = await save.handler(input, contextWithCommandBus(execute) as never)
      expect(result).toEqual({ ok: false, status: 409, code: 'marketing_automation.validation.staleVersion', message: 'stale' })
      expect(reportError).not.toHaveBeenCalled()
    })

    test('an unexpected infra failure is reported, not silently absorbed', async () => {
      const execute = jest.fn().mockRejectedValue(new Error('connection terminated unexpectedly'))
      const result = await save.handler(input, contextWithCommandBus(execute) as never)
      expect(result).toEqual({ ok: false, status: null, code: null, message: 'save failed' })
      expect(reportError).toHaveBeenCalledTimes(1)
    })
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
