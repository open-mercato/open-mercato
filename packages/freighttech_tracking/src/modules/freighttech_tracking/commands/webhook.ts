import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { ScopedWebhookInput, scopedWebhookSchema } from "../data/validators"
import { EventBus } from "@open-mercato/events/types"

const publishWebhookEventCommand: CommandHandler<ScopedWebhookInput, {}> = {
  id: 'freighttech_tracking.webhook.event',
  async execute(rawInput, ctx) {
    const input = scopedWebhookSchema.parse(rawInput)

    const { status, reference_id, id } = input.data
    console.debug('[freighttech_tracking.publishWebhookEventCommand] data', { status, id, reference_id })

    // TODO: transform API data

    const eventBus = ctx.container.resolve('eventBus') as EventBus
    await eventBus.emitEvent('freighttech_tracking.tracking_updated', input)
    console.debug('[freighttech_tracking.publishWebhookEventCommand] send event freighttech_tracking.tracking_updated')

    return {}
  },
}

registerCommand(publishWebhookEventCommand)
