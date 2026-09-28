import { executeRun } from '../executor'
import type { ExecutorSideEffects, RunState, SendPolicy } from '../executor'
import type { StepHandler } from '../registry'
import type { AutomationContext, CampaignStep } from '../types'

type Deps = { marker: 'deps' }
const deps: Deps = { marker: 'deps' }
const now = new Date('2026-09-28T12:00:00.000Z')

const context: AutomationContext = {
  tenantId: 't1',
  organizationId: 'o1',
  eventId: 'sales.order.created',
  occurredAt: now.toISOString(),
  dispatchDepth: 0,
  subjectEntityId: 'c1',
}

const run = (over: Partial<RunState> = {}): RunState => ({
  id: 'run-1',
  campaignId: 'camp-1',
  currentStepIndex: 0,
  stepLog: [],
  context,
  subjectEntityId: 'c1',
  ...over,
})

const step = (id: string, type: string, params: Record<string, unknown> = {}): CampaignStep => ({ id, type, params })

const noPolicy: SendPolicy = { frequencyCap: null, quietHours: null }

function makeEffects(handlers: StepHandler<Deps>[], over: Partial<ExecutorSideEffects<Deps>> = {}) {
  const byType = new Map(handlers.map((h) => [h.type, h]))
  const effects: ExecutorSideEffects<Deps> = {
    getStep: (type) => byType.get(type),
    countSendsSince: jest.fn().mockResolvedValue(0),
    recordSend: jest.fn().mockResolvedValue(undefined),
    resolveTimeZone: jest.fn().mockResolvedValue('UTC'),
    resolvePreferredSendHour: jest.fn().mockResolvedValue(null),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    now,
    ...over,
  }
  return effects
}

const tagHandler = (execute = jest.fn().mockResolvedValue({ status: 'done', detail: 'tagged' })): StepHandler<Deps> => ({
  type: 'add_tag',
  labelKey: 'x',
  paramsSchema: { parse: (v: unknown) => v } as never,
  uiFields: [],
  execute,
})

const emailHandler = (execute = jest.fn().mockResolvedValue({ status: 'done' })): StepHandler<Deps> => ({
  type: 'send_email',
  labelKey: 'x',
  channel: 'email',
  paramsSchema: { parse: (v: unknown) => v } as never,
  uiFields: [],
  execute,
})

