import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Shipment } from '../../data/entities'
import { updateShipmentSchema } from '../../data/validators'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { EventBus } from '@open-mercato/events/types'
import { CommandBus, CommandRuntimeContext } from '@/lib/commands'

const paramsSchema = z.object({
    id: z.uuid(),
})

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
    const auth = await getAuthFromRequest(req)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parse = paramsSchema.safeParse({ id: ctx.params?.id })
    if (!parse.success) return NextResponse.json({ error: 'Invalid shipment id' }, { status: 400 })

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const em = container.resolve('em') as EntityManager

    const shipment = await em.findOne(Shipment, { id: parse.data.id }, {
        populate: ['client', 'createdBy', 'assignedTo', 'contactPerson', 'shipper', 'consignee']
    })

    if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })

    if (auth.tenantId && shipment.tenantId !== auth.tenantId) {
        return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
    }

    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)

    if (allowedOrgIds.size && shipment.organizationId && !allowedOrgIds.has(shipment.organizationId)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    return NextResponse.json(shipment)
}

export async function PUT(req: Request, ctx: { params?: { id?: string } }) {
    const auth = await getAuthFromRequest(req)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parse = paramsSchema.safeParse({ id: ctx.params?.id })
    if (!parse.success) return NextResponse.json({ error: 'Invalid shipment id' }, { status: 400 })

    const body = await req.json()
    const validation = updateShipmentSchema.safeParse(body)
    if (!validation.success) {
        return NextResponse.json({ error: 'Invalid input', details: validation.error }, { status: 400 })
    }

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const em = container.resolve('em') as EntityManager

    const shipment = await em.findOne(Shipment, { id: parse.data.id })
    const before = shipment

    if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })

    if (auth.tenantId && shipment.tenantId !== auth.tenantId) {
        return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
    }

    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)

    if (allowedOrgIds.size && shipment.organizationId && !allowedOrgIds.has(shipment.organizationId)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const data = validation.data

    // Define field mappings
    const customerEntityFields = ['clientId', 'shipperId', 'consigneeId', 'contactPersonId']
    const userFields = ['assignedToId']
    const relationshipFields = [...customerEntityFields, ...userFields]

    // Handle CustomerEntity relationships
    for (const field of customerEntityFields) {
        if (field in data) {
            const value = data[field as keyof typeof data]

            if (value) {
                const entity = await em.findOne(CustomerEntity, {
                    id: value as string,
                    deletedAt: null
                })
                if (!entity) continue
                if (field === 'clientId') shipment.client = entity
                else if (field === 'shipperId') shipment.shipper = entity
                else if (field === 'consigneeId') shipment.consignee = entity
                else if (field === 'contactPersonId') shipment.contactPerson = entity
            }
        }
    }

    // Handle User relationships
    for (const field of userFields) {
        if (field in data) {
            const value = data[field as keyof typeof data]

            if (value) {
                const user = await em.findOne(User, { id: value as string })
                if (!user) continue
                if (field === 'assignedToId') shipment.assignedTo = user!
            }
        }
    }

    // Assign scalar fields (excluding relationship IDs)
    const scalarFields = Object.fromEntries(
        Object.entries(data).filter(([key]) => !relationshipFields.includes(key))
    )
    Object.assign(shipment, scalarFields)

    shipment.updatedAt = new Date()

    await em.flush()

    await em.populate(shipment, [
        'client',
        'shipper',
        'consignee',
        'contactPerson',
        'assignedTo'
    ])

    const eventBus = container.resolve<EventBus>('eventBus')
    if (before?.id) {
        await eventBus.emitEvent('shipment.updated', shipment)
    } else {
        await eventBus.emitEvent('shipment.created', shipment)
    }

    const cmdCtx: CommandRuntimeContext = {
        container,
        auth,
        organizationScope: scope,
        selectedOrganizationId: shipment.organizationId,
        organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
        request: req,
    }

    // const commandBus = container.resolve<CommandBus>('commandBus')
    // const cmdRes = await commandBus.execute('shipments.tracking.register', {
    //     input: {
    //         organizationId: shipment.organizationId,
    //         tenantId: shipment.tenantId,
    //         bookingNumber: shipment.bookingNumber,
    //         carrierCode: shipment.carrier,
    //     }, ctx: cmdCtx
    // })

    const command = container.resolve<CommandBus>('commandBus')
    const cmdRes = await command.execute('fms_tracking.tracking.register', {
        ctx: cmdCtx, input: {
            organizationId: shipment.organizationId,
            tenantId: shipment.tenantId,
            bookingNumber: shipment.bookingNumber,
            carrierCode: shipment.carrier,
        }
    })

    // when we add tracking by bookingNumber: populate containers
    // 

    console.log(cmdRes)

    return NextResponse.json(shipment)
}

export async function DELETE(_req: Request, ctx: { params?: { id?: string } }) {
    const auth = await getAuthFromRequest(_req)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parse = paramsSchema.safeParse({ id: ctx.params?.id })
    if (!parse.success) return NextResponse.json({ error: 'Invalid shipment id' }, { status: 400 })

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: _req })
    const em = container.resolve('em') as EntityManager

    const shipment = await em.findOne(Shipment, { id: parse.data.id })

    if (!shipment) return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })

    if (auth.tenantId && shipment.tenantId !== auth.tenantId) {
        return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
    }

    const allowedOrgIds = new Set<string>()
    if (scope?.filterIds?.length) scope.filterIds.forEach((id) => allowedOrgIds.add(id))
    else if (auth.orgId) allowedOrgIds.add(auth.orgId)

    if (allowedOrgIds.size && shipment.organizationId && !allowedOrgIds.has(shipment.organizationId)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    await em.remove(shipment).flush()

    const eventBus = container.resolve('eventBus') as EventBus
    await eventBus.emitEvent('shipment.deleted', shipment)

    return NextResponse.json({ success: true })
}