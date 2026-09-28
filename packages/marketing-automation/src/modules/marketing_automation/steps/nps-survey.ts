import { z } from 'zod'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { reportError } from '@open-mercato/telemetry'
import { interpolate } from '../lib/interpolate.js'
import { redactEmails } from '../lib/redact.js'
import { NPS_MAX_SCORE, NPS_MIN_SCORE, recordSurveyAsked } from '../lib/survey.js'
import { resolveTrackingBaseUrl, resolveTrackingSecret } from '../lib/tracking/secret.js'
import { surveyAnswerUrl, unsubscribeUrl } from '../lib/tracking/urls.js'
import type { StepHandler } from '../lib/engine/registry.js'
import type { AutomationContext } from '../lib/engine/types.js'
import type { StepDeps } from './deps.js'

const paramsSchema = z.object({
  question: z.string().min(1).max(300),
  subject: z.string().min(1).max(200),
})

/**
 * Asks one NPS question, with the scale built in.
 *
 * **The design decision worth stating: this step composes its own message.** Every other sending step takes
 * the author's HTML, and this one does not. An eleven-point scale is eleven signed links, and asking an
 * author to place eleven placeholders correctly — in every locale, in every template — would make the
 * feature technically available and practically unused. The author writes the question and the subject line;
 * the module renders the scale.
 *
 * It declares `channel: 'email'`, so consent, quiet hours and the frequency cap all apply to it exactly as
 * they do to a campaign message — a survey is a message, and a customer who unsubscribed did not ask to be
 * surveyed either.
 */
function renderScale(baseUrl: string, secret: string, ctx: AutomationContext): string {
  const claims = {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    campaignId: ctx.campaignId ?? '',
    runId: ctx.runId ?? '',
    stepId: ctx.actionId ?? '',
  }
  const cells: string[] = []
  for (let score = NPS_MIN_SCORE; score <= NPS_MAX_SCORE; score += 1) {
    const url = surveyAnswerUrl(baseUrl, claims, secret, score).replace(/&/g, '&amp;')
    cells.push(
      `<a href="${url}" style="display:inline-block;min-width:2rem;padding:.5rem;margin:.125rem;`
      + `border:1px solid #ccc;border-radius:.25rem;text-align:center;text-decoration:none;color:#111">${score}</a>`,
    )
  }
  return `<div style="margin:1rem 0">${cells.join('')}</div>`
}

export const npsSurveyStep: StepHandler<StepDeps> = {
  type: 'nps_survey',
  labelKey: 'marketing_automation.step.nps_survey.label',
  descriptionKey: 'marketing_automation.step.nps_survey.description',
  icon: 'smile',
  channel: 'email',
  paramsSchema,
  uiFields: [
    { name: 'subject', kind: 'text', labelKey: 'marketing_automation.step.nps_survey.param.subject', required: true },
    { name: 'question', kind: 'text', labelKey: 'marketing_automation.step.nps_survey.param.question', required: true },
  ],
  async execute(ctx: AutomationContext, rawParams, deps: StepDeps) {
    const params = paramsSchema.parse(rawParams)
    if (!ctx.subjectEntityId || !ctx.runId || !ctx.actionId || !ctx.campaignId) {
      return { status: 'skipped', detail: 'a survey needs a subject and a run to attribute the answer to' }
    }

    const secret = resolveTrackingSecret()
    const baseUrl = resolveTrackingBaseUrl()
    if (!secret || !baseUrl) {
      // Without signed links there is no way to answer, and a survey nobody can answer is worse than none.
      return { status: 'skipped', detail: 'no tracking secret or base url, so the scale could not be signed' }
    }

    const entity = await findOneWithDecryption(
      deps.em,
      CustomerEntity,
      { id: ctx.subjectEntityId, tenantId: deps.scope.tenantId, organizationId: deps.scope.organizationId, deletedAt: null },
      undefined,
      deps.scope,
    )
    const to = entity?.primaryEmail?.trim()
    if (!to) return { status: 'skipped', detail: 'no email address on the subject' }

    // Recorded BEFORE sending: a prompt row that exists without a message is a survey nobody answers, while
    // a message without a row is an answer with nowhere to go.
    const { asked } = await recordSurveyAsked(deps.em, {
      scope: deps.scope,
      subjectEntityId: ctx.subjectEntityId,
      campaignId: ctx.campaignId,
      runId: ctx.runId,
      stepId: ctx.actionId,
      question: params.question,
      now: deps.now,
    })
    if (!asked) return { status: 'done', detail: 'this survey was already asked for this step' }

    const question = interpolate(params.question, ctx, 'html')
    const unsubscribe = unsubscribeUrl(
      baseUrl,
      {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        campaignId: ctx.campaignId,
        runId: ctx.runId,
        stepId: ctx.actionId,
      },
      secret,
    ).replace(/&/g, '&amp;')

    const html = `<p>${question}</p>${renderScale(baseUrl, secret, ctx)}`
      + `<p style="font-size:12px;color:#666">0 = ${'not at all likely'}, ${NPS_MAX_SCORE} = ${'extremely likely'}</p>`
      + `<p style="margin-top:2rem;font-size:12px;color:#666"><a href="${unsubscribe}" style="color:#666">Unsubscribe</a></p>`

    try {
      await sendEmail({
        to,
        subject: interpolate(params.subject, ctx),
        html,
        tenantId: deps.scope.tenantId,
        organizationId: deps.scope.organizationId,
      })
    } catch (error) {
      const original = error instanceof Error ? error.message : String(error)
      deps.logger.error('[internal] marketing survey transport rejected the send', {
        campaignId: ctx.campaignId,
        stepId: ctx.actionId,
        error: original,
      })
      reportError(error, {
        module: 'marketing_automation',
        code: 'marketing_automation.survey_send_failed',
        attributes: { campaignId: ctx.campaignId ?? undefined },
      })
      // Redacted for the same reason every other transport failure is: the rejection quotes the address.
      throw new Error(`[internal] survey transport rejected the send: ${redactEmails(original)}`)
    }

    return { status: 'done', detail: 'survey sent' }
  },
}