describe('executeRun — completion', () => {
  test('runs every step and completes', async () => {
    const handler = tagHandler()
    const transition = await executeRun(run(), [step('s1', 'add_tag'), step('s2', 'add_tag')], noPolicy, deps, makeEffects([handler]))
    expect(handler.execute).toHaveBeenCalledTimes(2)
    expect(transition.kind).toBe('completed')
    expect(transition.stepLog.map((o) => [o.stepId, o.status])).toEqual([['s1', 'done'], ['s2', 'done']])
  })

  test('an empty step list completes immediately', async () => {
    const transition = await executeRun(run(), [], noPolicy, deps, makeEffects([]))
    expect(transition).toMatchObject({ kind: 'completed', stepLog: [] })
  })

  test('a step patch is visible to later steps', async () => {
    const first: StepHandler<Deps> = { ...tagHandler(), type: 'first', execute: jest.fn().mockResolvedValue({ status: 'done', contextPatch: { couponCode: 'X1' } }) }
    const second = tagHandler()
    const transition = await executeRun(run(), [step('s1', 'first'), step('s2', 'add_tag')], noPolicy, deps, makeEffects([first, second]))
    expect(second.execute).toHaveBeenCalledWith(expect.objectContaining({ couponCode: 'X1' }), {}, deps)
    expect(transition.context.couponCode).toBe('X1')
  })

  // A step type vanishes when the module contributing it is disabled. Stopping the journey
  // would punish the customer for an installation change, so the step is skipped and logged.
  test('an unknown step type is skipped and the rest still runs', async () => {
    const handler = tagHandler()
    const effects = makeEffects([handler])
    const transition = await executeRun(run(), [step('s1', 'from_disabled_module'), step('s2', 'add_tag')], noPolicy, deps, effects)
    expect(transition.kind).toBe('completed')
    expect(transition.stepLog.map((o) => o.status)).toEqual(['skipped', 'done'])
    expect(effects.logger.warn).toHaveBeenCalledTimes(1)
  })

  // The executor reports the failure instead of throwing, and says WHICH step failed. Without the
  // index the caller parks the run where it already was, so a retry replays the steps that already
  // succeeded — for a chain containing a send, that mails the customer again on every attempt.
  test('a thrown step is reported as failed at its own index, with progress kept', async () => {
    const ok = tagHandler()
    const boom: StepHandler<Deps> = { ...tagHandler(), type: 'boom', execute: jest.fn().mockRejectedValue(new Error('smtp down')) }
    const steps = [step('s1', 'add_tag'), step('s2', 'boom'), step('s3', 'add_tag')]

    const transition = await executeRun(run(), steps, noPolicy, deps, makeEffects([ok, boom]))

    expect(transition.kind).toBe('failed')
    if (transition.kind !== 'failed') throw new Error('expected a failed transition')
    expect(transition.failedIndex).toBe(1)
    expect((transition.error as Error).message).toBe('smtp down')
    // The step that succeeded before the failure stays in the log, and the one after it never ran.
    expect(transition.stepLog.map((entry) => [entry.stepId, entry.status])).toEqual([
      ['s1', 'done'],
      ['s2', 'failed'],
    ])
    expect(ok.execute).toHaveBeenCalledTimes(1)
  })

  test('resuming at the reported index repeats only the failed step', async () => {
    const ok = tagHandler()
    const steps = [step('s1', 'add_tag'), step('s2', 'add_tag'), step('s3', 'add_tag')]
    const transition = await executeRun(run({ currentStepIndex: 1 }), steps, noPolicy, deps, makeEffects([ok]))
    expect(transition.kind).toBe('completed')
    expect(ok.execute).toHaveBeenCalledTimes(2)
  })
})

describe('executeRun — wait', () => {
  test('parks the run AFTER the wait step', async () => {
    const handler = tagHandler()
    const steps = [step('s1', 'add_tag'), step('w1', 'wait', { minutes: 60 }), step('s2', 'add_tag')]
    const transition = await executeRun(run(), steps, noPolicy, deps, makeEffects([handler]))
    expect(transition).toMatchObject({
      kind: 'waiting',
      reason: 'wait',
      nextStepIndex: 2,
      resumeAt: new Date('2026-09-28T13:00:00.000Z'),
    })
    expect(handler.execute).toHaveBeenCalledTimes(1)
  })

  test('resuming from the parked index runs the remainder', async () => {
    const handler = tagHandler()
    const steps = [step('s1', 'add_tag'), step('w1', 'wait', { minutes: 60 }), step('s2', 'add_tag')]
    const transition = await executeRun(run({ currentStepIndex: 2 }), steps, noPolicy, deps, makeEffects([handler]))
    expect(transition.kind).toBe('completed')
    expect(handler.execute).toHaveBeenCalledTimes(1)
  })
})

