import { z } from 'zod'
import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type {
  AgentModelUsageRegistryItem,
  AgentModelUsageService,
} from '../../lib/compliance/modelUsageService'
import { agentOrchestratorTag } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
}

const querySchema = z.object({ format: z.enum(['json', 'csv']).default('json') })

const itemSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  dataLocation: z.string(),
  retentionPolicy: z.string(),
  runCount: z.number().int().nonnegative(),
  firstUsedAt: z.string(),
  lastUsedAt: z.string(),
})

const responseSchema = z.object({ items: z.array(itemSchema) })
const errorSchema = z.object({ error: z.string() })

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(items: AgentModelUsageRegistryItem[]): string {
  const header: Array<keyof AgentModelUsageRegistryItem> = [
    'providerId',
    'modelId',
    'dataLocation',
    'retentionPolicy',
    'runCount',
    'firstUsedAt',
    'lastUsedAt',
  ]
  const rows = items.map((item) => header.map((key) => csvCell(item[key])).join(','))
  return [header.join(','), ...rows].join('\n')
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }
  const url = new URL(req.url)
  const parsed = querySchema.safeParse({ format: url.searchParams.get('format') ?? undefined })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })

  const container = await createRequestContainer()
  const service = container.resolve<AgentModelUsageService>('agentModelUsageService')
  const items = await service.registry({ tenantId: auth.tenantId, organizationId: auth.orgId })
  if (parsed.data.format === 'csv') {
    return new Response(toCsv(items), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="open-mercato-ai-model-usage.csv"',
        'Cache-Control': 'no-store',
      },
    })
  }
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
}

export const openApi: OpenApiRouteDoc = {
  tag: agentOrchestratorTag,
  summary: 'Export tenant AI model usage',
  methods: {
    GET: {
      summary: 'List providers and models actually used by this tenant',
      description:
        'Returns an aggregated tenant- and organization-scoped registry with model, provider, processing-location, retention-policy and first/last-use evidence. Pass format=csv for a downloadable export. Requires agent_orchestrator.trace.view.',
      query: querySchema,
      responses: [{ status: 200, description: 'Model usage registry in JSON or CSV', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query or missing tenant context', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view', schema: errorSchema },
      ],
    },
  },
}
