import { z } from 'zod'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { interpolate } from '../lib/interpolate.js'
import { applyTracking } from '../lib/tracking/rewrite.js'
import { resolveTrackingBaseUrl, resolveTrackingSecret } from '../lib/tracking/secret.js'
import { clickUrl, openPixelUrl } from '../lib/tracking/urls.js'
import type { StepHandler } from '../lib/engine/registry.js'
import type { AutomationContext } from '../lib/engine/types.js'
import type { StepDeps } from './deps.js'

const paramsSchema = z.object({
  subject: z.string().min(1),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
  /**
   * Opt out of open and click tracking for this step.
   *
   * Default on, opt-out per step rather than a global switch: a transactional-feeling message inside
   * a campaign is exactly the one an author will want left alone, and that is a decision about one
   * message rather than about the installation.
   */
  track: z.boolean().optional().default(true),
})

/**
 * Rewrites the body so opens and clicks can be attributed, when everything needed is present.
 *
 * Returns the body unchanged whenever it is not — no secret configured, no base URL, no run or step
 * identity, or the author opted out. Tracking is an enhancement to a send; a send must never fail
 * because it could not be tracked.
 */
function withTracking(
  html: string,
  ctx: AutomationContext,
  enabled: boolean,
): string {
  if (!enabled) return html
  const secret = resolveTrackingSecret()
  const baseUrl = resolveTrackingBaseUrl()
  if (!secret || !baseUrl) return html
  if (!ctx.runId || !ctx.actionId || !ctx.campaignId) return html

  const claims = {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    campaignId: ctx.campaignId,
    runId: ctx.runId,
    stepId: ctx.actionId,
  }
  return applyTracking(html, {
    makeClickUrl: (target) => clickUrl(baseUrl, claims, secret, target),
    pixelUrl: openPixelUrl(baseUrl, claims, secret),
  })
}

/**
 * Resolves the recipient at send time, by reading through the decrypting finder.
 *
 * Deliberately NOT cached in the run context: that context is persisted to jsonb, and
 * `primary_email` is encrypted at rest, so carrying the address there would leave an unencrypted
 * copy of PII in the database. One scoped read per send is the price, and it has a second benefit —
 * a customer who corrects their address mid-journey gets the remaining steps at the new one.
 */
async function resolveRecipient(ctx: AutomationContext, deps: StepDeps): Promise<string | null> {
  if (!ctx.subjectEntityId) return null

  const entity = await findOneWithDecryption(
    deps.em,
    CustomerEntity,
    {
      id: ctx.subjectEntityId,
      tenantId: deps.scope.tenantId,
      organizationId: deps.scope.organizationId,
      deletedAt: null,
    },
    undefined,
    deps.scope,
  )
  return entity?.primaryEmail?.trim() || null
}

export const sendEmailStep: StepHandler<StepDeps> = {
  type: 'send_email',
  labelKey: 'marketing_automation.step.send_email.label',
  descriptionKey: 'marketing_automation.step.send_email.description',
  icon: 'mail',
  channel: 'email',
  paramsSchema,
  uiFields: [
    { name: 'subject', kind: 'text', labelKey: 'marketing_automation.step.send_email.param.subject', required: true },
    { name: 'bodyHtml', kind: 'textarea', labelKey: 'marketing_automation.step.send_email.param.bodyHtml', required: true },
    { name: 'track', kind: 'boolean', labelKey: 'marketing_automation.step.send_email.param.track' },
  ],
  async execute(ctx: AutomationContext, rawParams, deps: StepDeps) {
    const params = paramsSchema.parse(rawParams)
    const to = await resolveRecipient(ctx, deps)
    if (!to) {
      // A customer with no address is not an error: plenty of CRM records have none, and
      // failing the run would retry five times and then dead-letter a journey that can never
      // succeed.
      return { status: 'skipped', detail: 'no email address on the subject' }
    }

    await sendEmail({
      to,
      subject: interpolate(params.subject, ctx),
      // Interpolate FIRST, then rewrite: a link assembled from a substituted value has to be tracked
      // too, and rewriting first would sign a URL containing the placeholder instead of the value.
      // `'html'` is not optional here: the body is rendered as HTML, and substituted values can be
      // customer-controlled.
      html: withTracking(interpolate(params.bodyHtml, ctx, 'html'), ctx, params.track),
      text: params.bodyText ? interpolate(params.bodyText, ctx) : undefined,
      tenantId: deps.scope.tenantId,
      organizationId: deps.scope.organizationId,
    })

    // The address is intentionally not returned: it must not reach the send history.
    return { status: 'done', detail: 'email sent' }
  },
}
