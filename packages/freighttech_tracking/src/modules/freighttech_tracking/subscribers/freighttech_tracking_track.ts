import { EntityManager } from "@mikro-orm/core"
import { RegisterContainerSubscription } from "../commands/freighttech_api";

export const metadata = {
  event: 'freighttech_tracking.track',
  persistent: false,
}

export interface TrackEvent {
  organizationId: string
  tenantId: string

  bookingNumber?: string
  containerID?: string
  carrierCode: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerContext = { resolve: <T = any>(name: string) => T }

export default async function handle(payload: any, ctx: HandlerContext) {
  const em = ctx.resolve<EntityManager>('em')

  console.debug("[freighttech_tracking.subscribers] event received", payload)
  // todo check if already tracked
  
  const resp = await RegisterContainerSubscription(em, payload)

  console.debug("[freighttech_tracking.subscribers] registered new tracking", resp)
  // todo save response for tracking duplicates
}
