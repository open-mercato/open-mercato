import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ExcelService } from '../../services/excel-parse.service'
import { LocationImportService } from '../../services/location-import.service'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['fms_locations.import'] },
}

export async function POST(req: NextRequest, context: any) {
  try {
    const { email, actorOrgId, actorTenantId, userId } = context?.auth ?? {}

    if (!email || !actorOrgId || !actorTenantId) {
      return NextResponse.json({ error: 'Missing authentication context' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload an Excel (.xlsx, .xls) or CSV file.' },
        { status: 400 }
      )
    }

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')

    const excelService = new ExcelService()
    const importService = new LocationImportService(excelService, em)

    const result = await importService.importFromFile(file, {
      email,
      actorOrgId,
      actorTenantId,
      actorUserId: userId,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[fms_locations/import] Import failed:', error)

    if (error instanceof Error) {
      return NextResponse.json(
        {
          error: 'Import failed',
          details: error.message,
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { error: 'An unexpected error occurred during import' },
      { status: 500 }
    )
  }
}
