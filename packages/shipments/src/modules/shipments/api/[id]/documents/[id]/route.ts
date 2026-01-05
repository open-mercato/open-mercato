// GET /api/shipments/documents/[id] - Get a specific document
import { NextRequest, NextResponse } from 'next/server';
import { createRequestContainer } from '@/lib/di/container';
import { getAuthFromRequest } from '@/lib/auth/server';
import { EntityManager } from '@mikro-orm/postgresql';
import { ShipmentDocument } from '../../../../data/entities';
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities';

export const metadata = {
    requireAuth: true,
    requireFeatures: ['shipments.shipments.view'],
};

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const documentId = params.id;
        const container = await createRequestContainer();
        const em = container.resolve<EntityManager>('em');
        const auth = await getAuthFromRequest(request);

        if (!auth) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const document = await em.findOne(ShipmentDocument, {
            id: documentId,
            tenantId: auth.actorTenantId as string,
            organizationId: auth.actorOrgId as string,
        });

        if (!document) {
            return NextResponse.json(
                { error: 'Document not found' },
                { status: 404 }
            );
        }

        // Fetch attachment details
        const attachment = await em.findOne(Attachment, {
            id: document.attachmentId,
        });

        return NextResponse.json({
            ok: true,
            item: {
                id: document.id,
                shipmentId: document.shipmentId,
                attachmentId: document.attachmentId,
                extractedData: document.extractedData,
                processedAt: document.processedAt,
                createdAt: document.createdAt,
                updatedAt: document.updatedAt,
                attachment: attachment
                    ? {
                        id: attachment.id,
                        fileName: attachment.fileName,
                        mimeType: attachment.mimeType,
                        fileSize: attachment.fileSize,
                        url: attachment.url,
                    }
                    : null,
            },
        });
    } catch (error: any) {
        console.error('[ShipmentDocuments] Get error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}