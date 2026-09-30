const addScoreEntry = jest.fn()
const emitMarketingAutomationEvent = jest.fn()
const ensureReferralCode = jest.fn()
const loadReferralUrlTemplate = jest.fn()
const decideAssignment = jest.fn()

jest.mock('../../lib/scores.js', () => ({ addScoreEntry: (...a: unknown[]) => addScoreEntry(...a) }))
jest.mock('../../events.js', () => ({
  emitMarketingAutomationEvent: (...a: unknown[]) => emitMarketingAutomationEvent(...a),
}))
jest.mock('../../lib/referrals.js', () => ({
  ensureReferralCode: (...a: unknown[]) => ensureReferralCode(...a),
  loadReferralUrlTemplate: (...a: unknown[]) => loadReferralUrlTemplate(...a),
}))
jest.mock('../../lib/lead-routing.js', () => ({ decideAssignment: (...a: unknown[]) => decideAssignment(...a) }))

import { addPointsStep } from '../add-points'
import { addTagStep } from '../add-tag'
import { issueReferralCodeStep } from '../issue-referral-code'
import type { AutomationContext } from '../../lib/engine/types'

/**
 * What each step does, and what it refuses to do.
 *
 * Four of the ten step handlers had no unit test. They are short, but they are the only code in this module
 * whose output a customer sees or whose write another module has to live with — and every one of them has a
 * skip path that only fires in a state the integration suite does not construct.
 */
const scope = { tenantId: 't1', organizationId: 'o1' }
const ctx = (over: Partial<AutomationContext> = {}): AutomationContext => ({
  tenantId: 't1', organizationId: 'o1', eventId: 'e', occurredAt: '2026-09-30T00:00:00.000Z',
  dispatchDepth: 1, subjectEntityId: 'cust-1', campaignId: 'camp-1', runId: 'run-1', actionId: 'step-1',
  trigger: {}, ...over,
} as AutomationContext)

const execute = jest.fn()
const deps = {
  em: {} as never,
  container: { resolve: () => ({ execute }) } as never,
  scope,
  now: new Date('2026-09-30T12:00:00.000Z'),
  commandContext: { systemActor: true } as never,
} as never

beforeEach(() => {
  for (const fn of [addScoreEntry, emitMarketingAutomationEvent, ensureReferralCode, loadReferralUrlTemplate, decideAssignment, execute]) fn.mockReset()
  addScoreEntry.mockResolvedValue({ applied: true, points: 12, previousPoints: 5 })
  ensureReferralCode.mockResolvedValue('ABC12345')
  loadReferralUrlTemplate.mockResolvedValue(null)
  execute.mockResolvedValue(undefined)
})

describe('add_points', () => {
  it('awards the points and says the new total', async () => {
    const result = await addPointsStep.execute(ctx(), { points: 7, reason: 'test' }, deps)
    expect(result).toMatchObject({ status: 'done', detail: '+7 points (12 total)' })
  })

  it('signs the detail, so a deduction reads as one', async () => {
    const result = await addPointsStep.execute(ctx(), { points: -3 }, deps)
    expect(result.detail).toBe('-3 points (12 total)')
  })

  it('refuses zero at the schema, because it is a step that does nothing', async () => {
    await expect(addPointsStep.execute(ctx(), { points: 0 }, deps)).rejects.toThrow()
  })

  it('is idempotent: a redelivered job collides instead of scoring twice', async () => {
    addScoreEntry.mockResolvedValue({ applied: false, points: 12, previousPoints: 12 })
    const result = await addPointsStep.execute(ctx(), { points: 7 }, deps)
    // `done`, not `skipped`: the points ARE awarded, just not by this delivery.
    expect(result).toMatchObject({ status: 'done', detail: 'points already awarded for this step' })
    expect(emitMarketingAutomationEvent).not.toHaveBeenCalled()
  })

  it('carries the PREVIOUS total on the event, which is what makes "reached 100" expressible', async () => {
    await addPointsStep.execute(ctx(), { points: 7 }, deps)
    const [eventId, payload] = emitMarketingAutomationEvent.mock.calls[0]
    expect(eventId).toBe('marketing_automation.customer.score_changed')
    /**
     * Without `previousPoints` an audience can only say "is above 100", which is true on every later change.
     * With it, "crossed 100" is expressible — and that fires once.
     */
    expect(payload).toMatchObject({ points: 12, previousPoints: 5, delta: 7 })
  })

  it('skips a run with no subject rather than failing it', async () => {
    const result = await addPointsStep.execute(ctx({ subjectEntityId: null }), { points: 7 }, deps)
    expect(result).toMatchObject({ status: 'skipped' })
    expect(addScoreEntry).not.toHaveBeenCalled()
  })
})

