import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { HrPayslip, HrPayslipLine } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
    const payslipId = new URL(req.url).searchParams.get('id')
    if (!payslipId) throw new CrudHttpError(400, { error: translate('hr_management.errors.record_id_required', 'Record id is required.') })
    const em = (container.resolve('em') as EntityManager).fork()
    const payslip = await em.findOne(HrPayslip, { id: payslipId, tenantId: auth.tenantId, organizationId })
    if (!payslip) throw new CrudHttpError(404, { error: translate('hr_management.errors.record_not_found', 'Record not found.') })
    const lines = await em.find(HrPayslipLine, { payslipId }, { orderBy: { sequence: 'asc' } })
    const items = lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      code: line.code,
      label: line.label,
      amount: line.amount,
      source_entity_type: line.sourceEntityType ?? null,
      source_entity_id: line.sourceEntityId ?? null,
      sequence: line.sequence,
    }))
    return NextResponse.json({ items, total: items.length, page: 1, pageSize: items.length, totalPages: 1 })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('hr_management.errors.action_failed', 'Unable to load the payslip lines') }, { status: 400 })
  }
}

export const openApi = {
  tag: 'HR',
  summary: 'Payslip lines',
  methods: {
    GET: {
      summary: 'The lines of one payslip, with their source rows',
      responses: [{
        status: 200,
        description: 'Lines',
        schema: z.object({
          items: z.array(z.object({
            id: z.string().uuid(),
            kind: z.string(),
            code: z.string(),
            label: z.string(),
            amount: z.string(),
            source_entity_type: z.string().nullable(),
            source_entity_id: z.string().uuid().nullable(),
            sequence: z.number(),
          })),
          total: z.number(),
          page: z.number(),
          pageSize: z.number(),
          totalPages: z.number(),
        }),
      }],
    },
  },
}