describe('executeRun — quiet hours', () => {
  const policy: SendPolicy = { frequencyCap: null, quietHours: { startHour: 21, endHour: 8 } }

  // The opposite of a wait: the message has NOT gone out, so the run must resume at the same
  // step. Resuming after it would silently drop the send.
  test('defers at the same step index rather than after it', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler], { now: new Date('2026-09-28T23:30:00.000Z') })
    const transition = await executeRun(run(), [step('s1', 'send_email')], policy, deps, effects)
    expect(transition).toMatchObject({ kind: 'waiting', reason: 'quiet_hours', nextStepIndex: 0 })
    expect(handler.execute).not.toHaveBeenCalled()
    expect(effects.recordSend).not.toHaveBeenCalled()
  })

  test('sends normally outside the quiet window', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler])
    const transition = await executeRun(run(), [step('s1', 'send_email')], policy, deps, effects)
    expect(transition.kind).toBe('completed')
    expect(handler.execute).toHaveBeenCalledTimes(1)
  })

  test('quiet hours are evaluated in the subject timezone, not the server one', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler], {
      now: new Date('2026-09-28T19:30:00.000Z'), // 21:30 in Warsaw
      resolveTimeZone: jest.fn().mockResolvedValue('Europe/Warsaw'),
    })
    const transition = await executeRun(run(), [step('s1', 'send_email')], policy, deps, effects)
    expect(transition.kind).toBe('waiting')
  })

  test('a non-sending step is not subject to quiet hours', async () => {
    const handler = tagHandler()
    const effects = makeEffects([handler], { now: new Date('2026-09-28T23:30:00.000Z') })
    const transition = await executeRun(run(), [step('s1', 'add_tag')], policy, deps, effects)
    expect(transition.kind).toBe('completed')
    expect(effects.resolveTimeZone).not.toHaveBeenCalled()
  })
})

describe('executeRun — frequency cap', () => {
  const policy: SendPolicy = { frequencyCap: { maxMessages: 2, windowHours: 24 }, quietHours: null }

  test('sends while under the cap and records the send', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler], { countSendsSince: jest.fn().mockResolvedValue(1) })
    const transition = await executeRun(run(), [step('s1', 'send_email')], policy, deps, effects)
    expect(transition.kind).toBe('completed')
    expect(effects.recordSend).toHaveBeenCalledWith({ channel: 'email', status: 'sent', stepId: 's1' })
    // The firing assertion for the PII rule: the recorded entry must carry no address, because the
    // send history is append-only and is not covered by the platform's at-rest encryption.
    const recorded = (effects.recordSend as jest.Mock).mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(recorded)).not.toContain('toAddress')
  })

  // Dropped, not deferred: the point of a cap is that this message does not arrive. Deferring
  // would move the flood later instead of preventing it.
  test('drops the message when capped and records the suppression', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler], { countSendsSince: jest.fn().mockResolvedValue(2) })
    const transition = await executeRun(run(), [step('s1', 'send_email'), step('s2', 'send_email')], policy, deps, effects)
    expect(transition.kind).toBe('completed')
    expect(handler.execute).not.toHaveBeenCalled()
    expect(effects.recordSend).toHaveBeenCalledTimes(2)
    expect(effects.recordSend).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'suppressed', suppressionReason: 'frequency_cap' }))
    expect(transition.stepLog.every((o) => o.status === 'skipped')).toBe(true)
  })

  test('the cap window is measured back from now', async () => {
    const countSendsSince = jest.fn().mockResolvedValue(0)
    await executeRun(run(), [step('s1', 'send_email')], policy, deps, makeEffects([emailHandler()], { countSendsSince }))
    expect(countSendsSince).toHaveBeenCalledWith('c1', new Date('2026-09-27T12:00:00.000Z'))
  })

  test('a skipped send is not recorded as sent', async () => {
    const handler = emailHandler(jest.fn().mockResolvedValue({ status: 'skipped', detail: 'no address' }))
    const effects = makeEffects([handler])
    await executeRun(run(), [step('s1', 'send_email')], policy, deps, effects)
    expect(effects.recordSend).not.toHaveBeenCalled()
  })
})

/**
 * Send-time optimisation, with the gate made to FIRE.
 *
 * `noPolicy` leaves the flag off, so every other test in this file never reaches this branch — which is
 * exactly why it needs tests of its own rather than trusting that the chain is wired.
 */
