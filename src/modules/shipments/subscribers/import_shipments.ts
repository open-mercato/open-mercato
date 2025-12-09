export const metadata = { event: 'shipments.imported', persistent: false }

type Payload = {
    shipments: any[]
    creatorEmail: string
    tenantId: string
    orgId: string
}

type HandlerContext = { resolve: <T = any>(name: string) => T }

export default async function handle(payload: Payload, ctx: HandlerContext) {
    console.log(`[shipments] Handling imported shipments: ${payload.shipments.length}`)
}