// GET /api/shipment-tasks
import { NextRequest, NextResponse } from 'next/server';
import { createRequestContainer } from '@/lib/di/container';
import { getAuthFromRequest } from '@/lib/auth/server';
import { EntityManager } from '@mikro-orm/postgresql';
import { ShipmentTask } from '../../data/entities';

export const metadata = {
    GET: { requireAuth: true, requireFeatures: ['shipments.shipments.view'] },
};

export async function GET(request: NextRequest) {
    try {
        const container = await createRequestContainer();
        const em = container.resolve<EntityManager>('em');
        const auth = await getAuthFromRequest(request);

        if (!auth) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const page = parseInt(searchParams.get('page') || '1', 10);
        const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '10', 10), 100);
        const statusParam = searchParams.get('status');
        const sortBy = searchParams.get('sortBy') || 'createdAt';
        const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'DESC' : 'ASC';

        // Build filter
        const filter: any = {
            tenantId: auth.actorTenantId as string,
            organizationId: auth.actorOrgId as string,
        };

        // Handle status filter - can be comma-separated
        if (statusParam) {
            const statuses = statusParam.split(',').map(s => s.trim()).filter(Boolean);
            if (statuses.length > 0) {
                filter.status = { $in: statuses };
            }
        }

        // Count total
        const total = await em.count(ShipmentTask, filter);

        // Fetch tasks with pagination
        const tasks = await em.find(
            ShipmentTask,
            filter,
            {
                orderBy: { [sortBy]: sortOrder },
                limit: pageSize,
                offset: (page - 1) * pageSize,
                populate: ['assignedTo'],
            }
        );

        return NextResponse.json({
            ok: true,
            items: tasks,
            pagination: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
            },
        });
    } catch (error: any) {
        console.error('Error fetching shipment tasks:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}