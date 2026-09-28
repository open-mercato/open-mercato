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
      // `'html'` is not optional here: the body is rendered as HTML, and substituted values can be
      // customer-controlled.
      html: interpolate(params.bodyHtml, ctx, 'html'),
      text: params.bodyText ? interpolate(params.bodyText, ctx) : undefined,
      tenantId: deps.scope.tenantId,
      organizationId: deps.scope.organizationId,
    })

    // The address is intentionally not returned: it must not reach the send history.
    return { status: 'done', detail: 'email sent' }
  },
}
