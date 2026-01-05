// src/modules/shipments/vector.ts
import type { VectorModuleConfig } from '@open-mercato/shared/modules/vector'

export const vectorConfig: VectorModuleConfig = {
    defaultDriverId: 'pgvector',
    entities: [
        {
            entityId: 'shipments:shipment',
            buildSource: async (ctx) => {
                console.log('[shipments] buildSource ctx:', {
                    recordId: ctx.record.id,
                    recordKeys: Object.keys(ctx.record),
                    tracking: ctx.record.tracking_number,
                    status: ctx.record.status
                }, JSON.stringify(ctx.record))

                const lines: string[] = []
                const r = ctx.record

                if (r.tracking_number) lines.push(`Tracking: ${r.tracking_number}`)
                if (r.status) lines.push(`Status: ${r.status}`)
                if (r.origin_city) lines.push(`From: ${r.origin_city}`)
                if (r.destination_city) lines.push(`To: ${r.destination_city}`)
                if (r.origin_address) lines.push(`Origin address: ${r.origin_address}`)
                if (r.destination_address) lines.push(`Destination address: ${r.destination_address}`)
                if (r.weight) lines.push(`Weight: ${r.weight} kg`)
                if (r.notes) lines.push(`Notes: ${r.notes}`)
                console.log('[shipments] lines:', lines)
                if (!lines.length) return null

                const subtitle = r.destination_city
                    ? `${r.status} → ${r.destination_city}`
                    : r.status

                return {
                    input: lines,
                    presenter: {
                        title: r.tracking_number || 'Shipment',
                        subtitle,
                        icon: 'truck'
                    },
                    checksumSource: {
                        id: r.id,
                        tracking_number: r.tracking_number,
                        status: r.status,
                        updated_at: r.updated_at
                    }
                }
            },
            formatResult: async ({ record }) => ({
                title: record.tracking_number || 'Shipment',
                subtitle: `${record.status} • ${record.origin_city} → ${record.destination_city}`,
                icon: 'truck'
            }),
            resolveUrl: async ({ record }) => `/backend/shipments?id=${record.id}`
        }
    ]
}

export default vectorConfig
export const config = vectorConfig