import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { EntityManager } from '@mikro-orm/postgresql'
import { FmsDocument } from '../../../../data/entities'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { resolveAttachmentAbsolutePath } from '@open-mercato/core/modules/attachments/lib/storage'
import { promises as fs } from 'fs'

export const metadata = {
  GET: {
    requireAuth: true,
    requireFeatures: ['fms_documents.view'],
  },
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const documentId = params.id
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const auth = await getAuthFromRequest(request)

    if (!auth || !auth.orgId || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find document with scope check
    const document = await em.findOne(FmsDocument, {
      id: documentId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
    })

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Find attachment
    const attachment = await em.findOne(Attachment, {
      id: document.attachmentId,
    })

    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }

    // Resolve file path
    const filePath = resolveAttachmentAbsolutePath(
      attachment.partitionCode,
      attachment.storagePath,
      attachment.storageDriver
    )

    // Check if file exists
    try {
      await fs.access(filePath)
    } catch {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 })
    }

    // Read file
    const fileBuffer = await fs.readFile(filePath)

    // Return file with proper headers
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': attachment.mimeType || 'application/octet-stream',
        'Content-Length': String(fileBuffer.length),
        'Content-Disposition': `attachment; filename="${attachment.fileName}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error: any) {
    console.error('[fms-documents] download error:', error)
    return NextResponse.json(
      {
        error: 'Download failed',
        message: error.message || 'Unknown error',
      },
      { status: 500 }
    )
  }
}
