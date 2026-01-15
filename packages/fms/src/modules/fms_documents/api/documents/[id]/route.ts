import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { EntityManager } from '@mikro-orm/postgresql'
import { FmsDocument, DocumentCategory } from '../../../data/entities'
import { updateDocumentSchema } from '../../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_documents.view'] },
  PUT: { requireAuth: true, requireFeatures: ['fms_documents.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['fms_documents.delete'] },
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

    const document = await em.findOne(FmsDocument, {
      id: documentId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
    })

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    return NextResponse.json({
      id: document.id,
      name: document.name,
      category: document.category,
      description: document.description,
      attachmentId: document.attachmentId,
      relatedEntityId: document.relatedEntityId,
      relatedEntityType: document.relatedEntityType,
      extractedData: document.extractedData,
      processedAt: document.processedAt,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    })
  } catch (error: any) {
    console.error('[fms-documents] get error:', error)
    return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const documentId = params.id
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const auth = await getAuthFromRequest(request)

    if (!auth || !auth.orgId || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const document = await em.findOne(FmsDocument, {
      id: documentId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
    })

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    const body = await request.json()
    const validatedData = updateDocumentSchema.parse(body)

    // Apply updates
    if (validatedData.name !== undefined) document.name = validatedData.name
    if (validatedData.category !== undefined) document.category = validatedData.category as DocumentCategory
    if (validatedData.description !== undefined) document.description = validatedData.description
    if (validatedData.relatedEntityId !== undefined) document.relatedEntityId = validatedData.relatedEntityId
    if (validatedData.relatedEntityType !== undefined)
      document.relatedEntityType = validatedData.relatedEntityType

    document.updatedBy = auth.sub ?? auth.email ?? null
    document.updatedAt = new Date()

    await em.flush()

    return NextResponse.json({
      ok: true,
      item: {
        id: document.id,
        name: document.name,
        category: document.category,
        updatedAt: document.updatedAt,
      },
    })
  } catch (error: any) {
    console.error('[fms-documents] update error:', error)

    if (error.name === 'ZodError') {
      return NextResponse.json(
        {
          error: 'Validation error',
          details: error.errors,
        },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: 'Failed to update document' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const documentId = params.id
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const auth = await getAuthFromRequest(request)

    if (!auth || !auth.orgId || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const document = await em.findOne(FmsDocument, {
      id: documentId,
      organizationId: auth.orgId,
      tenantId: auth.tenantId,
      deletedAt: null,
    })

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Soft delete
    document.deletedAt = new Date()
    await em.flush()

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('[fms-documents] delete error:', error)
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
  }
}
