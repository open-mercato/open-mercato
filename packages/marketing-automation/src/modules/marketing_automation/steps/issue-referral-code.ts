import { z } from 'zod'
import { ensureReferralCode, loadReferralUrlTemplate } from '../lib/referrals.js'
import { referralUrlFor } from '../lib/engine/referral-code.js'
import type { StepHandler } from '../lib/engine/registry.js'
import type { AutomationContext } from '../lib/engine/types.js'
import type { StepDeps } from './deps.js'

const paramsSchema = z.object({})

/**
 * Gives the customer their referral code and puts it where later steps can print it.
 *
 * The code goes into the run context as `{{referral.code}}` and, when the tenant configured a link template,
 * `{{referral.url}}` — which is the mechanism the source module used for generated coupons, and the reason a
 * chain is a context that flows rather than a list of independent actions.
 *
 * Idempotent: the code is per customer, so a redelivered step returns the same one. A person's referral code
 * must never change, because it is already printed in every message that ever mentioned it.
 */
export const issueReferralCodeStep: StepHandler<StepDeps> = {
  type: 'issue_referral_code',
  labelKey: 'marketing_automation.step.issue_referral_code.label',
  descriptionKey: 'marketing_automation.step.issue_referral_code.description',
  icon: 'share',
  paramsSchema,
  uiFields: [],
  async execute(ctx: AutomationContext, _rawParams, deps: StepDeps) {
    if (!ctx.subjectEntityId) {
      return { status: 'skipped', detail: 'no subject to issue a code to' }
    }

    const code = await ensureReferralCode(deps.em, deps.scope, ctx.subjectEntityId)
    const template = await loadReferralUrlTemplate(deps.container, deps.scope)

    /**
     * Written onto the CONTEXT, which the executor persists for the rest of the run.
     *
     * Safe to persist, unlike an email address: a referral code is not personal data in the sense the
     * encryption rules care about, and the whole point is that the same code appears in every later step.
     */
    const referral: Record<string, unknown> = { code }
    const url = referralUrlFor(template, code)
    if (url) referral.url = url
    ctx.referral = referral

    return { status: 'done', detail: `referral code ${code}` }
  },
}
