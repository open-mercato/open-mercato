import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { CustomerLeadHistory } from '../../../data/entities'
import { buildLeadActionContext } from '../runLeadAction'

const logger = createLogger('customers')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.leads.view'] },
}

export async function GET(req: Request) {
  try {
    const { ctx, tenantId, organizationId } = await buildLeadActionContext(req)
    const url = new URL(req.url)
    const leadId = url.searchParams.get('leadId')
    if (!leadId || !z.string().uuid().safeParse(leadId).success) {
      return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
    }
    const em = ctx.container.resolve('em') as EntityManager
    const entries = await em.find(
      CustomerLeadHistory,
      { leadId, tenantId, organizationId },
      { orderBy: { createdAt: 'desc' }, limit: 200 },
    )
    return NextResponse.json({
      items: entries.map((entry) => ({
        id: entry.id,
        entryType: entry.entryType,
        actorUserId: entry.actorUserId ?? null,
        message: entry.message ?? null,
        payload: entry.payload ?? null,
        createdAt: entry.createdAt,
      })),
      total: entries.length,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customers.leads.history GET failed', { err })
    return NextResponse.json({ error: 'Failed to load lead history' }, { status: 500 })
  }
}

const itemSchema = z.object({
  id: z.string().uuid(),
  entryType: z.string(),
  actorUserId: z.string().uuid().nullable(),
  message: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
})

export const openApi = {
  tag: 'Customers',
  summary: 'Lead history timeline',
  methods: {
    GET: {
      summary: 'List the history entries for a lead',
      query: z.object({ leadId: z.string().uuid() }),
      responses: [{
        status: 200,
        description: 'Lead history',
        schema: z.object({ items: z.array(itemSchema), total: z.number() }),
      }],
    },
  },
}
