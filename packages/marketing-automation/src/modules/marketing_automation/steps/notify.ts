import { z } from 'zod'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { StepHandler } from '../lib/engine/registry.js'
import type { AutomationContext } from '../lib/engine/types.js'
import { interpolate } from '../lib/interpolate.js'
import type { StepDeps } from './deps.js'

/**
 * Tells a COLLEAGUE something, rather than telling the customer.
 *
 * The gap this fills: a journey could send a customer an email, tag them, score them and route them to a rep —
 * and had no way to say "this one needs a person". A VIP answering 2 on an NPS survey is the example that
 * matters; the campaign can now put it in somebody's bell menu the moment it happens, instead of waiting for
 * whoever next reads the results screen.
 *
 * In-app only, and that is a decision rather than a limitation. Email to staff needs an address, which would
 * mean either reading the auth module's users from here or copying addresses into marketing config; the
 * notifications module delivers to a USER ID and respects that person's own channel preferences, so it is both
 * cheaper and more correct. It is also what the weekly rep digest already does.
 */
const paramsSchema = z.object({
  /**
   * `owner` is the rep who owns this customer; `team` is everybody allowed to see campaign runs.
   *
   * Two audiences and no more: "one named person" would embed a user id in a campaign definition, which then
   * survives that person leaving — the same reason the rep pool stores ids and reads the directory for names.
   */
  audience: z.enum(['owner', 'team']).default('owner'),
  /** One sentence, interpolated like any message body, so it can name the customer and the trigger. */
  message: z.string().min(1).max(500),
  severity: z.enum(['info', 'warning']).default('info'),
})

type NotificationServiceLike = {
  createBatch(
    input: Record<string, unknown>,
    ctx: { tenantId: string; organizationId: string },
  ): Promise<unknown>
  createForFeature(
    input: Record<string, unknown>,
    ctx: { tenantId: string; organizationId: string },
  ): Promise<unknown>
}

export const notifyStep: StepHandler<StepDeps> = {
  type: 'notify',
  labelKey: 'marketing_automation.step.notify.label',
  descriptionKey: 'marketing_automation.step.notify.description',
  icon: 'bell',
  paramsSchema,
  uiFields: [
    {
      name: 'audience',
      kind: 'select',
      labelKey: 'marketing_automation.step.notify.param.audience',
      required: true,
      options: [
        { value: 'owner', labelKey: 'marketing_automation.step.notify.audience.owner' },
        { value: 'team', labelKey: 'marketing_automation.step.notify.audience.team' },
      ],
    },
    { name: 'message', kind: 'textarea', labelKey: 'marketing_automation.step.notify.param.message', required: true },
    {
      name: 'severity',
      kind: 'select',
      labelKey: 'marketing_automation.step.notify.param.severity',
      options: [
        { value: 'info', labelKey: 'marketing_automation.step.notify.severity.info' },
        { value: 'warning', labelKey: 'marketing_automation.step.notify.severity.warning' },
      ],
    },
  ],
  async execute(ctx: AutomationContext, rawParams, deps: StepDeps) {
    const params = paramsSchema.parse(rawParams)

    let notifications: NotificationServiceLike
    try {
      notifications = deps.container.resolve<NotificationServiceLike>('notificationService')
    } catch {
      // A trimmed installation without the notifications module runs the rest of the journey perfectly well;
      // it simply cannot tell anybody. Skipped rather than failed, so the customer's journey continues.
      return { status: 'skipped', detail: 'the notifications module is not installed' }
    }

    /**
     * The customer's display name, read through the decrypting finder.
     *
     * `display_name` is encrypted at rest, so a plain read would put ciphertext in a colleague's bell menu. It
     * is passed as a notification VARIABLE rather than baked into the stored body for the same reason the
     * unsubscribe link is minted per send: the row is persisted, and a name in it is a copy of a protected
     * field.
     */
    const customer = ctx.subjectEntityId
      ? await findOneWithDecryption(
          deps.em,
          CustomerEntity,
          { id: ctx.subjectEntityId, tenantId: deps.scope.tenantId, organizationId: deps.scope.organizationId, deletedAt: null },
          undefined,
          deps.scope,
        )
      : null

    const message = interpolate(params.message, ctx)
    const common = {
      type: 'marketing_automation.campaign_notice',
      titleKey: 'marketing_automation.notifications.campaignNotice.title',
      bodyKey: 'marketing_automation.notifications.campaignNotice.body',
      titleVariables: { customer: customer?.displayName ?? '' },
      bodyVariables: { message, customer: customer?.displayName ?? '' },
      severity: params.severity,
      sourceModule: 'marketing_automation',
      // The bell is a prompt to act, and acting means opening the customer — not the campaign.
      linkHref: ctx.subjectEntityId ? `/backend/marketing/customers/${ctx.subjectEntityId}` : '/backend/marketing/campaigns',
      /**
       * One notice per run per step, so a redelivered step groups onto the same row rather than stacking.
       *
       * Keyed on the run and the step rather than on the customer: the same customer reaching the same
       * milestone in a later run is news again.
       */
      groupKey: `marketing_automation.campaign_notice.${ctx.runId ?? 'none'}.${ctx.actionId ?? 'none'}`,
    }
    const scope = { tenantId: deps.scope.tenantId, organizationId: deps.scope.organizationId }

    if (params.audience === 'owner') {
      const ownerUserId = (customer as { ownerUserId?: string | null } | null)?.ownerUserId ?? null
      if (!ownerUserId) {
        // Nobody owns this customer, so there is nobody this notice is for. Said plainly in the step log
        // rather than quietly broadcast to the whole team, which is not what the author asked for.
        return { status: 'skipped', detail: 'the customer has no owner to notify' }
      }
      await notifications.createBatch({ ...common, recipientUserIds: [ownerUserId] }, scope)
      return { status: 'done', detail: 'notified the owner' }
    }

    /**
     * The team is defined by a PERMISSION, not by a role name.
     *
     * `runs.view` is who is allowed to know what campaigns are doing to customers, which is exactly the set
     * that should hear about one. A role name would be a second, mutable definition of the same group.
     */
    await notifications.createForFeature(
      { ...common, requiredFeature: 'marketing_automation.runs.view' },
      scope,
    )
    return { status: 'done', detail: 'notified the team' }
  },
}
