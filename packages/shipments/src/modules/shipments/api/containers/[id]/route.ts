import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { EntityManager } from '@mikro-orm/postgresql'
import { ShipmentContainer } from '../../../data/entities'
import { updateShipmentContainerSchema } from '../../../data/validators'

export async function PUT(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const container = await createRequestContainer()
        const em = container.resolve<EntityManager>('em')
        const containerId = params.id
        const body = await request.json()

        const validated = updateShipmentContainerSchema.parse(body)
        const containerEntity = await em.findOneOrFail(ShipmentContainer, { id: containerId })

        em.assign(containerEntity, validated)
        containerEntity.updatedAt = new Date()

        await em.persistAndFlush(containerEntity)

        return NextResponse.json(containerEntity)
    } catch (error) {
        console.error('Failed to update container:', error)
        return NextResponse.json(
            { error: 'Failed to update container' },
            { status: 500 }
        )
    }
}