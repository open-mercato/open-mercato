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
    isChannelSuppressed: jest.fn().mockResolvedValue(false),
    // No preference expressed: the overwhelmingly common case, and the one every other test assumes.
    loadContactPreference: jest.fn().mockResolvedValue(null),
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

  /**
   * The author's hour, and the rule that it outranks the learned one.
   *
   * Two mechanisms proposing an hour for the same message can only be resolved by picking one. A decision beats a
   * guess, so the learned hour must not even be consulted — asserted on the mock, because a version that read
   * both and happened to agree would pass a test that only checked the resulting time.
   */
  test('an authored hour is used, and the learned hour is not even consulted', async () => {
    const handler = emailHandler()
    const preferred = jest.fn().mockResolvedValue(8)
    const effects = makeEffects([handler], { now: morning, resolvePreferredSendHour: preferred })
    const transition = await executeRun(
      run(),
      [step('s1', 'send_email')],
      { frequencyCap: null, quietHours: null, optimizeSendTime: true, sendHour: 19 },
      deps,
      effects,
    )
    expect(transition.kind).toBe('waiting')
    if (transition.kind !== 'waiting') return
    expect(transition.reason).toBe('send_time')
    expect(preferred).not.toHaveBeenCalled()
    expect(handler.execute).not.toHaveBeenCalled()
  })

  test('sends now when the authored hour has arrived', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler], { now: morning })
    const transition = await executeRun(
      run(),
      [step('s1', 'send_email')],
      { frequencyCap: null, quietHours: null, sendHour: 8 },
      deps,
      effects,
    )
    expect(transition.kind).toBe('completed')
    expect(handler.execute).toHaveBeenCalledTimes(1)
  })

  /**
   * An authored hour quiet hours forbid is DISCARDED, exactly like a learned one.
   *
   * Pushing it instead is an infinite loop: the proposal recurs every day, so the run parks until the window
   * ends, then proposes the same forbidden hour tomorrow, and `applyTransition` resets the attempt counter on
   * every wait so no retry budget ever catches it. The save rules refuse this combination; quiet hours can be
   * edited afterwards, which is why the net is here too.
   */
  test('an authored hour inside quiet hours is discarded rather than pushed', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler], { now: morning })
    const transition = await executeRun(
      run(),
      [step('s1', 'send_email')],
      { frequencyCap: null, quietHours: { startHour: 22, endHour: 8 }, sendHour: 3 },
      deps,
      effects,
    )
    // 08:30 local is outside the window, so discarding the 03:00 proposal means it goes now.
    expect(transition.kind).toBe('completed')
    expect(handler.execute).toHaveBeenCalledTimes(1)
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

  /**
   * Quiet hours are a promise to the customer; the preferred hour is an optimisation. The optimisation proposes
   * and quiet hours dispose — never the reverse, or an "optimised" send lands at 3am.
   *
   * This test previously asserted that such a send is DEFERRED, which encoded an infinite loop: the deferral
   * landed at 08:00, and the resume at 08:00 proposed 03:00 the next day and deferred again, daily, forever. The
   * correct resolution of the same rule is to discard an optimisation quiet hours forbid, so the message goes at
   * a permitted moment — here, now.
   */
  test('a preferred hour inside quiet hours is discarded, and the send is not deferred to 3am', async () => {
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
    // `morning` is outside the quiet window, so nothing stands between the run and the send.
    expect(transition.kind).toBe('completed')
    expect(handler.execute).toHaveBeenCalledTimes(1)
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

/**
 * Consent, which is a different kind of refusal from every other gate.
 *
 * Quiet hours and the learned send hour say "not yet"; the frequency cap says "not this one". Consent says
 * "not at all", so the message is dropped rather than deferred — deferring something a customer asked not
 * to receive only sends it later.
 */
describe('executeRun — consent', () => {
  test('drops the message when the channel is refused, and records why', async () => {
    const handler = emailHandler()
    const recordSend = jest.fn().mockResolvedValue(undefined)
    const effects = makeEffects([handler], {
      recordSend,
      isChannelSuppressed: jest.fn().mockResolvedValue(true),
    })
    const transition = await executeRun(run(), [step('s1', 'send_email')], noPolicy, deps, effects)

    expect(transition.kind).toBe('completed')
    expect(handler.execute).not.toHaveBeenCalled()
    expect(recordSend).toHaveBeenCalledWith(expect.objectContaining({
      status: 'suppressed',
      suppressionReason: 'unsubscribed',
    }))
    expect(transition.stepLog[0]).toMatchObject({ status: 'skipped', detail: 'unsubscribed' })
  })

  // Permission is checked before timing, or an unsubscribed customer's message would be scheduled for
  // 09:00 tomorrow instead of not being sent at all.
  test('is checked BEFORE quiet hours, so a refused message is not merely deferred', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler], {
      now: new Date('2026-09-28T23:30:00.000Z'),
      isChannelSuppressed: jest.fn().mockResolvedValue(true),
    })
    const transition = await executeRun(
      run(),
      [step('s1', 'send_email')],
      { frequencyCap: null, quietHours: { startHour: 22, endHour: 8 } },
      deps,
      effects,
    )
    // Completed, not waiting: there is nothing to come back for.
    expect(transition.kind).toBe('completed')
    expect(handler.execute).not.toHaveBeenCalled()
  })

  test('a step with no channel is never gated by consent', async () => {
    const handler = tagHandler()
    const isChannelSuppressed = jest.fn().mockResolvedValue(true)
    const effects = makeEffects([handler], { isChannelSuppressed })
    const transition = await executeRun(run(), [step('s1', 'add_tag')], noPolicy, deps, effects)
    expect(transition.kind).toBe('completed')
    expect(handler.execute).toHaveBeenCalledTimes(1)
    expect(isChannelSuppressed).not.toHaveBeenCalled()
  })

  test('sends normally when consent is on record as subscribed or absent', async () => {
    const handler = emailHandler()
    const effects = makeEffects([handler], { isChannelSuppressed: jest.fn().mockResolvedValue(false) })
    const transition = await executeRun(run(), [step('s1', 'send_email')], noPolicy, deps, effects)
    expect(transition.kind).toBe('completed')
    expect(handler.execute).toHaveBeenCalledTimes(1)
  })
})

