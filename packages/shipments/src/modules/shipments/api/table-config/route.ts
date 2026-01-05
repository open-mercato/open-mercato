// API endpoint to get table configuration for shipments
import { NextRequest } from 'next/server';
import { EntityManager } from '@mikro-orm/core';
import { createRequestContainer } from '@/lib/di/container';
import { getAuthFromRequest } from '@/lib/auth/server';
import { Shipment } from '../../data/entities';
import { generateTableConfig, type DisplayHints } from './table-config-generator';

// Minimal display hints - only specify overrides, not hardcoded field lists
const SHIPMENT_DISPLAY_HINTS: DisplayHints = {
    hiddenFields: [
        'client',
        'shipper',
        'consignee',
        'contactPerson',
        'createdBy',
        'assignedTo',
    ],

    readOnlyFields: [
        'createdAt',
        'updatedAt',
    ],

    customRenderers: {
        status: 'StatusRenderer',
    },
};

export async function GET(request: NextRequest) {
    try {
        const auth = await getAuthFromRequest(request);
        if (!auth) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const container = await createRequestContainer();
        const em = container.resolve('em') as EntityManager;
        const metadata = em.getMetadata().get(Shipment.name);

        const columns = generateTableConfig(metadata, SHIPMENT_DISPLAY_HINTS);

        return Response.json({
            columns,
            meta: {
                entity: 'shipment',
                totalColumns: columns.length,
                generatedAt: new Date().toISOString(),
            }
        });

    } catch (error) {
        console.error('Failed to generate table config:', error);
        return Response.json(
            {
                error: 'Failed to generate table configuration',
                message: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}

export const metadata = {
    GET: { requireAuth: true },
};
