import { z } from 'zod'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { interpolate } from '../lib/interpolate.js'
import type { StepHandler } from '../lib/engine/registry.js'
import type { AutomationContext } from '../lib/engine/types.js'
import type { StepDeps } from './deps.js'

const paramsSchema = z.object({
  subject: z.string().min(1),
  bodyHtml: z.string().min(1),
  bodyText: z.string().optional(),
})

/**
 * Resolves the recipient.
 *
 * Prefers the address captured when the run started, so a long drip campaign keeps mailing the
 * address the customer had when they entered it, and falls back to a fresh read for a run whose
 * context predates that. `primary_email` is encrypted at rest, so the read must decrypt or it
 * returns ciphertext.
 */
async function resolveRecipient(ctx: AutomationContext, deps: StepDeps): Promise<string | null> {
  const captured = typeof ctx.subjectEmail === 'string' ? ctx.subjectEmail.trim() : ''
  if (captured) return captured
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
      html: interpolate(params.bodyHtml, ctx),
      text: params.bodyText ? interpolate(params.bodyText, ctx) : undefined,
      tenantId: deps.scope.tenantId,
      organizationId: deps.scope.organizationId,
    })

    return { status: 'done', detail: 'email sent', sentTo: to }
  },
}
