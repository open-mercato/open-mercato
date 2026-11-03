import { buildFunnelStages, loadCampaignFunnel } from '../funnel'
import { resetCapabilityCache } from '../../capabilities'

/**
 * The funnel's arithmetic, which is where its decisions are: which denominator each percentage uses, and what
 * a rate over nobody means.
 */
describe('buildFunnelStages', () => {
  const counts = { entered: 1000, sent: 900, opened: 450, clicked: 90, converted: 9 }

  test('reports the five stages in order', () => {
    expect(buildFunnelStages(counts).map((stage) => stage.key)).toEqual([
      'entered', 'sent', 'opened', 'clicked', 'converted',
    ])
  })

  /**
   * Both denominators, because operators quote both.
   *
   * "Half of the people who opened went on to click" and "nine per cent of everyone who entered clicked" are
   * different facts, and a screen that offers only one of them invites the reader to compute the other wrongly.
   */
  test('carries the step-to-step rate and the share of everyone who entered', () => {
    const stages = buildFunnelStages(counts)
    const clicked = stages.find((stage) => stage.key === 'clicked')
    expect(clicked?.conversionFromPrevious).toBeCloseTo(0.2, 4)
    expect(clicked?.shareOfEntered).toBeCloseTo(0.09, 4)
  })

  test('the first stage has no previous stage and no share of itself', () => {
    const [entered] = buildFunnelStages(counts)
    expect(entered.conversionFromPrevious).toBeNull()
    expect(entered.shareOfEntered).toBeNull()
  })

  /**
   * A rate over nobody is not a rate of nothing.
   *
   * Zero would read as "everybody dropped out here", which is a claim about behaviour; null says there was
   * nobody to drop out, which is a claim about the data.
   */
  test('an empty previous stage yields null, not zero', () => {
    const stages = buildFunnelStages({ entered: 0, sent: 0, opened: 0, clicked: 0, converted: 0 })
    for (const stage of stages) {
      expect(stage.conversionFromPrevious).toBeNull()
      expect(stage.shareOfEntered).toBeNull()
    }
  })

  test('a campaign that sent nothing still reports the people who entered it', () => {
    const stages = buildFunnelStages({ entered: 50, sent: 0, opened: 0, clicked: 0, converted: 0 })
    expect(stages[0].people).toBe(50)
    expect(stages[1]).toMatchObject({ key: 'sent', people: 0, conversionFromPrevious: 0 })
    // And the stages after an empty one report null rather than a second zero rate.
    expect(stages[2].conversionFromPrevious).toBeNull()
  })

  /**
   * There is no `delivered` stage, and that is the deliberate part.
   *
   * Delivery is what the receiving server did, and the platform has no provider feedback contract — so a
   * delivered count could only be the sent count wearing a more confident name.
   */
  test('there is no delivered stage to mislead anybody', () => {
    expect(buildFunnelStages(counts).map((stage) => stage.key)).not.toContain('delivered')
  })
})

/**
 * The no-conversions statement and its binding, which no test reached.
 *
 * The sibling A/B change has a dedicated test for exactly this hazard — omit a CTE and leave its placeholders
 * and every later parameter shifts, binding a step id where a tenant belongs — and the funnel has the same
 * CTE/placeholder split. `TC-MA-031` runs against an install that HAS sales and asserts five stages, so the
 * four-stage statement had never been executed or counted.
 */
describe('loadCampaignFunnel without a sales module', () => {
  function fakeEm(capabilities: { sales: boolean; catalog: boolean }) {
    const executed: Array<{ sql: string; params: unknown[] }> = []
    const em = {
      execute: async () => [capabilities],
      getConnection: () => ({
        execute: async (sql: string, params: unknown[]) => {
          executed.push({ sql, params })
          return [{ entered: 5, sent: 4, opened: 2, clicked: 1, converted: 0 }]
        },
      }),
    }
    return { em: em as never, executed }
  }

  beforeEach(() => resetCapabilityCache())

  it('omits the conversion CTE and the placeholders that belong to it', async () => {
    const { em, executed } = fakeEm({ sales: false, catalog: false })
    const funnel = await loadCampaignFunnel(em, 'camp-1', { tenantId: 't1', organizationId: 'o1' }, { conversionWindowDays: 7 })
    const { sql, params } = executed[0]
    expect(sql).not.toContain('sales_orders')
    expect(sql).not.toContain('converted as (')
    // Four CTEs of (campaign, tenant, org) each: the conversion binding is gone with its CTE.
    expect(params).toHaveLength(12)
    expect(funnel.hasConversionData).toBe(false)
  })

  it('still reports the four stages that come from this module own tables', async () => {
    const { em } = fakeEm({ sales: false, catalog: false })
    const funnel = await loadCampaignFunnel(em, 'camp-1', { tenantId: 't1', organizationId: 'o1' }, { conversionWindowDays: 7 })
    expect(funnel.stages.map((stage) => stage.key)).toEqual(['entered', 'sent', 'opened', 'clicked'])
  })

  it('binds the conversion CTE when sales IS there, and keeps five stages', async () => {
    // The control: the parameter count must differ, or the branch above proves nothing.
    const { em, executed } = fakeEm({ sales: true, catalog: true })
    const funnel = await loadCampaignFunnel(em, 'camp-1', { tenantId: 't1', organizationId: 'o1' }, { conversionWindowDays: 7 })
    expect(executed[0].sql).toContain('sales_orders')
    expect(executed[0].params).toHaveLength(18)
    expect(funnel.stages.map((stage) => stage.key)).toEqual(['entered', 'sent', 'opened', 'clicked', 'converted'])
    expect(funnel.hasConversionData).toBe(true)
  })

  it('drops the stage from buildFunnelStages directly, rather than showing it at zero', () => {
    const counts = { entered: 5, sent: 4, opened: 2, clicked: 1, converted: 0 }
    expect(buildFunnelStages(counts, { hasConversionData: false }).map((stage) => stage.key))
      .toEqual(['entered', 'sent', 'opened', 'clicked'])
    // Defaulting to included, so every existing caller keeps the funnel it had.
    expect(buildFunnelStages(counts).map((stage) => stage.key)).toHaveLength(5)
  })
})