describe('add_tag', () => {
  it('goes through the customers command rather than writing a tag itself', async () => {
    // No new tag storage: the whole point is that this module does not own tags.
    const result = await addTagStep.execute(ctx(), { tagId: '11111111-1111-4111-8111-111111111111' }, deps)
    expect(execute.mock.calls[0][0]).toBe('customers.tags.assign')
    expect(execute.mock.calls[0][1].input).toMatchObject({ tagId: '11111111-1111-4111-8111-111111111111', entityId: 'cust-1', ...scope })
    expect(result).toMatchObject({ status: 'done' })
  })

  it('treats an already-present tag as done, not as a failure', async () => {
    // Re-running a journey must not dead-letter on a tag the customer already has.
    // `customers.tags.assign` answers 409 when the tag is already there, which for an automation is the
    // desired end state rather than a failure.
    execute.mockRejectedValue(Object.assign(new Error('Tag already assigned'), { status: 409 }))
    const result = await addTagStep.execute(ctx(), { tagId: '11111111-1111-4111-8111-111111111111' }, deps)
    expect(result).toMatchObject({ status: 'done', detail: 'tag already present' })
  })

  it('lets an unrelated failure through, so the run can retry', async () => {
    execute.mockRejectedValue(new Error('connection lost'))
    await expect(addTagStep.execute(ctx(), { tagId: '11111111-1111-4111-8111-111111111111' }, deps)).rejects.toThrow('connection lost')
  })

  it('skips a run with no subject', async () => {
    const result = await addTagStep.execute(ctx({ subjectEntityId: null }), { tagId: '11111111-1111-4111-8111-111111111111' }, deps)
    expect(result).toMatchObject({ status: 'skipped' })
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('issue_referral_code', () => {
  it('returns the code as a contextPatch, not by mutating the context', async () => {
    /**
     * The executor hands every step a fresh `{ ...context }` copy, so assigning to `ctx` writes to a
     * throwaway object. That is not a style point: it is why a campaign once mailed customers the literal
     * text `{{referral.code}}`.
     */
    const result = await issueReferralCodeStep.execute(ctx(), {}, deps)
    expect(result).toMatchObject({ status: 'done', contextPatch: { referral: { code: 'ABC12345' } } })
  })

  it('adds the url only when a template is configured', async () => {
    loadReferralUrlTemplate.mockResolvedValue('https://shop.example/r/{code}')
    const result = await issueReferralCodeStep.execute(ctx(), {}, deps)
    expect((result.contextPatch as { referral: { url?: string } }).referral.url).toBe('https://shop.example/r/ABC12345')
  })

  it('omits the url rather than inventing one when no template is set', async () => {
    const result = await issueReferralCodeStep.execute(ctx(), {}, deps)
    expect((result.contextPatch as { referral: Record<string, unknown> }).referral).not.toHaveProperty('url')
  })

  it('skips a run with no subject', async () => {
    const result = await issueReferralCodeStep.execute(ctx({ subjectEntityId: null }), {}, deps)
    expect(result).toMatchObject({ status: 'skipped' })
    expect(ensureReferralCode).not.toHaveBeenCalled()
  })
})
