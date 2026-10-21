import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runHrAction } from '../../payrollAction'
import '../../../commands/payroll'

export const metadata = {
  path: '/hr_management/loans/delete',
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
}

const schema = z.object({ id: z.string().uuid() })

export async function POST(req: Request) {
  return runHrAction({
    req,
    schema,
    commandId: 'hr_management.loans.delete',
    resourceKind: 'hr_management:hr_employee_loan',
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to delete the loan',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'HR',
  summary: 'Delete a pending employee loan',
  methods: {
    POST: {
      summary: 'Deletes a pending loan and its schedule',
      requestBody: { contentType: 'application/json', schema },
      responses: [{ status: 200, description: 'Deleted', schema: z.object({ id: z.string().uuid() }) }],
    },
  },
}
