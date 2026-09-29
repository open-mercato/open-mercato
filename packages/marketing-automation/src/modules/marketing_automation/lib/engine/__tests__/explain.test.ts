import { explainDelivery } from '../explain'
import type { SubjectDocument } from '../types'

/**
 * "Why didn't this customer get it?" — the question support is actually asked.
 *
 * Every gate here already existed on the send path; what this function adds is asking them out of band and
 * reporting which one DECIDED. The ordering is the whole value: two gates are often both unhappy, and only the
 * first of them is the answer somebody should go and fix.
 */
const NOW = new Date('2026-09-29T03:00:00.000Z')

const subject = (overrides: Partial<SubjectDocument> = {}): SubjectDocument => ({
  customer: { id: 'c1', email: 'a@example.com', displayName: 'Ada', createdAt: null, locale: null },
  tags: [],
  orders: { count: 3, totalGross: 300, skus: [], categories: [], channels: [] },
  rfm: null,
  value: null,
  score: { points: 0, tier: null, tierRank: -1 },
  address: null,
  survey: { nps: null, answeredAt: null },
  engagement: { sent: 0, opened: 0, clicked: 0 },
  segments: [],
  trigger: {},
  ...overrides,
})

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

const facts = (overrides: Partial<Parameters<typeof explainDelivery>[0]['facts']> = {}) => ({
  suppressed: false,
  preference: null,
  sentInCampaignWindow: 0,
  sentInPreferenceWindow: 0,
  timeZone: 'UTC',
  ...overrides,
})

const explain = (
  args: Partial<Parameters<typeof explainDelivery>[0]> = {},
) => explainDelivery({
  subject: subject(),
  audience: null,
  policy: { frequencyCap: null, quietHours: null },
  facts: facts(),
  now: NOW,
  logger,
  ...args,
})

describe('explainDelivery', () => {
  test('says plainly when the message would go out', () => {
    const answer = explain()
    expect(answer.wouldSend).toBe(true)
    expect(answer.decidedBy).toBeNull()
    expect(answer.gates.every((gate) => gate.outcome === 'pass')).toBe(true)
  })

  test('names the audience when the customer is simply not in it', () => {
    const answer = explain({
      audience: { operator: 'AND', rules: [{ field: 'orders.count', operator: '>=', value: 99 }] } as never,
    })
    expect(answer.wouldSend).toBe(false)
    expect(answer.decidedBy).toBe('audience')
  })

  /**
   * The ordering test, and the reason this function exists rather than a list of booleans.
   *
   * This customer is unsubscribed AND it is 3am for them. Both gates are unhappy; only consent is the answer,
   * because permission comes before scheduling and a refused message is dropped rather than deferred. Reporting
   * quiet hours here would send somebody to change a send window for a customer who has asked to be left alone.
   */
  test('consent decides over timing, and nothing below it gets the credit', () => {
    const answer = explain({
      policy: { frequencyCap: null, quietHours: { startHour: 21, endHour: 8 } },
      facts: facts({ suppressed: true }),
    })
    expect(answer.decidedBy).toBe('consent')
    const quiet = answer.gates.find((gate) => gate.gate === 'quietHours')
    // Still reported, because it is true and worth seeing — just not decisive.
    expect(quiet?.outcome).toBe('defer')
    expect(quiet?.decisive).toBe(false)
  })

  test('a deferral is not a send', () => {
    const answer = explain({ policy: { frequencyCap: null, quietHours: { startHour: 21, endHour: 8 } } })
    expect(answer.wouldSend).toBe(false)
    expect(answer.decidedBy).toBe('quietHours')
    // "They will get it at 8am" is a different answer from "they got it", and the shape says which.
    expect(answer.gates.find((gate) => gate.gate === 'quietHours')?.outcome).toBe('defer')
  })

  test('the customer own cap and the campaign cap are separate answers', () => {
    const own = explain({
      facts: facts({
        preference: { maxPerWeek: 1, pausedUntil: null } as never,
        sentInPreferenceWindow: 1,
      }),
    })
    expect(own.decidedBy).toBe('preferenceCap')

    const campaign = explain({
      policy: { frequencyCap: { maxMessages: 2, windowDays: 7 }, quietHours: null },
      facts: facts({ sentInCampaignWindow: 2 }),
    })
    expect(campaign.decidedBy).toBe('frequencyCap')
  })

  test('a pause defers rather than drops, because it means "not now"', () => {
    const answer = explain({
      facts: facts({
        preference: { maxPerWeek: null, pausedUntil: new Date('2026-12-01T00:00:00.000Z') } as never,
      }),
    })
    expect(answer.decidedBy).toBe('pause')
    expect(answer.gates.find((gate) => gate.gate === 'pause')?.outcome).toBe('defer')
  })

  test('every gate is reported, so a screen can show the whole chain', () => {
    const answer = explain()
    expect(answer.gates.map((gate) => gate.gate)).toEqual([
      'audience', 'consent', 'pause', 'preferenceCap', 'quietHours', 'frequencyCap',
    ])
  })

  test('the detail carries what somebody would need to fix it', () => {
    const answer = explain({
      policy: { frequencyCap: { maxMessages: 2, windowDays: 7 }, quietHours: { startHour: 21, endHour: 8 } },
      facts: facts({ sentInCampaignWindow: 5, timeZone: 'Europe/Warsaw' }),
    })
    const quiet = answer.gates.find((gate) => gate.gate === 'quietHours')
    // The local hour, not ours: a window of 21–08 means nothing without knowing where the customer is.
    expect(quiet?.detail?.timeZone).toBe('Europe/Warsaw')
    expect(typeof quiet?.detail?.localHour).toBe('number')
    const cap = answer.gates.find((gate) => gate.gate === 'frequencyCap')
    expect(cap?.detail).toMatchObject({ limit: 2, sent: 5 })
  })

  test('an unusable timezone is reported as UTC rather than failing', () => {
    const answer = explain({ facts: facts({ timeZone: 'Mars/Olympus' }) })
    expect(answer.gates.find((gate) => gate.gate === 'quietHours')?.detail?.timeZone).toBe('UTC')
  })
})