describe('executeRun — send-time optimisation', () => {
  const at = (iso: string) => new Date(iso)
  // 08:30 UTC, with the subject in UTC so the local hour is 8.
  const morning = at('2026-09-28T08:30:00.000Z')

  test('defers the send to the hour this subject usually opens, at the same step', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler], {
      now: morning,
      resolvePreferredSendHour: jest.fn().mockResolvedValue(19),
    })
    const transition = await executeRun(
      run(),
      [step('s1', 'send_email')],
      { frequencyCap: null, quietHours: null, optimizeSendTime: true },
      deps,
      effects,
    )
    expect(transition.kind).toBe('waiting')
    if (transition.kind !== 'waiting') return
    expect(transition.reason).toBe('send_time')
    // At the same step: the message still goes, later.
    expect(transition.nextStepIndex).toBe(0)
    expect(transition.resumeAt.getTime()).toBeGreaterThan(morning.getTime())
    expect(handler.execute).not.toHaveBeenCalled()
  })

  test('sends now when the preferred hour has arrived', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler], {
      now: morning,
      resolvePreferredSendHour: jest.fn().mockResolvedValue(8),
    })
    const transition = await executeRun(
      run(),
      [step('s1', 'send_email')],
      { frequencyCap: null, quietHours: null, optimizeSendTime: true },
      deps,
      effects,
    )
    expect(transition.kind).toBe('completed')
    expect(handler.execute).toHaveBeenCalledTimes(1)
  })

  test('sends now when there is not enough history to have a preference', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler], {
      now: morning,
      resolvePreferredSendHour: jest.fn().mockResolvedValue(null),
    })
    const transition = await executeRun(
      run(),
      [step('s1', 'send_email')],
      { frequencyCap: null, quietHours: null, optimizeSendTime: true },
      deps,
      effects,
    )
    expect(transition.kind).toBe('completed')
    expect(handler.execute).toHaveBeenCalledTimes(1)
  })

  // Quiet hours are a promise to the customer; the preferred hour is an optimisation. The optimisation
  // proposes and quiet hours dispose — never the reverse, or an "optimised" send lands at 3am.
  test('quiet hours override the preferred hour, never the other way round', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler], {
      now: morning,
      resolvePreferredSendHour: jest.fn().mockResolvedValue(3),
    })
    const transition = await executeRun(
      run(),
      [step('s1', 'send_email')],
      { frequencyCap: null, quietHours: { startHour: 22, endHour: 8 }, optimizeSendTime: true },
      deps,
      effects,
    )
    expect(transition.kind).toBe('waiting')
    if (transition.kind !== 'waiting') return
    // Deferred to a moment OUTSIDE the quiet window, not to 3am.
    const resumeHour = transition.resumeAt.getUTCHours()
    expect(resumeHour >= 22 || resumeHour < 8).toBe(false)
    expect(handler.execute).not.toHaveBeenCalled()
  })

  test('is not consulted at all when the policy did not ask for it', async () => {
    const resolvePreferredSendHour = jest.fn().mockResolvedValue(19)
    const effects = makeEffects([emailHandler()], { now: morning, resolvePreferredSendHour })
    const transition = await executeRun(run(), [step('s1', 'send_email')], noPolicy, deps, effects)
    expect(transition.kind).toBe('completed')
    // A query per send that nobody wanted is pure cost.
    expect(resolvePreferredSendHour).not.toHaveBeenCalled()
  })

  test('a step with no channel is never deferred by a send-time policy', async () => {
    const handler = tagHandler()
    const effects = makeEffects([handler], {
      now: morning,
      resolvePreferredSendHour: jest.fn().mockResolvedValue(19),
    })
    const transition = await executeRun(
      run(),
      [step('s1', 'add_tag')],
      { frequencyCap: null, quietHours: null, optimizeSendTime: true },
      deps,
      effects,
    )
    expect(transition.kind).toBe('completed')
    expect(handler.execute).toHaveBeenCalledTimes(1)
  })
})
