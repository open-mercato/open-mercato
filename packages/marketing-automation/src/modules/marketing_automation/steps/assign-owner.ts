import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { decideAssignment } from '../lib/lead-routing.js'
import type { StepHandler } from '../lib/engine/registry.js'
import type { AutomationContext } from '../lib/engine/types.js'
import type { StepDeps } from './deps.js'

const paramsSchema = z.object({
  /**
   * Take a lead that already has an owner.
   *
   * Off by default and deliberately hard to turn on by accident: moving a customer away from the rep who has
   * been talking to them is the most damaging thing routing can do, and a re-entry or a redelivered job would
   * do it on every pass if this defaulted the other way.
   */
  reassign: z.boolean().optional().default(false),
})

/**
 * Gives the lead to a sales rep.
 *
 * The rep with the fewest live leads wins — see `lib/engine/lead-routing.ts` for why that beats a round-robin
 * cursor. The write goes through `customers.people.update`, because the owner is the customers module's field
 * and setting it directly would skip the audit entry, the event and the cache invalidation that make an
 * assignment visible everywhere else.
 */
export const assignOwnerStep: StepHandler<StepDeps> = {
  type: 'assign_owner',
  labelKey: 'marketing_automation.step.assign_owner.label',
  descriptionKey: 'marketing_automation.step.assign_owner.description',
  icon: 'user',
  paramsSchema,
  uiFields: [
    { name: 'reassign', kind: 'boolean', labelKey: 'marketing_automation.step.assign_owner.param.reassign' },
  ],
  async execute(ctx: AutomationContext, rawParams, deps: StepDeps) {
    const params = paramsSchema.parse(rawParams)
    if (!ctx.subjectEntityId) return { status: 'skipped', detail: 'no subject to assign' }

    const decision = await decideAssignment(deps.em, deps.container, deps.scope, {
      subjectEntityId: ctx.subjectEntityId,
      reassign: params.reassign,
    })

    if (!decision.assign) {
      // Both reasons are legitimate outcomes rather than failures: an empty pool is a configuration an
      // operator can see on the settings screen, and an owned lead is the case this step protects.
      return { status: 'skipped', detail: decision.reason === 'empty_pool' ? 'no sales reps configured' : 'already has an owner' }
    }

    const commandBus = deps.container.resolve<CommandBus>('commandBus')
    await commandBus.execute('customers.people.update', {
      input: { id: ctx.subjectEntityId, ownerUserId: decision.userId },
      ctx: deps.commandContext,
    })

    return { status: 'done', detail: `assigned to ${decision.userId}` }
  },
}
