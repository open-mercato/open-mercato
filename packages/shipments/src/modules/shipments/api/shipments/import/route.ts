// Refactored Excel import route
import { NextRequest, NextResponse } from 'next/server';
import { createRequestContainer } from '@/lib/di/container';
import { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '@open-mercato/events/types';
import { ExcelService } from '../../../services/excel-parse.service';
import { LlmService } from '../../../services/llm.service';
import { ShipmentImportService } from '../../../services/shipments-import.service';

export const metadata = {
    POST: { requireAuth: true, requireFeatures: ['shipments.import'] }
};

export async function POST(req: NextRequest, context: any) {
    try {
        // 1. Extract auth context
        const { email, actorOrgId, actorTenantId } = context?.auth ?? {};

        if (!email || !actorOrgId || !actorTenantId) {
            return NextResponse.json(
                { error: 'Missing authentication context' },
                { status: 401 }
            );
        }

        // 2. Validate file upload
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json(
                { error: 'No file uploaded' },
                { status: 400 }
            );
        }

        if (!file.name.match(/\.(xlsx|xls)$/i)) {
            return NextResponse.json(
                { error: 'Invalid file type. Please upload an Excel file (.xlsx or .xls)' },
                { status: 400 }
            );
        }

        // 3. Setup dependencies
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        if (!anthropicKey) {
            return NextResponse.json(
                { error: 'LLM service not configured' },
                { status: 500 }
            );
        }

        const container = await createRequestContainer();
        const em = container.resolve<EntityManager>('em');
        const eventBus = container.resolve<EventBus>('eventBus');

        // 4. Initialize services
        const excelService = new ExcelService();
        const llmService = new LlmService(anthropicKey);
        const importService = new ShipmentImportService(
            excelService,
            llmService,
            em,
            eventBus
        );

        // 5. Execute import
        const result = await importService.importFromExcel(file, {
            email,
            actorOrgId,
            actorTenantId,
        });

        // 6. Return success response
        return NextResponse.json(result);
    } catch (error) {
        console.error('[shipments/import] Import failed:', error);

        if (error instanceof Error) {
            return NextResponse.json(
                {
                    error: 'Import failed',
                    details: error.message,
                },
                { status: 500 }
            );
        }

        return NextResponse.json(
            { error: 'An unexpected error occurred during import' },
            { status: 500 }
        );
    }
}