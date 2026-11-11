import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { StepHandler } from '../lib/engine/registry.js'
import type { AutomationContext } from '../lib/engine/types.js'
import type { StepDeps } from './deps.js'

const paramsSchema = z.object({ tagId: z.string().uuid() })

function isAlreadyAssigned(error: unknown): boolean {
  // `customers.tags.assign` answers 409 when the tag is already on the customer. For an
  // automation that is the desired end state, not a failure — and treating it as success is
  // what makes the step idempotent under at-least-once delivery.
  const status = (error as { status?: number; statusCode?: number } | null)?.status
    ?? (error as { statusCode?: number } | null)?.statusCode
  if (status === 409) return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes('Tag already assigned')
}

export const addTagStep: StepHandler<StepDeps> = {
  type: 'add_tag',
  labelKey: 'marketing_automation.step.add_tag.label',
  descriptionKey: 'marketing_automation.step.add_tag.description',
  icon: 'tag',
  paramsSchema,
  uiFields: [
    { name: 'tagId', kind: 'customer_tag', labelKey: 'marketing_automation.step.add_tag.param.tagId', required: true },
  ],
  async execute(ctx: AutomationContext, rawParams, deps: StepDeps) {
    const { tagId } = paramsSchema.parse(rawParams)
    if (!ctx.subjectEntityId) {
      return { status: 'skipped', detail: 'no subject to tag' }
    }

    const commandBus = deps.container.resolve<CommandBus>('commandBus')
    try {
      await commandBus.execute('customers.tags.assign', {
        input: {
          tenantId: deps.scope.tenantId,
          organizationId: deps.scope.organizationId,
          tagId,
          entityId: ctx.subjectEntityId,
        },
        ctx: deps.commandContext,
      })
      return { status: 'done', detail: `tagged ${tagId}` }
    } catch (error) {
      if (isAlreadyAssigned(error)) {
        return { status: 'done', detail: 'tag already present' }
      }
      throw error
    }
  },
}
