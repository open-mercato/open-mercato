// API endpoint to get table configuration for shipments
import { NextRequest } from 'next/server';
import { EntityManager } from '@mikro-orm/core';
import { createRequestContainer } from '@/lib/di/container';
import { getAuthFromRequest } from '@/lib/auth/server';
import { Shipment } from '../../data/entities';
import {
    generateTableConfig,
    addRelationshipColumns,
    type TableColumnConfig,
    type DisplayHints
} from './table-config-generator';

// Display configuration for shipments table
const SHIPMENT_DISPLAY_HINTS: DisplayHints = {
    fieldOrder: [
        'internal_reference',
        'booking_number',
        'bol_number',
        'container_number',
        'status',
        'carrier',
        'origin_location',
        'destination_location',
        'etd',
        'atd',
        'eta',
        'ata',
        'mode',
        'incoterms',
        'weight',
        'volume',
        'total_pieces',
        'total_volume',
        'amount',
        'vessel_name',
        'voyage_number',
        'request_date',
        'created_at',
        'updated_at',
    ],

    fieldLabels: {
        internal_reference: 'Internal Ref',
        booking_number: 'Booking #',
        bol_number: 'BOL #',
        container_number: 'Container #',
        origin_location: 'Origin Location',
        destination_location: 'Dest. Location',
        total_pieces: 'Pieces',
        total_volume: 'Total Volume',
        vessel_name: 'Vessel Name',
        voyage_number: 'Voyage #',
        request_date: 'Request Date',
        created_at: 'Created',
        updated_at: 'Updated',
    },

    columnWidths: {
        internal_reference: 150,
        booking_number: 150,
        bol_number: 150,
        container_number: 150,
        status: 150,
    },

    readOnlyFields: [
        'created_at',
        'updated_at',
        'clientName',
        'clientEmail',
        'createdByName',
        'assignedToName',
    ],

    customRenderers: {
        status: 'StatusRenderer',
    },
};

// Relationships to include as display columns
const SHIPMENT_RELATIONSHIPS = [
    { name: 'client', displayFields: ['name', 'email'] },
];

export async function GET(request: NextRequest) {
    try {
        // Basic auth check
        const auth = await getAuthFromRequest(request);
        if (!auth) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get entity manager to access metadata
        const container = await createRequestContainer();
        const em = container.resolve('em') as EntityManager;

        // Get entity metadata from MikroORM
        const metadata = em.getMetadata().get(Shipment.name);

        // Generate base column config from entity metadata
        let columns = generateTableConfig(metadata, SHIPMENT_DISPLAY_HINTS);

        // Add relationship columns
        columns = addRelationshipColumns(columns, SHIPMENT_RELATIONSHIPS);

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