import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { RecordsJrwaClass } from '../../../data/entities'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['records.jrwa_classes.view'] },
}

export async function GET(request: Request, args: { params: Promise<Record<string, string | string[]>> }) {
  const paramsRaw = await args.params
  const parsed = paramsSchema.safeParse({ id: paramsRaw.id })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const auth = await getAuthFromRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const tenantId = auth.tenantId
  const organizationId = scope?.selectedId ?? auth.orgId
  if (!tenantId || !organizationId) {
    return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
  }

  const item = await em.findOne(RecordsJrwaClass, {
    id: parsed.data.id,
    tenantId,
    organizationId,
    deletedAt: null,
  })
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ item })
}

export const openApi = {
  methods: {
    GET: {
      summary: 'Get JRWA class',
      description: 'Returns a single JRWA class by id.',
      tags: ['Records'],
      params: paramsSchema,
      responses: [
        {
          status: 200,
          description: 'JRWA class',
          schema: z.object({ item: z.any() }),
        },
      ],
    },
  },
}
