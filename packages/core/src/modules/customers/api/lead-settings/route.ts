import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { customerLeadSettingsUpsertSchema } from '../../data/validators'
import { areLeadsEnabled } from '../../commands/settings'
import { buildLeadActionContext, runLeadCommand } from '../leads/runLeadAction'

const logger = createLogger('customers')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.leads.view'] },
  PUT: { requireAuth: true, requireFeatures: ['customers.leads.settings'] },
}

export async function GET(req: Request) {
  try {
    const { ctx, tenantId, organizationId } = await buildLeadActionContext(req, { requireEnabled: false })
    const em = ctx.container.resolve('em') as EntityManager
    const enabled = await areLeadsEnabled(em, { tenantId, organizationId })
    return NextResponse.json({ leadsEnabled: enabled })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    logger.error('customers.lead-settings GET failed', { err })
    return NextResponse.json({ error: 'Failed to load lead settings' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  return runLeadCommand(req, {
    commandId: 'customers.lead_settings.save',
    schema: customerLeadSettingsUpsertSchema,
    resourceKind: 'customers.lead_settings',
    requireEnabled: false,
  })
}

export const openApi = {
  tag: 'Customers',
  summary: 'Lead capability settings',
  methods: {
    GET: {
      summary: 'Read whether the lead capability is enabled',
      responses: [{
        status: 200,
        description: 'Lead settings',
        schema: z.object({ leadsEnabled: z.boolean() }),
      }],
    },
    PUT: {
      summary: 'Enable or disable the lead capability',
      requestBody: { contentType: 'application/json', schema: customerLeadSettingsUpsertSchema },
      responses: [{
        status: 200,
        description: 'Updated',
        schema: z.object({ ok: z.boolean(), settingsId: z.string().uuid(), leadsEnabled: z.boolean() }),
      }],
    },
  },
}
