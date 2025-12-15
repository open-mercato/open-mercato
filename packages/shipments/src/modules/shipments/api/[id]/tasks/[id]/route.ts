// PUT /api/shipments/tasks/[id]
// DELETE /api/shipments/tasks/[id]
import { NextRequest, NextResponse } from 'next/server';
import { createRequestContainer } from '@/lib/di/container';
import { getAuthFromRequest } from '@/lib/auth/server';
import { EntityManager } from '@mikro-orm/postgresql';
import { ShipmentTask } from '../../../../data/entities';

export const metadata = {
    PUT: { requireAuth: true, requireFeatures: ['shipments.shipments.edit'] },
    DELETE: { requireAuth: true, requireFeatures: ['shipments.shipments.edit'] },
};

export async function PUT(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const taskId = params.id;
        const container = await createRequestContainer();
        const em = container.resolve<EntityManager>('em');
        const auth = await getAuthFromRequest(request);

        if (!auth) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const task = await em.findOne(ShipmentTask, {
            id: taskId,
            tenantId: auth.actorTenantId as string,
            organizationId: auth.actorOrgId as string,
        }, { populate: ['assignedTo'] });

        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        const body = await request.json();

        if (body.title !== undefined) task.title = body.title.trim();
        if (body.description !== undefined) task.description = body.description?.trim() || null;
        if (body.status !== undefined) task.status = body.status;
        if (body.assignedToId !== undefined) task.assignedTo = body.assignedToId;

        task.updatedAt = new Date();

        await em.flush();

        return NextResponse.json({
            ok: true,
            item: task,
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const taskId = params.id;
        const container = await createRequestContainer();
        const em = container.resolve<EntityManager>('em');
        const auth = await getAuthFromRequest(request);

        if (!auth) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const task = await em.findOne(ShipmentTask, {
            id: taskId,
            tenantId: auth.actorTenantId as string,
            organizationId: auth.actorOrgId as string,
        });

        if (!task) {
            return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        await em.removeAndFlush(task);

        return NextResponse.json({ ok: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}