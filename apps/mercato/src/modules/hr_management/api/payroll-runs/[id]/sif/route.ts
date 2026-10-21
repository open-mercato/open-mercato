import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { HrEmployee, HrPayrollRun, HrPayslip, HrPayslipLine } from '../../../../data/entities'
import { buildWpsSif, type WpsRow } from '../../../../lib/payrollService'
import { sumDecimalStrings } from '../../../../../financial/lib/money'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
}

/**
 * WPS-style salary-transfer file for one closed or calculated run.
 *
 * The columns are the common SIF shape, not a specific bank's certified layout:
 * a bank adapter remaps the header, detail and trailer records. The file is
 * downloadable before the run is closed so an operator can reconcile it, and the
 * response says nothing about the bank accepting it.
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })
    const em = (container.resolve('em') as EntityManager).fork()
    const run = await em.findOne(HrPayrollRun, { id, tenantId: auth.tenantId, organizationId, deletedAt: null })
    if (!run) throw new CrudHttpError(404, { error: translate('hr_management.errors.record_not_found', 'Record not found.') })
    const payslips = await em.find(HrPayslip, { payrollRunId: run.id })
    const employees = await em.find(HrEmployee, {
      id: { $in: payslips.map((payslip) => payslip.employeeId) },
      tenantId: auth.tenantId,
      organizationId,
    })
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]))
    const lines = payslips.length > 0
      ? await em.find(HrPayslipLine, { payslipId: { $in: payslips.map((payslip) => payslip.id) } })
      : []
    const rows: WpsRow[] = payslips.map((payslip) => {
      const employee = employeeById.get(payslip.employeeId)
      const employeeLines = lines.filter((line) => line.payslipId === payslip.id)
      const basicSalary = sumDecimalStrings(employeeLines.filter((line) => line.code === 'basic').map((line) => line.amount))
      const allowances = sumDecimalStrings(employeeLines
        .filter((line) => line.code === 'allowance' || line.code === 'overtime' || line.code === 'incentive')
        .map((line) => line.amount))
      return {
        employeeNumber: employee?.employeeNumber ?? payslip.employeeId.slice(0, 8),
        name: employee ? `${employee.firstName} ${employee.lastName}`.trim() : payslip.employeeId.slice(0, 8),
        iban: employee?.bankIban ?? '',
        basicSalary,
        allowances,
        deductions: payslip.deductionAmount,
        netAmount: payslip.netAmount,
      }
    })
    const sif = buildWpsSif(rows, { fileDate: run.paymentDate.toISOString().slice(0, 10).replace(/-/g, '') })
    return new NextResponse(sif, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="wps-${run.periodStart.toISOString().slice(0, 10)}.sif"`,
        'x-sif-status': 'unverified-bank-format',
      },
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