describe('executeRun — recipient preferences', () => {
  const sender = (): StepHandler<Deps> => ({
    ...tagHandler(),
    type: 'send_email',
    channel: 'email',
    execute: jest.fn().mockResolvedValue({ status: 'done', detail: 'sent' }),
  })

  test('a pause defers the message to when the customer said, at the same step', async () => {
    const pausedUntil = new Date(now.getTime() + 3 * 86_400_000)
    const handler = sender()
    const transition = await executeRun(
      run(),
      [step('s1', 'send_email')],
      noPolicy,
      deps,
      makeEffects([handler], {
        loadContactPreference: jest.fn().mockResolvedValue({ maxPerWeek: null, pausedUntil }),
      }),
    )
    expect(transition.kind).toBe('waiting')
    if (transition.kind === 'waiting') {
      // Deferred, not dropped: a pause is "not now", unlike an unsubscribe.
      expect(transition.reason).toBe('paused')
      expect(transition.resumeAt.getTime()).toBe(pausedUntil.getTime())
      expect(transition.nextStepIndex).toBe(0)
    }
    expect(handler.execute).not.toHaveBeenCalled()
  })

  test('an expired pause does not hold the message back', async () => {
    const handler = sender()
    const transition = await executeRun(
      run(),
      [step('s1', 'send_email')],
      noPolicy,
      deps,
      makeEffects([handler], {
        loadContactPreference: jest.fn().mockResolvedValue({
          maxPerWeek: null,
          pausedUntil: new Date(now.getTime() - 1000),
        }),
      }),
    )
    expect(transition.kind).toBe('completed')
    expect(handler.execute).toHaveBeenCalled()
  })

  test('the recipient own cap drops the message and records why', async () => {
    const recordSend = jest.fn().mockResolvedValue(undefined)
    const handler = sender()
    const transition = await executeRun(
      run(),
      [step('s1', 'send_email')],
      noPolicy,
      deps,
      makeEffects([handler], {
        loadContactPreference: jest.fn().mockResolvedValue({ maxPerWeek: 2, pausedUntil: null }),
        countSendsSince: jest.fn().mockResolvedValue(2),
        recordSend,
      }),
    )
    expect(transition.kind).toBe('completed')
    expect(handler.execute).not.toHaveBeenCalled()
    // Dropped like the campaign cap — a volume limit means this message does not go — and visible in
    // reporting under its own reason rather than the campaign's.
    expect(recordSend).toHaveBeenCalledWith(expect.objectContaining({
      status: 'suppressed',
      suppressionReason: 'preference_cap',
    }))
  })

  test('the recipient cap is measured over their week, not the campaign window', async () => {
    const countSendsSince = jest.fn().mockResolvedValue(0)
    await executeRun(
      run(),
      [step('s1', 'send_email')],
      noPolicy,
      deps,
      makeEffects([sender()], {
        loadContactPreference: jest.fn().mockResolvedValue({ maxPerWeek: 3, pausedUntil: null }),
        countSendsSince,
      }),
    )
    const since = countSendsSince.mock.calls[0][1] as Date
    expect(now.getTime() - since.getTime()).toBe(168 * 3_600_000)
  })

  test('no preference means nothing extra is asked of the database', async () => {
    const countSendsSince = jest.fn().mockResolvedValue(0)
    await executeRun(run(), [step('s1', 'send_email')], noPolicy, deps, makeEffects([sender()], { countSendsSince }))
    // With no cap of either kind there is nothing to count, and a query per send nobody wanted is pure cost.
    expect(countSendsSince).not.toHaveBeenCalled()
  })
})

