const resumeRun = jest.fn()
const expireOccurrenceKeys = jest.fn()
const findDueRunIds = jest.fn()
const applyDeliverabilityGuardrails = jest.fn()
const announceBreaker = jest.fn()
const reportError = jest.fn()

jest.mock('../../lib/dispatcher.js', () => ({ resumeRun: (...a: unknown[]) => resumeRun(...a) }))
jest.mock('../../lib/runs.js', () => ({
  expireOccurrenceKeys: (...a: unknown[]) => expireOccurrenceKeys(...a),
  findDueRunIds: (...a: unknown[]) => findDueRunIds(...a),
}))
jest.mock('../../lib/deliverability.js', () => ({
  applyDeliverabilityGuardrails: (...a: unknown[]) => applyDeliverabilityGuardrails(...a),
  announceBreaker: (...a: unknown[]) => announceBreaker(...a),
}))
jest.mock('../../lib/job-runs.js', () => ({
  recordJobRun: (_em: unknown, _scope: unknown, _input: unknown, work: () => Promise<unknown>) => work(),
}))
jest.mock('@open-mercato/telemetry', () => ({ reportError: (...a: unknown[]) => reportError(...a) }))

import handle from '../resume'

/**
 * The deliverability breaker's only caller in this phase: the due-run scan's periodic pass.
 *
 * The breaker's real sweep caller lands in a later phase, per the module's phasing plan — but nothing in this
 * phase may ship it as dead code. The periodic branch already does scope-wide housekeeping
 * (`expireOccurrenceKeys`), so the breaker rides the same pass rather than waiting on a sweep worker that does
 * not exist yet.
 */

const scope = { tenantId: 't1', organizationId: 'o1' }

function buildCtx() {
  return {
    resolve: jest.fn((name: string) => (name === 'em' ? {} : undefined)),
    container: { resolve: jest.fn() },
  } as unknown as Parameters<typeof handle>[1]
}

beforeEach(() => {
  jest.clearAllMocks()
  expireOccurrenceKeys.mockResolvedValue(0)
  findDueRunIds.mockResolvedValue([])
  applyDeliverabilityGuardrails.mockResolvedValue([])
})

describe('the periodic due-run scan', () => {
  it('runs the deliverability breaker and announces every campaign it trips', async () => {
    const outcome = {
      campaignId: 'camp-1',
      campaignName: 'Camp',
      decision: { trip: true as const, failureRate: 0.5, attempts: 20 },
    }
    applyDeliverabilityGuardrails.mockResolvedValue([outcome])
    const ctx = buildCtx()

    await handle({ payload: { scope } } as never, ctx)

    expect(applyDeliverabilityGuardrails).toHaveBeenCalledWith(expect.anything(), ctx.container, scope, expect.any(Date))
    expect(announceBreaker).toHaveBeenCalledWith(ctx.container, scope, outcome)
  })

  it('does not let a failing breaker scan abort the due-run scan', async () => {
    applyDeliverabilityGuardrails.mockRejectedValue(new Error('boom'))
    findDueRunIds.mockResolvedValue(['run-1'])
    resumeRun.mockResolvedValue('resumed')
    const ctx = buildCtx()

    await handle({ payload: { scope } } as never, ctx)

    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: 'marketing_automation.deliverability_scan_failed' }),
    )
    expect(resumeRun).toHaveBeenCalledWith('run-1', expect.anything())
  })

  it('does not let a failing notification abort the scan either', async () => {
    const outcome = {
      campaignId: 'camp-1',
      campaignName: 'Camp',
      decision: { trip: true as const, failureRate: 0.5, attempts: 20 },
    }
    applyDeliverabilityGuardrails.mockResolvedValue([outcome])
    announceBreaker.mockRejectedValue(new Error('notification down'))
    findDueRunIds.mockResolvedValue([])
    const ctx = buildCtx()

    await expect(handle({ payload: { scope } } as never, ctx)).resolves.toBeUndefined()

    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: 'marketing_automation.deliverability_announce_failed' }),
    )
  })

  it('leaves the targeted runId path untouched by the breaker', async () => {
    resumeRun.mockResolvedValue('resumed')
    const ctx = buildCtx()

    await handle({ payload: { runId: 'run-1', scope } } as never, ctx)

    expect(applyDeliverabilityGuardrails).not.toHaveBeenCalled()
    expect(resumeRun).toHaveBeenCalledWith('run-1', expect.anything())
  })
})
