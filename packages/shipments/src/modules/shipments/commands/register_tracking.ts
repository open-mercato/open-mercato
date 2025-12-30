import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandBus, CommandHandler } from '@open-mercato/shared/lib/commands'
import z from 'zod'

const scoped = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),
})

export const registerTrackingSchema = scoped.extend({
  bookingNumber: z.string().optional(),
  carrierCode: z.string().optional(),
})

export type RegisterTrackingInput = z.infer<typeof registerTrackingSchema>

const registerTrackingCommand: CommandHandler<RegisterTrackingInput, { success: boolean, referenceId?: string, source?: string }> = {
  id: 'shipments.tracking.register',
  async execute(rawInput, ctx) {
    const input = registerTrackingSchema.parse(rawInput)

    if (!input.bookingNumber || !input.carrierCode) {
      return { success: false }
    }

    // const eventBus = ctx.container.resolve('eventBus') as EventBus
    // await eventBus.emitEvent('fms_tracking.track', input)

    try {
      const command = ctx.container.resolve<CommandBus>('commandBus')
      const resp = await command.execute('fms_tracking.tracking.register', { ctx, input })

      return {
        success: !!(resp as any)?.success,
        referenceId: (resp as any)?.referenceId,
        source: (resp as any)?.source,
      }

    } catch (error) {
      console.log(error)
      return { success: false }
    }
  },
}

registerCommand(registerTrackingCommand)
