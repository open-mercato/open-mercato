// POST /api/shipments/[id]/documents - Upload document and extract data
import { NextRequest, NextResponse } from 'next/server';
import { createRequestContainer } from '@/lib/di/container';
import { getAuthFromRequest } from '@/lib/auth/server';
import { EntityManager } from '@mikro-orm/postgresql';
import { ShipmentDocument } from '../../../data/entities';
import { LlmService } from '../../../services/llm.service';
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities';
import { randomUUID } from 'crypto';
import { buildAttachmentFileUrl } from '@open-mercato/core/modules/attachments/lib/imageUrls';
import { storePartitionFile } from '@open-mercato/core/modules/attachments/lib/storage';
import { resolveDefaultPartitionCode } from '@open-mercato/core/modules/attachments/lib/partitions';


export const metadata = {
    requireAuth: true,
    requireFeatures: ['shipments.shipments.edit', 'shipments.shipments.view'],
};


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

        // Parse the form data
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        // Get API key from environment
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: 'Anthropic API key not configured' },
                { status: 500 }
            );
        }

        // Step 1: Create attachment directly
        const arrayBuffer = await file.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);
        const safeName = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');

        // Resolve partition code
        const resolvedPartitionCode = resolveDefaultPartitionCode('attachments:library');
        const partition = await em.findOne(AttachmentPartition, { code: resolvedPartitionCode });

        if (!partition) {
            return NextResponse.json(
                { error: 'Storage partition not configured' },
                { status: 500 }
            );
        }

        // Store file
        let stored;
        try {
            stored = await storePartitionFile({
                partitionCode: partition.code,
                orgId: auth.actorOrgId! as string,
                tenantId: auth.actorTenantId! as string,
                fileName: safeName,
                buffer: fileBuffer,
            });
        } catch (error) {
            console.error('[shipment-documents] failed to persist file', error);
            return NextResponse.json({ error: 'Failed to persist attachment' }, { status: 500 });
        }

        // Create attachment
        const attachmentId = randomUUID();
        const attachment = em.create(Attachment, {
            id: attachmentId,
            entityId: 'shipments:shipment',
            recordId: shipmentId,
            tenantId: auth.actorTenantId! as string,
            organizationId: auth.actorOrgId! as string,
            fileName: safeName,
            mimeType: file.type || 'application/pdf',
            fileSize: file.size,
            partitionCode: partition.code,
            storageDriver: partition.storageDriver || 'local',
            storagePath: stored.storagePath,
            url: buildAttachmentFileUrl(attachmentId),
            storageMetadata: {
                assignments: [{ type: 'shipments:shipment', id: shipmentId }],
            },
        });

        await em.persistAndFlush(attachment);

        // Step 2: Create ShipmentDocument record
        const shipmentDoc = em.create(ShipmentDocument, {
            shipmentId,
            attachmentId: attachment.id,
            tenantId: auth.actorTenantId! as string,
            organizationId: auth.actorOrgId! as string,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        await em.persistAndFlush(shipmentDoc);


        // Step 3: Extract data from PDF using LlmService
        try {
            const llmService = new LlmService(apiKey);
            const base64Data = fileBuffer.toString('base64');

            const extractedData = await llmService.extractShipmentData(base64Data);

            shipmentDoc.extractedData = extractedData as Record<string, any>;
            shipmentDoc.processedAt = new Date();

            // Store extracted data in attachment metadata
            attachment.storageMetadata = {
                ...attachment.storageMetadata,
                extractedData,
                extractedAt: new Date().toISOString(),
            };

            await em.flush();

            return NextResponse.json({
                ok: true,
                item: {
                    id: attachment.id,
                    fileName: attachment.fileName,
                    extractedData,
                },
            });
        } catch (error: any) {
            console.error('Extraction failed:', error);

            attachment.storageMetadata = {
                ...attachment.storageMetadata,
                extractionError: error.message || 'Extraction failed',
            };

            await em.flush();

            return NextResponse.json({
                ok: true,
                item: {
                    id: attachment.id,
                    fileName: attachment.fileName,
                    extractedData: null,
                    error: error.message,
                },
            });
        }
    } catch (error: any) {
        console.error('[ShipmentDocuments] Upload error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}

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

        const documents = await em.find(
            ShipmentDocument,
            {
                shipmentId,
                tenantId: auth.actorTenantId as string,
                organizationId: auth.actorOrgId as string,
            },
            {
                orderBy: { createdAt: 'DESC' },
            }
        );

        // Fetch attachment details
        const attachmentIds = documents.map((doc) => doc.attachmentId);
        const attachments = attachmentIds.length
            ? await em.find('Attachment', { id: { $in: attachmentIds } })
            : [];

        const attachmentMap = new Map(
            attachments.map((att: any) => [att.id, att])
        );

        const items = documents.map((doc) => {
            const attachment = attachmentMap.get(doc.attachmentId);
            return {
                id: doc.id,
                shipmentId: doc.shipmentId,
                attachmentId: doc.attachmentId,
                extractedData: doc.extractedData,
                processedAt: doc.processedAt,
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
                attachment: attachment
                    ? {
                        id: attachment.id,
                        fileName: attachment.fileName,
                        mimeType: attachment.mimeType,
                        fileSize: attachment.fileSize,
                        url: attachment.url,
                    }
                    : null,
            };
        });

        return NextResponse.json({
            ok: true,
            items,
            total: items.length,
        });
    } catch (error: any) {
        console.error('[ShipmentDocuments] List error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
