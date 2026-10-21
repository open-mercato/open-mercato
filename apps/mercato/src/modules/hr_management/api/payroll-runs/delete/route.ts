import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runHrAction } from '../../payrollAction'
import '../../../commands/payroll'

export const metadata = {
  path: '/hr_management/payroll-runs/delete',
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
}

const schema = z.object({ id: z.string().uuid() })

export async function POST(req: Request) {
  return runHrAction({
    req,
    schema,
    commandId: 'hr_management.payroll_runs.delete',
    resourceKind: 'hr_management:hr_payroll_run',
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to delete the payroll run',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'HR',
  summary: 'Delete a draft payroll run',
  methods: {
    POST: {
      summary: 'Deletes a draft run',
      requestBody: { contentType: 'application/json', schema },
      responses: [{ status: 200, description: 'Deleted', schema: z.object({ id: z.string().uuid() }) }],
    },
  },
}
