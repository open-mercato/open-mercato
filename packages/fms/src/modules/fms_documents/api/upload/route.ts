import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { EntityManager } from '@mikro-orm/postgresql'
import { FmsDocument, DocumentCategory } from '../../data/entities'
import { uploadDocumentSchema } from '../../data/validators'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { randomUUID } from 'crypto'
import { buildAttachmentFileUrl } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { storePartitionFile } from '@open-mercato/core/modules/attachments/lib/storage'

export const metadata = {
  POST: {
    requireAuth: true,
    requireFeatures: ['fms_documents.upload'],
  },
}

export async function POST(request: NextRequest) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const auth = await getAuthFromRequest(request)

    if (!auth || !auth.orgId || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Store validated auth values for type safety
    const orgId = auth.orgId
    const tenantId = auth.tenantId
    const userId = auth.sub ?? auth.email ?? null

    // Parse form data
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Parse and validate metadata
    const metadata = {
      name: formData.get('name'),
      category: formData.get('category'),
      description: formData.get('description'),
      relatedEntityId: formData.get('relatedEntityId'),
      relatedEntityType: formData.get('relatedEntityType'),
    }

    const validatedMetadata = uploadDocumentSchema.parse(metadata)

    // Store file first (filesystem operation, before transaction)
    const arrayBuffer = await file.arrayBuffer()
    const fileBuffer = Buffer.from(arrayBuffer)
    const safeName = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')

    const partitionCode = 'fmsDocuments'
    let stored
    try {
      stored = await storePartitionFile({
        partitionCode: partitionCode,
        orgId: orgId,
        tenantId: tenantId,
        fileName: safeName,
        buffer: fileBuffer,
      })
    } catch (error) {
      console.error('[fms-documents] failed to persist file', error)
      return NextResponse.json({ error: 'Failed to persist attachment' }, { status: 500 })
    }

    // Wrap all database operations in a transaction
    const result = await em.transactional(async (em) => {
      // Get or create fmsDocuments partition
      let partition = await em.findOne(AttachmentPartition, { code: partitionCode })

      if (!partition) {
        // Create partition if it doesn't exist
        partition = em.create(AttachmentPartition, {
          code: partitionCode,
          title: 'FMS Documents',
          description: 'Documents for freight management (offers, invoices, customs, BOL)',
          storageDriver: 'local',
          isPublic: false,
          requiresOcr: false,
        })
        await em.persist(partition)
      }

      // Generate IDs upfront to handle circular reference between document and attachment
      const documentId = randomUUID()
      const attachmentId = randomUUID()

      // Create FmsDocument record
      const document = em.create(FmsDocument, {
        id: documentId,
        organizationId: orgId,
        tenantId: tenantId,
        name: validatedMetadata.name,
        category: validatedMetadata.category as DocumentCategory,
        description: validatedMetadata.description || null,
        attachmentId: attachmentId,
        relatedEntityId: validatedMetadata.relatedEntityId || null,
        relatedEntityType: validatedMetadata.relatedEntityType || null,
        createdBy: userId,
        updatedBy: userId,
      })

      // Create attachment record
      const attachment = em.create(Attachment, {
        id: attachmentId,
        entityId: 'fms_documents:fms_document',
        recordId: documentId,
        tenantId: tenantId,
        organizationId: orgId,
        fileName: safeName,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        partitionCode: partition.code,
        storageDriver: partition.storageDriver || 'local',
        storagePath: stored.storagePath,
        url: buildAttachmentFileUrl(attachmentId),
        storageMetadata: {
          originalName: file.name,
        },
      })

      // Persist both entities (transaction will auto-commit on success)
      await em.persist([document, attachment])

      return { document, attachment }
    })

    const { document, attachment } = result

    return NextResponse.json({
      ok: true,
      item: {
        id: document.id,
        name: document.name,
        category: document.category,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        attachmentId: attachment.id,
        url: attachment.url,
        createdAt: document.createdAt,
      },
    })
  } catch (error: any) {
    console.error('[fms-documents] upload error:', error)

    if (error.name === 'ZodError') {
      return NextResponse.json(
        {
          error: 'Validation error',
          details: error.errors,
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Upload failed',
        message: error.message || 'Unknown error',
      },
      { status: 500 }
    )
  }
}
