import {
  FAILURE_RATE_THRESHOLD,
  MINIMUM_ATTEMPTS,
  evaluateBreaker,
} from '../engine/deliverability'

describe('evaluateBreaker', () => {
  it('trips when most attempts are being refused', () => {
    const decision = evaluateBreaker({ sent: 10, failed: 30 })
    expect(decision).toEqual({ trip: true, failureRate: 0.75, attempts: 40 })
  })

  it('never trips on a small sample, however bad it looks', () => {
    /**
     * Three failures out of three is a bad afternoon, not a trend — and a guardrail that pauses working
     * campaigns gets switched off, at which point it is not a guardrail.
     */
    expect(evaluateBreaker({ sent: 0, failed: 3 })).toEqual({ trip: false, reason: 'too_few_attempts' })
    expect(evaluateBreaker({ sent: 0, failed: MINIMUM_ATTEMPTS - 1 })).toEqual({ trip: false, reason: 'too_few_attempts' })
  })

  it('trips at exactly the minimum sample once the rate is breached', () => {
    const failed = Math.ceil(MINIMUM_ATTEMPTS * FAILURE_RATE_THRESHOLD)
    const decision = evaluateBreaker({ sent: MINIMUM_ATTEMPTS - failed, failed })
    expect(decision.trip).toBe(true)
  })

  it('leaves a campaign alone while failures are within tolerance', () => {
    // Some failures are normal: a dead mailbox, a full inbox, a typo in an address.
    expect(evaluateBreaker({ sent: 95, failed: 5 })).toEqual({ trip: false, reason: 'within_tolerance' })
  })

  it('reports the rate it decided on, rounded for the message a person reads', () => {
    // The minimum and threshold are OPTIONS, not part of the window — passing them inside the window is how
    // this test first claimed a breach that could not happen.
    const decision = evaluateBreaker({ sent: 2, failed: 1 }, { minimumAttempts: 3, threshold: 0.1 })
    expect(decision.trip).toBe(true)
    if (decision.trip) expect(decision.failureRate).toBe(0.33)
  })

  it('honours an overridden threshold and minimum', () => {
    expect(evaluateBreaker({ sent: 9, failed: 1 }, { minimumAttempts: 5, threshold: 0.05 }).trip).toBe(true)
    expect(evaluateBreaker({ sent: 9, failed: 1 }, { minimumAttempts: 5, threshold: 0.5 }).trip).toBe(false)
  })

  it('does not divide by zero on a campaign that attempted nothing', () => {
    expect(evaluateBreaker({ sent: 0, failed: 0 })).toEqual({ trip: false, reason: 'too_few_attempts' })
  })
})

/**
 * The guardrail as a whole, not just its arithmetic.
 *
 * `evaluateBreaker` was tested from the day it was written; `applyDeliverabilityGuardrails` — the part that
 * actually pauses a campaign — was not, and it could never have worked. It built its command context inline
 * with `auth: null` and no `systemActor`, so `requireScope` had nothing to read from either side and threw
 * 400 on every single trip. The throw escaped before the outcome was recorded, so no campaign was ever
 * paused, no notification was ever sent, and the sweep logged it at `warn` without reporting it.
 *
 * A guardrail nobody is watching is exactly the thing that has to be tested, because the only evidence it is
 * broken is the absence of something nobody expects to see.
 */
describe('applyDeliverabilityGuardrails', () => {
  const scope = { tenantId: 't1', organizationId: 'o1' }

  function harness(rows: Array<{ campaign_id: string; sent: string; failed: string }>) {
    const executed: Array<{ command: string; input: Record<string, unknown>; ctx: Record<string, unknown> }> = []
    const em = {
      getConnection: () => ({ execute: async () => rows }),
      findOne: async (_entity: unknown, where: { id: string }) => ({
        id: where.id,
        name: `Campaign ${where.id}`,
        updatedAt: new Date('2026-09-30T08:00:00.000Z'),
      }),
    }
    const container = {
      resolve: (key: string) => {
        if (key !== 'commandBus') throw new Error(`[internal] unexpected resolve: ${key}`)
        return {
          execute: async (command: string, payload: { input: Record<string, unknown>; ctx: Record<string, unknown> }) => {
            executed.push({ command, input: payload.input, ctx: payload.ctx })
          },
        }
      },
    }
    return { em, container, executed }
  }

  it('pauses the campaign and reports the trip', async () => {
    const { em, container, executed } = harness([{ campaign_id: 'camp-1', sent: '10', failed: '30' }])
    const { applyDeliverabilityGuardrails } = await import('../deliverability')

    const tripped = await applyDeliverabilityGuardrails(em as never, container as never, scope, new Date())

    // The outcome the sweep notifies from. It was always empty, because the command threw first.
    expect(tripped).toHaveLength(1)
    expect(tripped[0]).toMatchObject({ campaignId: 'camp-1', campaignName: 'Campaign camp-1' })

    expect(executed).toHaveLength(1)
    expect(executed[0].command).toBe('marketing_automation.campaigns.set_enabled')
    expect(executed[0].input).toMatchObject({ id: 'camp-1', isEnabled: false })
  })

  it('carries the scope the command needs, on both sides', async () => {
    const { em, container, executed } = harness([{ campaign_id: 'camp-1', sent: '10', failed: '30' }])
    const { applyDeliverabilityGuardrails } = await import('../deliverability')
    await applyDeliverabilityGuardrails(em as never, container as never, scope, new Date())

    /**
     * `requireScope` reads `ctx.auth` first and falls back to the input ONLY for a system actor. There is no
     * authenticated user on a sweep, so both halves are load-bearing: without `systemActor` the fallback
     * never runs, and without the scope in the input there is nothing to fall back to.
     */
    expect(executed[0].ctx).toMatchObject({ systemActor: true, selectedOrganizationId: 'o1' })
    expect(executed[0].input).toMatchObject({ tenantId: 't1', organizationId: 'o1' })
  })

  it('leaves a healthy campaign alone', async () => {
    const { em, container, executed } = harness([{ campaign_id: 'camp-1', sent: '100', failed: '1' }])
    const { applyDeliverabilityGuardrails } = await import('../deliverability')
    expect(await applyDeliverabilityGuardrails(em as never, container as never, scope, new Date())).toEqual([])
    expect(executed).toHaveLength(0)
  })
})
