const sendEmail = jest.fn()
const findOneWithDecryption = jest.fn()
const recordSurveyAsked = jest.fn()
const markSurveySent = jest.fn()
const decideAssignment = jest.fn()
const reportError = jest.fn()
const resolveTrackingSecret = jest.fn()
const resolveTrackingBaseUrl = jest.fn()

jest.mock('@open-mercato/shared/lib/email/send', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...a: unknown[]) => findOneWithDecryption(...a),
}))
jest.mock('@open-mercato/telemetry', () => ({ reportError: (...a: unknown[]) => reportError(...a) }))
jest.mock('../../lib/survey.js', () => ({
  NPS_MIN_SCORE: 0,
  NPS_MAX_SCORE: 10,
  recordSurveyAsked: (...a: unknown[]) => recordSurveyAsked(...a),
  markSurveySent: (...a: unknown[]) => markSurveySent(...a),
}))
jest.mock('../../lib/lead-routing.js', () => ({ decideAssignment: (...a: unknown[]) => decideAssignment(...a) }))
jest.mock('../../lib/tracking/secret.js', () => ({
  resolveTrackingSecret: (...a: unknown[]) => resolveTrackingSecret(...a),
  resolveTrackingBaseUrl: (...a: unknown[]) => resolveTrackingBaseUrl(...a),
}))

import { assignOwnerStep } from '../assign-owner'
import { npsSurveyStep } from '../nps-survey'
import type { AutomationContext } from '../../lib/engine/types'

/**
 * The two step handlers a positive integration run never exercises the interesting half of.
 *
 * `nps_survey` composes its own message — the only step that does — so the eleven signed links, the
 * order of the prompt row against the send, and the redaction of a transport rejection are all its own
 * responsibility. `assign_owner` exists to REFUSE in the common case: the customer already has a rep.
 */
const scope = { tenantId: 't1', organizationId: 'o1' }

const ctx = (over: Partial<AutomationContext> = {}): AutomationContext => ({
  tenantId: 't1', organizationId: 'o1', eventId: 'e', occurredAt: '2026-09-30T00:00:00.000Z',
  dispatchDepth: 1, subjectEntityId: 'cust-1', campaignId: 'camp-1', runId: 'run-1', actionId: 'step-1',
  trigger: {}, ...over,
} as AutomationContext)

const commandExecute = jest.fn()
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
const deps = {
  em: {} as never,
  container: { resolve: () => ({ execute: commandExecute }) } as never,
  logger: logger as never,
  scope,
  now: new Date('2026-09-30T12:00:00.000Z'),
  commandContext: { systemActor: true } as never,
} as never

const params = { subject: 'How did we do?', question: 'How likely are you to recommend us?' }

beforeEach(() => {
  for (const fn of [sendEmail, findOneWithDecryption, recordSurveyAsked, markSurveySent, decideAssignment, reportError, resolveTrackingSecret, resolveTrackingBaseUrl, commandExecute, logger.error]) fn.mockReset()
  resolveTrackingSecret.mockReturnValue('s3cret')
  resolveTrackingBaseUrl.mockReturnValue('https://shop.example')
  findOneWithDecryption.mockResolvedValue({ primaryEmail: 'buyer@example.com' })
  recordSurveyAsked.mockResolvedValue({ asked: true, alreadySent: false, promptId: 'prompt-1' })
  sendEmail.mockResolvedValue(undefined)
  decideAssignment.mockResolvedValue({ assign: true, userId: 'rep-7' })
})

