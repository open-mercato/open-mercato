/**
 * What the ElevenLabs connector reports about a call's COST and DURATION
 * (tracker task 3.2).
 *
 * The connector is the only place in the stack that knows what ElevenLabs' numbers
 * mean, so it is the only place that may convert them. Four things must hold:
 *
 * 1. **Fiat, not credits.** `metadata` carries BOTH `cost_fiat` (documented as
 *    "total fiat cost of the conversation in USD") and `cost` (the credit charge
 *    against the workspace balance). Only the first is money. Reading the second
 *    would report a five-cent call as costing $2.96, silently, in the column the
 *    tenant's spend KPI sums.
 * 2. **Platform units cross the boundary, not provider ones.** Seconds become
 *    milliseconds and dollars become integer cents HERE, so `completeExternalRun`
 *    never learns an ElevenLabs field name.
 * 3. **Absent is not zero.** A payload that reports no cost carries no cost, so
 *    the run row keeps `null` and the cockpit renders `—`. A payload that reports
 *    `0` — a call on free minutes — keeps the zero, which is a different fact.
 * 4. **The agent's OUTCOME contract is untouched.** The usage report is a sibling
 *    of `kind`/`data`, never a field inside the outcome, so nothing a workflow
 *    author maps or a guardrail screens changed shape.
 */

import { normalizeElevenLabsCallback } from '../lib/normalize'
import { voiceCallResultSchema } from '../data/validators'

function transcription(metadata: Record<string, unknown> | null | undefined): unknown {
  return {
    type: 'post_call_transcription',
    data: {
      agent_id: 'agent_abc123',
      conversation_id: 'conv_usage',
      status: 'done',
      transcript: [{ role: 'user', message: 'Yes, go ahead.', time_in_call_secs: 3 }],
      ...(metadata === undefined ? {} : { metadata }),
      analysis: { call_successful: 'success', transcript_summary: 'Approved.' },
    },
  }
}

describe('the usage report on a post_call_transcription', () => {
  it('converts call_duration_secs to milliseconds and cost_fiat to integer cents', () => {
    const result = normalizeElevenLabsCallback(transcription({ call_duration_secs: 74, cost_fiat: 0.19 }))

    expect(result.usage).toEqual({ durationMs: 74_000, costMinor: 19, currency: 'USD' })
  })

  it('reads cost_fiat and IGNORES the credit figure in metadata.cost', () => {
    // The documented example pairs a 22-second call with `"cost": 296` credits.
    // Reading that as cents would report $2.96 for a call that cost $0.05.
    const result = normalizeElevenLabsCallback(
      transcription({ call_duration_secs: 22, cost: 296, cost_fiat: 0.05 }),
    )

    expect(result.usage).toMatchObject({ costMinor: 5, currency: 'USD' })
  })

  it('reports NO cost at all when the provider reported none, so the column stays null', () => {
    const result = normalizeElevenLabsCallback(transcription({ call_duration_secs: 74, cost: 132 }))

    expect(result.usage).toEqual({ durationMs: 74_000 })
    expect(result.usage).not.toHaveProperty('costMinor')
    expect(result.usage).not.toHaveProperty('currency')
  })

  it('keeps a reported zero cost, which is a different fact from an absent one', () => {
    const result = normalizeElevenLabsCallback(transcription({ call_duration_secs: 30, cost_fiat: 0 }))

    expect(result.usage).toEqual({ durationMs: 30_000, costMinor: 0, currency: 'USD' })
  })

  it('omits the whole report when the provider metered nothing', () => {
    expect(normalizeElevenLabsCallback(transcription({})).usage).toBeUndefined()
    expect(normalizeElevenLabsCallback(transcription(null)).usage).toBeUndefined()
    expect(normalizeElevenLabsCallback(transcription(undefined)).usage).toBeUndefined()
  })

  it('reports only the halves the provider gave', () => {
    expect(normalizeElevenLabsCallback(transcription({ cost_fiat: 1.5 })).usage).toEqual({
      costMinor: 150,
      currency: 'USD',
    })
    expect(normalizeElevenLabsCallback(transcription({ call_duration_secs: 8 })).usage).toEqual({
      durationMs: 8_000,
    })
  })

  it('drops values a webhook can carry but the columns cannot hold', () => {
    expect(
      normalizeElevenLabsCallback(transcription({ call_duration_secs: -5, cost_fiat: Number.NaN })).usage,
    ).toBeUndefined()
    expect(
      normalizeElevenLabsCallback(transcription({ call_duration_secs: Number.POSITIVE_INFINITY })).usage,
    ).toBeUndefined()
    expect(normalizeElevenLabsCallback(transcription({ cost_fiat: -0.5 })).usage).toBeUndefined()
    expect(normalizeElevenLabsCallback(transcription({ cost_fiat: 'free' })).usage).toBeUndefined()
  })

  it('never lets a malformed metering value cost us the transcript', () => {
    // The regression this guards: `z.number()` refuses NaN, so before
    // `.catch(null)` a provider-side metering glitch made the WHOLE payload
    // unparseable — the run settled as a connector failure and a real
    // conversation was thrown away over a number nothing branches on.
    const result = normalizeElevenLabsCallback(
      transcription({ call_duration_secs: Number.NaN, cost_fiat: { amount: 3 } }),
    )

    expect(voiceCallResultSchema.safeParse(result).success).toBe(true)
    expect(result.data.reached).toBe(true)
    expect(result.data.summary).toBe('Approved.')
    expect(result.usage).toBeUndefined()
  })

  it('rounds a sub-cent duration and cost to the columns granularity', () => {
    const result = normalizeElevenLabsCallback(transcription({ call_duration_secs: 12.4, cost_fiat: 0.034 }))

    expect(result.usage).toEqual({ durationMs: 12_400, costMinor: 3, currency: 'USD' })
  })

  it('leaves the declared OUTCOME envelope exactly as it was', () => {
    const result = normalizeElevenLabsCallback(transcription({ call_duration_secs: 74, cost_fiat: 0.19 }))

    // Still valid against the agent's contract, and the usage lives BESIDE the
    // outcome — an author mapping `data.*` sees nothing new.
    expect(voiceCallResultSchema.safeParse(result).success).toBe(true)
    expect(result.data).not.toHaveProperty('usage')
    expect(result.data).not.toHaveProperty('costMinor')
    // `durationSeconds` stays on the outcome, where it always was: it is part of
    // the author-facing contract, and the usage report is a separate copy in the
    // platform's own units.
    expect(result.data.durationSeconds).toBe(74)
  })
})

describe('a call that never happened', () => {
  it('reports no usage, so an un-placed call is not recorded as free and instant', () => {
    const result = normalizeElevenLabsCallback({
      type: 'call_initiation_failure',
      data: { conversation_id: 'conv_none', failure_reason: 'destination unreachable' },
    })

    expect(result.usage).toBeUndefined()
    expect(result.data.reached).toBe(false)
  })
})
