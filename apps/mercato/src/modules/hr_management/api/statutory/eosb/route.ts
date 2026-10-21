import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { HrEmployee, HrEmployeeCompensation } from '../../../data/entities'
import { computeEosb, type EosbReason } from '../../../lib/payrollService'
import { sumDecimalStrings } from '../../../../financial/lib/money'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
}

const reasonSchema = z.enum(['resignation', 'termination', 'contract_end']).optional()

async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
    const url = new URL(req.url)
    const employeeId = z.string().uuid().parse(url.searchParams.get('employeeId'))
    const reason = (reasonSchema.parse(url.searchParams.get('reason') ?? undefined) ?? 'termination') as EosbReason
    const asOf = url.searchParams.get('asOf') ? new Date(`${url.searchParams.get('asOf')}T00:00:00.000Z`) : new Date()

    const em = (container.resolve('em') as EntityManager).fork()
    const employee = await em.findOne(HrEmployee, { id: employeeId, tenantId: auth.tenantId, organizationId, deletedAt: null })
    if (!employee) throw new CrudHttpError(404, { error: translate('hr_management.errors.employee_not_found', 'The selected employee does not exist.') })
    const compensation = await em.findOne(HrEmployeeCompensation, {
      employeeId,
      tenantId: auth.tenantId,
      organizationId,
      deletedAt: null,
      effectiveFrom: { $lte: asOf },
    }, { orderBy: { effectiveFrom: 'desc' } })
    if (!compensation) {
      return NextResponse.json({ error: translate('hr_management.errors.compensation_not_found', 'The employee has no compensation record.'), code: 'compensation_not_found' }, { status: 409 })
    }
    const lastWage = sumDecimalStrings([
      compensation.basicSalary,
      compensation.housingAllowance,
      compensation.transportAllowance,
      compensation.otherAllowance,
    ])
    const years = Math.max(0, (asOf.getTime() - employee.hireDate.getTime()) / (365.25 * 86_400_000))
    const computation = computeEosb({
      lastWage,
      yearsOfService: years,
      reason,
    })
    return NextResponse.json({
      employeeId,
      currencyCode: compensation.currencyCode,
      lastWage,
      reason,
      ...computation,
      note: translate(
        'hr_management.statutory.eosb_note',
        'The award uses the statutory half-month/full-month shape and a resignation scale. Confirm the applicable articles and the treatment of allowances before settlement.',
      ),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      const { translate } = await resolveTranslations()
      return NextResponse.json({ error: translate('errors.invalid_input', 'Invalid input'), details: err.issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi = {
  tag: 'HR',
  summary: 'End-of-service award estimate',
  methods: {
    GET: {
      summary: 'Award for an employee at a date and reason',
      responses: [{
        status: 200,
        description: 'EOSB',
        schema: z.object({
          employeeId: z.string().uuid(),
          currencyCode: z.string(),
          lastWage: z.string(),
          reason: z.string(),
          serviceYears: z.number(),
          grossEntitlement: z.string(),
          entitlement: z.string(),
          reasonFactor: z.number(),
          note: z.string(),
        }),
      }],
    },
  },
}

export { GET }