describe('nps_survey', () => {
  it('renders the whole eleven-point scale, each cell its own signed link', async () => {
    /**
     * The reason this step composes its own HTML: eleven placeholders an author has to place correctly in
     * every template and locale is a feature that is technically available and practically unused.
     */
    await npsSurveyStep.execute(ctx(), params, deps)
    const html = sendEmail.mock.calls[0][0].html as string
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
    // Eleven scores plus the unsubscribe link.
    expect(hrefs).toHaveLength(12)
    for (let score = 0; score <= 10; score += 1) expect(html).toContain(`>${score}</a>`)
    expect(new Set(hrefs).size).toBe(12)
  })

  it('leaves no bare ampersand in an href, so an HTML parser cannot mangle a signed link', async () => {
    /**
     * Today every tracking URL carries a single `t=` parameter, so there is nothing to escape and the
     * step's `&` → `&amp;` pass is a guard for the day one carries two. The assertion is on the property
     * rather than on the escape, because the property is what keeps a token verifiable in a mail client.
     */
    await npsSurveyStep.execute(ctx(), params, deps)
    const html = sendEmail.mock.calls[0][0].html as string
    for (const href of [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])) {
      expect(href.replace(/&amp;/g, '')).not.toContain('&')
    }
  })

  it('writes the prompt row BEFORE sending', async () => {
    // A message with no row is an answer with nowhere to go, which is worse than a row with no message.
    const order: string[] = []
    recordSurveyAsked.mockImplementation(async () => { order.push('row'); return { asked: true, alreadySent: false, promptId: 'p1' } })
    sendEmail.mockImplementation(async () => { order.push('send') })
    markSurveySent.mockImplementation(async () => { order.push('sent-marked') })
    await npsSurveyStep.execute(ctx(), params, deps)
    expect(order).toEqual(['row', 'send', 'sent-marked'])
  })

  it('marks the prompt sent only after the transport accepted it', async () => {
    sendEmail.mockRejectedValue(new Error('mailbox full'))
    await expect(npsSurveyStep.execute(ctx(), params, deps)).rejects.toThrow()
    expect(markSurveySent).not.toHaveBeenCalled()
  })

  it('sends again when a previous attempt wrote the row but never got the message out', async () => {
    /**
     * The row's existence alone used to mean "asked", so a transport failure after writing it could never be
     * retried: every later attempt reported success and nobody was ever invited.
     */
    recordSurveyAsked.mockResolvedValue({ asked: false, alreadySent: false, promptId: 'prompt-1' })
    const result = await npsSurveyStep.execute(ctx(), params, deps)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ status: 'done', detail: 'survey sent on a retry' })
  })

  it('stops at a survey that really was sent, so a redelivery does not ask twice', async () => {
    recordSurveyAsked.mockResolvedValue({ asked: false, alreadySent: true, promptId: 'prompt-1' })
    const result = await npsSurveyStep.execute(ctx(), params, deps)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(result).toMatchObject({ status: 'done' })
  })

  it('redacts the address out of a transport rejection before re-throwing it', async () => {
    // The rejection quotes the recipient, and the message it is re-thrown as is persisted on the run.
    sendEmail.mockRejectedValue(new Error('550 rejected recipient buyer@example.com'))
    await expect(npsSurveyStep.execute(ctx(), params, deps)).rejects.toThrow(/survey transport rejected/)
    await expect(npsSurveyStep.execute(ctx(), params, deps)).rejects.not.toThrow(/buyer@example\.com/)
    // The original still reaches the log and the error reporter, where an operator needs it.
    expect(logger.error.mock.calls[0][1]).toMatchObject({ error: '550 rejected recipient buyer@example.com' })
    expect(reportError).toHaveBeenCalled()
  })

  it('skips rather than sending an unanswerable survey when nothing can sign the links', async () => {
    resolveTrackingSecret.mockReturnValue(null)
    const result = await npsSurveyStep.execute(ctx(), params, deps)
    expect(result).toMatchObject({ status: 'skipped' })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(recordSurveyAsked).not.toHaveBeenCalled()
  })

  it('skips when there is no base url to build the links on', async () => {
    resolveTrackingBaseUrl.mockReturnValue(null)
    expect(await npsSurveyStep.execute(ctx(), params, deps)).toMatchObject({ status: 'skipped' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('skips a run with nothing to attribute an answer to', async () => {
    for (const missing of [{ subjectEntityId: null }, { runId: null }, { actionId: null }, { campaignId: null }]) {
      expect(await npsSurveyStep.execute(ctx(missing), params, deps)).toMatchObject({ status: 'skipped' })
    }
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('skips a subject with no address instead of failing the run', async () => {
    findOneWithDecryption.mockResolvedValue({ primaryEmail: '   ' })
    expect(await npsSurveyStep.execute(ctx(), params, deps)).toMatchObject({ status: 'skipped' })
    expect(recordSurveyAsked).not.toHaveBeenCalled()
  })

  it('reads the address through the decrypting finder, with the scope', async () => {
    // `primary_email` is encrypted at rest; a plain findOne returns ciphertext and mails nobody.
    await npsSurveyStep.execute(ctx(), params, deps)
    expect(findOneWithDecryption).toHaveBeenCalled()
    expect(findOneWithDecryption.mock.calls[0][2]).toMatchObject({ ...scope, deletedAt: null })
    expect(findOneWithDecryption.mock.calls[0][4]).toEqual(scope)
  })

  it('declares the email channel, so consent and the timing gates apply to it', async () => {
    // A survey is a message. Somebody who unsubscribed did not ask to be surveyed either.
    expect(npsSurveyStep.channel).toBe('email')
  })

  it('refuses a question or a subject it cannot render', async () => {
    await expect(npsSurveyStep.execute(ctx(), { subject: '', question: 'q' }, deps)).rejects.toThrow()
    await expect(npsSurveyStep.execute(ctx(), { subject: 's' }, deps)).rejects.toThrow()
  })
})

describe('assign_owner', () => {
  it('writes the owner through the customers command rather than the column', async () => {
    const result = await assignOwnerStep.execute(ctx(), {}, deps)
    expect(commandExecute.mock.calls[0][0]).toBe('customers.people.update')
    expect(commandExecute.mock.calls[0][1].input).toMatchObject({ id: 'cust-1', ownerUserId: 'rep-7' })
    expect(result).toMatchObject({ status: 'done', detail: 'assigned to rep-7' })
  })

  it('does not reassign unless it was explicitly asked to', async () => {
    /**
     * Taking a customer away from the rep who has been talking to them is the most damaging thing routing
     * can do, and a re-entry would do it on every pass if this defaulted the other way.
     */
    await assignOwnerStep.execute(ctx(), {}, deps)
    expect(decideAssignment.mock.calls[0][3]).toMatchObject({ reassign: false })
    await assignOwnerStep.execute(ctx(), { reassign: true }, deps)
    expect(decideAssignment.mock.calls[1][3]).toMatchObject({ reassign: true })
  })

  it('reports an owned lead and an empty pool as different skips, both legitimate', async () => {
    decideAssignment.mockResolvedValue({ assign: false, reason: 'already_owned' })
    expect(await assignOwnerStep.execute(ctx(), {}, deps)).toMatchObject({ status: 'skipped', detail: 'already has an owner' })
    decideAssignment.mockResolvedValue({ assign: false, reason: 'empty_pool' })
    expect(await assignOwnerStep.execute(ctx(), {}, deps)).toMatchObject({ status: 'skipped', detail: 'no sales reps configured' })
    expect(commandExecute).not.toHaveBeenCalled()
  })

  it('skips a run with no subject', async () => {
    expect(await assignOwnerStep.execute(ctx({ subjectEntityId: null }), {}, deps)).toMatchObject({ status: 'skipped' })
    expect(decideAssignment).not.toHaveBeenCalled()
  })
})
