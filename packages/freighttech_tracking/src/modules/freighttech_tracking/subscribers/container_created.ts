import { CommandBus } from "@/lib/commands"
import { EntityManager } from "@mikro-orm/core"

export const metadata = {
  event: 'container.created',
  persistent: false,
}

export interface ContainerCreatedEvent {
  organizationId: string
  tenantId: string

  containerID: string
  carrierCode: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerContext = { resolve: <T = any>(name: string) => T }

export default async function handle(payload: ContainerCreatedEvent, ctx: HandlerContext) {
  // const em = ctx.resolve<EntityManager>('em')
  // const commandBus = ctx.resolve<CommandBus>('commandBus')
  
  console.log("EVENT: container.created", payload)
}

