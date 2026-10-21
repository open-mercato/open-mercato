import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { HrEmployee, HrEmployeeCompensation } from '../../../data/entities'
import { computeGosi } from '../../../lib/payrollService'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
}

const DEFAULT_EMPLOYEE_RATE = 0.0975
const DEFAULT_EMPLOYER_RATE = 0.1175
const DEFAULT_BASE_CAP = 45000

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
    const employeeRate = url.searchParams.get('employeeRate') ? Number(url.searchParams.get('employeeRate')) : DEFAULT_EMPLOYEE_RATE
    const employerRate = url.searchParams.get('employerRate') ? Number(url.searchParams.get('employerRate')) : DEFAULT_EMPLOYER_RATE
    const baseCap = url.searchParams.get('baseCap') ? Number(url.searchParams.get('baseCap')) : DEFAULT_BASE_CAP

    const em = (container.resolve('em') as EntityManager).fork()
    const employee = await em.findOne(HrEmployee, { id: employeeId, tenantId: auth.tenantId, organizationId, deletedAt: null })
    if (!employee) throw new CrudHttpError(404, { error: translate('hr_management.errors.employee_not_found', 'The selected employee does not exist.') })
    const compensation = await em.findOne(HrEmployeeCompensation, {
      employeeId,
      tenantId: auth.tenantId,
      organizationId,
      deletedAt: null,
      effectiveFrom: { $lte: new Date() },
    }, { orderBy: { effectiveFrom: 'desc' } })
    if (!compensation) {
      return NextResponse.json({ error: translate('hr_management.errors.compensation_not_found', 'The employee has no compensation record.'), code: 'compensation_not_found' }, { status: 409 })
    }
    const computation = computeGosi({
      basicSalary: compensation.basicSalary,
      housingAllowance: compensation.housingAllowance,
      employeeRate,
      employerRate,
      baseCap,
    })
    return NextResponse.json({
      employeeId,
      currencyCode: compensation.currencyCode,
      ...computation,
      rates: { employeeRate, employerRate, baseCap },
      note: translate(
        'hr_management.statutory.gosi_note',
        'Rates and the contribution base cap are configurable. Confirm the current GOSI rates and treatment of allowances before filing.',
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
  summary: 'GOSI contribution estimate',
  methods: {
    GET: {
      summary: 'Employee and employer contributions for the latest compensation',
      responses: [{
        status: 200,
        description: 'Contribution',
        schema: z.object({
          employeeId: z.string().uuid(),
          currencyCode: z.string(),
          base: z.string(),
          employeeContribution: z.string(),
          employerContribution: z.string(),
          total: z.string(),
          rates: z.object({ employeeRate: z.number(), employerRate: z.number(), baseCap: z.number() }),
          note: z.string(),
        }),
      }],
    },
  },
}

export { GET }
