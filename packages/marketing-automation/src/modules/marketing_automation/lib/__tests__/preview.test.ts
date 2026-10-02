import { previewJourney } from '../preview'
import type { ExecutorSideEffects } from '../engine/executor'
import type { AutomationContext, CampaignStep, StepHandler } from '../engine/types'
import type { StepHandler as Handler } from '../engine/registry'

type Deps = Record<string, never>

const now = new Date('2026-09-28T09:00:00.000Z')
const context = {
  tenantId: 't1',
  organizationId: 'o1',
  eventId: 'sales.order.created',
  occurredAt: now.toISOString(),
  dispatchDepth: 1,
  subjectEntityId: 'c1',
  campaignId: 'camp-1',
  trigger: {},
} as AutomationContext

const step = (id: string, type: string, params: Record<string, unknown> = {}): CampaignStep => ({ id, type, params })

function handler(type: string, channel?: 'email', execute = jest.fn().mockResolvedValue({ status: 'done' })): Handler<Deps> {
  return {
    type,
    labelKey: 'x',
    channel,
    paramsSchema: { parse: (value: unknown) => value } as never,
    uiFields: [],
    execute,
  }
}

function effectsFor(handlers: Handler<Deps>[], over: Partial<ExecutorSideEffects<Deps>> = {}): ExecutorSideEffects<Deps> {
  const byType = new Map(handlers.map((entry) => [entry.type, entry]))
  return {
    getStep: (type) => byType.get(type),
    countSendsSince: jest.fn().mockResolvedValue(0),
    recordSend: jest.fn().mockResolvedValue(undefined),
    isChannelSuppressed: jest.fn().mockResolvedValue(false),
    loadContactPreference: jest.fn().mockResolvedValue(null),
    resolveTimeZone: jest.fn().mockResolvedValue('UTC'),
    resolvePreferredSendHour: jest.fn().mockResolvedValue(null),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    now,
    ...over,
  }
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const noPolicy = { frequencyCap: null, quietHours: null }

const preview = (steps: CampaignStep[], effects: ExecutorSideEffects<Deps>, policy = noPolicy, entered = true) =>
  previewJourney(
    { campaignId: 'camp-1', subjectEntityId: 'c1', context, steps, policy, entered, now, variantChoices: {} },
    { deps: {} as Deps, effects, logger },
  )

describe('previewJourney', () => {
  test('says so plainly when the audience would turn the customer away', async () => {
    const result = await preview([step('s1', 'send_email')], effectsFor([handler('send_email', 'email')]), noPolicy, false)
    expect(result).toMatchObject({ entered: false, entries: [], endsAt: null })
  })

  test('lists every step with the channel it would send on', async () => {
    const result = await preview(
      [step('s1', 'send_email'), step('s2', 'add_tag')],
      effectsFor([handler('send_email', 'email'), handler('add_tag')]),
    )
    expect(result.entries).toEqual([
      expect.objectContaining({ kind: 'step', stepId: 's1', status: 'done', channel: 'email' }),
      expect.objectContaining({ kind: 'step', stepId: 's2', status: 'done', channel: null }),
    ])
    expect(result.stoppedBecause).toBe('completed')
  })

  // The whole point: it follows the waits instead of stopping at the first one, so an author sees the
  // last message's date without doing the arithmetic.
  test('follows waits and predicts when each later step happens', async () => {
    const steps = [
      step('s1', 'send_email'),
      step('w1', 'wait', { minutes: 60 * 24 }),
      step('s2', 'send_email'),
    ]
    const result = await preview(steps, effectsFor([handler('send_email', 'email'), handler('wait')]))
    // The wait itself appears as a PAUSE with a reason, not as a gap somebody has to interpret.
    expect(result.entries.map((entry) => entry.kind)).toEqual(['step', 'pause', 'step'])
    const pause = result.entries[1]
    expect(pause.kind === 'pause' ? pause.reason : null).toBe('wait')
    const last = result.entries[2]
    expect(new Date(last.at).getTime() - now.getTime()).toBeGreaterThanOrEqual(86_400_000)
    expect(result.endsAt).toBe(last.at)
    expect(result.stoppedBecause).toBe('completed')
  })

  // Nothing may be written: a preview that recorded sends would count against the very cap it explains.
  test('records nothing', async () => {
    const recordSend = jest.fn()
    await preview([step('s1', 'send_email')], effectsFor([handler('send_email', 'email')], { recordSend }))
    expect(recordSend).not.toHaveBeenCalled()
  })

  test('never calls the real step handler', async () => {
    const execute = jest.fn()
    await preview([step('s1', 'send_email')], effectsFor([handler('send_email', 'email', execute)]))
    expect(execute).not.toHaveBeenCalled()
  })

  // The gates are the reason a preview is worth having, so they must apply — including the ones that
  // move a timestamp rather than blocking it.
  test('quiet hours push a send later, and the preview shows the later time', async () => {
    const quiet = { frequencyCap: null, quietHours: { startHour: 8, endHour: 12 } }
    const result = await preview([step('s1', 'send_email')], effectsFor([handler('send_email', 'email')]), quiet)
    // The deferral is reported with its own reason, so the author can tell it from a wait they placed.
    const pause = result.entries.find((entry) => entry.kind === 'pause')
    expect(pause && pause.kind === 'pause' ? pause.reason : null).toBe('quiet_hours')
    const send = result.entries.find((entry) => entry.kind === 'step' && entry.stepId === 's1')
    expect(send).toBeTruthy()
    // 09:00 is inside 08:00-12:00, so the send lands at or after 12:00.
    expect(new Date(send!.at).getUTCHours()).toBeGreaterThanOrEqual(12)
  })

  test('the frequency cap shows as a skipped step rather than a missing one', async () => {
    const capped = { frequencyCap: { maxMessages: 1, windowHours: 24 }, quietHours: null }
    const result = await preview(
      [step('s1', 'send_email')],
      effectsFor([handler('send_email', 'email')], { countSendsSince: jest.fn().mockResolvedValue(5) }),
      capped,
    )
    expect(result.entries).toEqual([
      expect.objectContaining({ kind: 'step', stepId: 's1', status: 'skipped', detail: 'frequency cap' }),
    ])
  })

  test('stops at the horizon rather than simulating forever', async () => {
    const steps = [step('w1', 'wait', { minutes: 60 * 24 * 400 }), step('s1', 'send_email')]
    const result = await preview(steps, effectsFor([handler('send_email', 'email'), handler('wait')]))
    expect(result.stoppedBecause).toBe('horizon')
  })

  test('carries the lane assignment through, so the author knows which variant they are seeing', async () => {
    const result = await previewJourney(
      {
        campaignId: 'camp-1', subjectEntityId: 'c1', context,
        steps: [step('s1', 'send_email')], policy: noPolicy, entered: true, now,
        variantChoices: { sp1: 'b' },
      },
      { deps: {} as Deps, effects: effectsFor([handler('send_email', 'email')]), logger },
    )
    expect(result.variantChoices).toEqual({ sp1: 'b' })
  })
})
