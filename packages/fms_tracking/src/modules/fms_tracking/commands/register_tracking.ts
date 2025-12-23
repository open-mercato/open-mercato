import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { EntityManager } from '@mikro-orm/postgresql'
import { FreighttechRegisterSubscription } from './freighttech/api'
import z from 'zod'


const registerTrackingSchema = z.object({
  organizationId: z.uuid(),
  tenantId: z.uuid(),

  bookingNumber: z.string().optional(),
  carrierCode: z.string(),
  containerId: z.string().optional(),
}).refine(
  (data) => data.bookingNumber || data.containerId,
  {
    message: "Either bookingNumber or containerId is required",
  }
)
export type RegisterTrackingInput = z.infer<typeof registerTrackingSchema>

const registerTrackingCommand: CommandHandler<RegisterTrackingInput, {
  success: boolean,
  referenceId?: string,
  source?: string,
}> = {
  id: 'fms_tracking.tracking.register',
  async execute(rawInput, ctx) {
    const input = registerTrackingSchema.parse(rawInput)
    const em = ctx.container.resolve<EntityManager>('em')

    // TODO: make a carrier to API mapping
    const resp = await FreighttechRegisterSubscription(em, input)

    const { container_id, carrier_code } = resp.reference
    console.debug("[CMD fms_tracking.tracking.register] registered new tracking", { container_id, carrier_code })

    return {
      referenceId: resp.reference.id,
      success: resp.reference.active,
      source: 'freighttech'
    }
  },
}

registerCommand(registerTrackingCommand)