describe('executeRun — send-time optimisation must terminate', () => {
  const sender = (): StepHandler<Deps> => ({
    ...tagHandler(),
    type: 'send_email',
    channel: 'email',
    execute: jest.fn().mockResolvedValue({ status: 'done', detail: 'sent' }),
  })

  /** Quiet 22:00→08:00 with a customer who usually opens at 3am: the pair that used to deadlock. */
  const nightOwl: SendPolicy = { frequencyCap: null, quietHours: { startHour: 22, endHour: 8 }, optimizeSendTime: true }

  test('a preferred hour inside quiet hours is discarded rather than deferred forever', async () => {
    const handler = sender()
    const effects = makeEffects([handler], {
      resolvePreferredSendHour: jest.fn().mockResolvedValue(3),
      // 09:00 UTC: outside the quiet window, so the message may go now.
      now: new Date('2026-09-29T09:00:00.000Z'),
    })
    const transition = await executeRun(run(), [step('s1', 'send_email')], nightOwl, deps, effects)
    expect(transition.kind).toBe('completed')
    expect(handler.execute).toHaveBeenCalled()
  })

  test('the run still waits for quiet hours themselves, and lands outside them', async () => {
    const handler = sender()
    const at = new Date('2026-09-29T23:00:00.000Z')
    const effects = makeEffects([handler], {
      resolvePreferredSendHour: jest.fn().mockResolvedValue(3),
      now: at,
    })
    const transition = await executeRun(run(), [step('s1', 'send_email')], nightOwl, deps, effects)
    expect(transition.kind).toBe('waiting')
    if (transition.kind === 'waiting') {
      expect(transition.reason).toBe('quiet_hours')
      // 08:00, the first allowed hour — not 03:00, and not a day later.
      expect(transition.resumeAt.getUTCHours()).toBe(8)
      expect(transition.resumeAt.getTime() - at.getTime()).toBeLessThanOrEqual(10 * 3_600_000)
    }
  })

  test('resuming at the allowed hour sends instead of re-deferring', async () => {
    // The second half of the old loop: this is the render the run came back for, and it must not park again.
    const handler = sender()
    const effects = makeEffects([handler], {
      resolvePreferredSendHour: jest.fn().mockResolvedValue(3),
      now: new Date('2026-09-30T08:00:00.000Z'),
    })
    const transition = await executeRun(run(), [step('s1', 'send_email')], nightOwl, deps, effects)
    expect(transition.kind).toBe('completed')
  })

  test('a preferred hour outside quiet hours is still honoured', async () => {
    const handler = sender()
    const effects = makeEffects([handler], {
      resolvePreferredSendHour: jest.fn().mockResolvedValue(14),
      now: new Date('2026-09-29T09:00:00.000Z'),
    })
    const transition = await executeRun(run(), [step('s1', 'send_email')], nightOwl, deps, effects)
    expect(transition.kind).toBe('waiting')
    if (transition.kind === 'waiting') {
      expect(transition.reason).toBe('send_time')
      expect(transition.resumeAt.getUTCHours()).toBe(14)
    }
  })
})

