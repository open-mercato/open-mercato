import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { EntityManager } from '@mikro-orm/postgresql'
import { ShipmentContainer } from '../../../data/entities'


export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const container = await createRequestContainer()
        const em = container.resolve<EntityManager>('em')
        const shipmentId = params.id

        const containers = await em.find(ShipmentContainer, {
            shipment: shipmentId,
        }, {
            orderBy: { createdAt: 'ASC' },
        })

        return NextResponse.json({ items: containers })
    } catch (error) {
        console.error('Failed to fetch containers:', error)
        return NextResponse.json(
            { error: 'Failed to fetch containers' },
            { status: 500 }
        )
    }
}

