import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { ScopedWebhookInput, scopedFreighttechWebhookSchema } from "../../data/validators"
import { EventBus } from "@open-mercato/events/types"

const publishWebhookEventCommand: CommandHandler<ScopedWebhookInput, {}> = {
  id: 'fms_tracking.freighttech.webhook',
  async execute(rawInput, ctx) {
    const input = scopedFreighttechWebhookSchema.parse(rawInput)

    const { status, reference_id, id } = input.data
    console.debug('[fms_tracking.publishWebhookEventCommand] data', { status, id, reference_id })

    // TODO: transform API data

    const eventBus = ctx.container.resolve('eventBus') as EventBus
    await eventBus.emitEvent('fms_tracking.tracking_updated', input)
    console.debug('[fms_tracking.publishWebhookEventCommand] send event fms_tracking.tracking_updated')

    return {}
  },
}

registerCommand(publishWebhookEventCommand)
