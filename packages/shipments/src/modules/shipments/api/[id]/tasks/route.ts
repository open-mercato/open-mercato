// GET /api/shipments/[id]/tasks
// POST /api/shipments/[id]/tasks
import { NextRequest, NextResponse } from 'next/server';
import { createRequestContainer } from '@/lib/di/container';
import { getAuthFromRequest } from '@/lib/auth/server';
import { EntityManager } from '@mikro-orm/postgresql';
import { ShipmentTask } from '../../../data/entities';

export const metadata = {
    GET: { requireAuth: true, requireFeatures: ['shipments.shipments.view'] },
    POST: { requireAuth: true, requireFeatures: ['shipments.shipments.edit'] },
};

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const shipmentId = params.id;
        const container = await createRequestContainer();
        const em = container.resolve<EntityManager>('em');
        const auth = await getAuthFromRequest(request);

        if (!auth) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const tasks = await em.find(
            ShipmentTask,
            {
                shipmentId,
                tenantId: auth.actorTenantId as string,
                organizationId: auth.actorOrgId as string,
            },
            { orderBy: { createdAt: 'DESC' }, populate: ['assignedTo'] }
        );

        return NextResponse.json({
            ok: true,
            items: tasks,
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const shipmentId = params.id;
        const container = await createRequestContainer();
        const em = container.resolve<EntityManager>('em');
        const auth = await getAuthFromRequest(request);

        if (!auth) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { title, description, status, assignedToId } = body;

        if (!title?.trim()) {
            return NextResponse.json({ error: 'Title is required' }, { status: 400 });
        }

        const task = em.create(ShipmentTask, {
            shipmentId,
            tenantId: auth.actorTenantId as string,
            organizationId: auth.actorOrgId as string,
            title: title.trim(),
            description: description?.trim() || null,
            assignedTo: assignedToId || null,
            status: status || 'TODO',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        await em.persistAndFlush(task);

        return NextResponse.json({
            ok: true,
            item: task,
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}