/**
 * What a resume does after somebody edited the campaign the run is parked in.
 *
 * `current_step_index` is a position in the flattened definition, and an edit renumbers it. The run
 * therefore records the step's id and resolves the position from that; when the step is gone there is
 * no correct position to resume at, and guessing one is how a customer gets the wrong message.
 */
describe('resuming after the definition changed', () => {
  test('picks up at the recorded step wherever the edit moved it', async () => {
    const execute = jest.fn().mockResolvedValue({ status: 'done', detail: 'tagged' })
    const steps = [step('inserted', 'add_tag'), step('parked', 'add_tag')]

    const transition = await executeRun(
      // Parked at 'parked', which was index 0 before 'inserted' was added in front of it.
      run({ currentStepIndex: 0, currentStepId: 'parked' }),
      steps,
      noPolicy,
      deps,
      makeEffects([tagHandler(execute)]),
    )

    expect(transition.kind).toBe('completed')
    // Only the parked step ran: the index alone would have run 'inserted' again as well.
    expect(execute).toHaveBeenCalledTimes(1)
    expect(transition.stepLog.map((entry) => entry.stepId)).toEqual(['parked'])
  })

  test('ends the run when the parked step is no longer in the campaign', async () => {
    const execute = jest.fn().mockResolvedValue({ status: 'done', detail: 'tagged' })

    const transition = await executeRun(
      run({ currentStepIndex: 0, currentStepId: 'deleted-step' }),
      [step('somebody-elses-step', 'add_tag')],
      noPolicy,
      deps,
      makeEffects([tagHandler(execute)]),
    )

    expect(transition.kind).toBe('completed')
    // The whole point: the step occupying that position is NOT run.
    expect(execute).not.toHaveBeenCalled()
    expect(transition.stepLog).toHaveLength(1)
    expect(transition.stepLog[0]).toMatchObject({
      stepId: 'deleted-step',
      status: 'skipped',
      detail: 'the step this run was waiting at is no longer in the campaign',
    })
  })

  test('a run with no recorded id still resumes on the index', async () => {
    const execute = jest.fn().mockResolvedValue({ status: 'done', detail: 'tagged' })

    const transition = await executeRun(
      run({ currentStepIndex: 1 }),
      [step('first', 'add_tag'), step('second', 'add_tag')],
      noPolicy,
      deps,
      makeEffects([tagHandler(execute)]),
    )

    expect(transition.kind).toBe('completed')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(transition.stepLog.map((entry) => entry.stepId)).toEqual(['second'])
  })

  test('a wait records the id of the step it will resume at, not only its position', async () => {
    const transition = await executeRun(
      run(),
      [step('w', 'wait', { minutes: 30 }), step('after-the-wait', 'add_tag')],
      noPolicy,
      deps,
      makeEffects([tagHandler()]),
    )

    expect(transition.kind).toBe('waiting')
    if (transition.kind !== 'waiting') return
    expect(transition.nextStepId).toBe('after-the-wait')
    expect(transition.nextStepIndex).toBe(1)
  })
})
