import { NextRequest } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'

export interface TableColumnConfig {
  data: string
  title: string
  width: number
  type?: 'text' | 'numeric' | 'date' | 'dropdown' | 'checkbox'
  dateFormat?: string
  readOnly?: boolean
  source?: string[]
  renderer?: string
}

const DOCUMENT_CATEGORIES = ['offer', 'invoice', 'customs', 'bill_of_lading', 'other']

const DOCUMENT_COLUMNS: TableColumnConfig[] = [
  {
    data: 'name',
    title: 'Name',
    width: 250,
  },
  {
    data: 'category',
    title: 'Category',
    width: 150,
    type: 'dropdown',
    source: DOCUMENT_CATEGORIES,
    renderer: 'CategoryBadgeRenderer',
  },
  {
    data: 'description',
    title: 'Description',
    width: 300,
  },
  {
    data: 'createdAt',
    title: 'Created At',
    width: 140,
    type: 'date',
    dateFormat: 'dd/MM/yyyy HH:mm',
    readOnly: true,
  },
  {
    data: 'updatedAt',
    title: 'Updated At',
    width: 140,
    type: 'date',
    dateFormat: 'dd/MM/yyyy HH:mm',
    readOnly: true,
  },
]

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request)
    if (!auth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return Response.json({
      columns: DOCUMENT_COLUMNS,
      meta: {
        entity: 'fms_document',
        totalColumns: DOCUMENT_COLUMNS.length,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to generate table config:', error)
    return Response.json(
      {
        error: 'Failed to generate table configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['fms_documents.view'] },
}
