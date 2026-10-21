import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runHrAction } from '../../payrollAction'
import { updateLoanSchema } from '../../../data/validators'
import '../../../commands/payroll'

export const metadata = {
  path: '/hr_management/loans/update',
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
}

export async function POST(req: Request) {
  return runHrAction({
    req,
    schema: updateLoanSchema,
    commandId: 'hr_management.loans.update',
    resourceKind: 'hr_management:hr_employee_loan',
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to update the loan',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'HR',
  summary: 'Update a pending employee loan',
  methods: {
    POST: {
      summary: 'Updates reason or notes on a pending loan',
      requestBody: { contentType: 'application/json', schema: updateLoanSchema },
      responses: [{ status: 200, description: 'Updated', schema: z.object({ id: z.string().uuid() }) }],
    },
  },
}
