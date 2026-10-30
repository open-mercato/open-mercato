import { mergeRunContext, splitRunContext } from '../run-context'
import type { AutomationContext } from '../engine/types'

/**
 * The partner's text used to be stored in plaintext jsonb that the runs API returns.
 *
 * An inbound hook copies every key posted to it — `readInboundPayload` does not filter — so a first name, a
 * phone number and an address all landed in the run context. Core encrypts the equivalent customer comment;
 * this module had no `encryption.ts` at all.
 *
 * Encrypting `context` whole was the obvious move and does not work: the erasure finds a person's runs with
 * `context ->> 'subjectEntityId'`, and ciphertext cannot answer that. So the free-form half moves to its own
 * column and this boundary keeps the two in step.
 */
const context = (over: Record<string, unknown> = {}): AutomationContext => ({
  tenantId: 't1',
  organizationId: 'o1',
  eventId: 'marketing_automation.inbound.received',
  occurredAt: '2026-10-02T12:00:00.000Z',
  dispatchDepth: 1,
  subjectEntityId: 'cust-1',
  campaignId: 'camp-1',
  runId: 'run-1',
  trigger: {},
  ...over,
} as unknown as AutomationContext)

describe('splitRunContext', () => {
  it('takes the trigger out and leaves everything the SQL needs behind', () => {
    const split = splitRunContext(context({ trigger: { firstName: 'Ada', phone: '+48 600 100 200' } }))
    // The erasure reads this one with `context ->> 'subjectEntityId'`, so it has to stay queryable.
    expect(split.context).toMatchObject({ subjectEntityId: 'cust-1', campaignId: 'camp-1' })
    expect(split.context).not.toHaveProperty('trigger')
    expect(split.triggerContext).toEqual({ firstName: 'Ada', phone: '+48 600 100 200' })
  })

  it('leaves the encrypted column empty rather than storing an empty object', () => {
    expect(splitRunContext(context({ trigger: {} })).triggerContext).toBeNull()
    expect(splitRunContext(context({ trigger: undefined })).triggerContext).toBeNull()
  })

  it('refuses a trigger that is not an object, rather than storing a surprise', () => {
    // A partner can post anything; an array or a string in this slot is not a payload to interpolate from.
    expect(splitRunContext(context({ trigger: ['a', 'b'] })).triggerContext).toBeNull()
    expect(splitRunContext(context({ trigger: 'nope' })).triggerContext).toBeNull()
  })

  it('keeps step patches, which land beside the ids rather than in the trigger', () => {
    const split = splitRunContext(context({ referral: { code: 'ABC12345' } }))
    expect(split.context).toMatchObject({ referral: { code: 'ABC12345' } })
  })
})

describe('mergeRunContext', () => {
  it('puts the halves back together for the engine', () => {
    const merged = mergeRunContext({
      context: { subjectEntityId: 'cust-1', campaignId: 'camp-1' },
      triggerContext: { orderId: 'ord-1' },
    })
    expect(merged).toMatchObject({ subjectEntityId: 'cust-1', trigger: { orderId: 'ord-1' } })
  })

  it('always presents a trigger object, even when the column is empty', () => {
    /**
     * `interpolate` leaves an unresolved placeholder verbatim, so a missing `trigger` would print
     * `{{trigger.orderId}}` into somebody's email rather than nothing.
     */
    expect(mergeRunContext({ context: {}, triggerContext: null }).trigger).toEqual({})
    expect(mergeRunContext({ context: {} }).trigger).toEqual({})
  })

  it('round-trips, so nothing above the database notices the split', () => {
    const original = context({ trigger: { firstName: 'Ada' }, referral: { code: 'X' } })
    const stored = splitRunContext(original)
    expect(mergeRunContext(stored)).toEqual(original)
  })

  it('does not let the column shadow a real context key', () => {
    // `trigger` is the only key the split owns; everything else comes from the queryable half.
    const merged = mergeRunContext({
      context: { subjectEntityId: 'cust-1', trigger: { stale: true } },
      triggerContext: { fresh: true },
    })
    expect(merged.trigger).toEqual({ fresh: true })
  })
})
