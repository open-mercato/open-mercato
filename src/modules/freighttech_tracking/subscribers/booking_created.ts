import { CommandBus } from "@/lib/commands"
import { EntityManager } from "@mikro-orm/core"
import { freighttechApiKey } from "../commands/settings"
import axios from 'axios';

export const metadata = {
  event: 'booking.created',
  persistent: false,
}

export interface BookingCreatedEvent {
  organizationId: string
  tenantId: string

  bookingNumber: string
  carrierCode: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerContext = { resolve: <T = any>(name: string) => T }

export default async function handle(payload: any, ctx: HandlerContext) {
  // const em = ctx.resolve<EntityManager>('em')
  // const commandBus = ctx.resolve<CommandBus>('commandBus')

  console.log("EVENT: booking.created", payload)
}


type ContainerSubscriptionParams = {
  organizationId: string;
  tenantId: string;
  bookingNumber?: string;
  containerId?: string;
  carrierCode: string;
}

async function RegisterContainerSubscription(
  em: EntityManager,
  { organizationId, tenantId, carrierCode, bookingNumber, containerId }: ContainerSubscriptionParams,
) {
  const apiKey = await freighttechApiKey(em, { organizationId, tenantId })

  const instance = axios.create({
    baseURL: 'https://tables-staging.freighttech.org/api',
    timeout: 1000,
    headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' }
  });

  const response = await instance.post('/v1/references', {
    data: {
      carrier_code: carrierCode,
      booking_number: bookingNumber,
      container_id: containerId,

      callback_url: `${process.env.APP_URL}/api/freighttech_tracking/webhook`,
    }
  });
}