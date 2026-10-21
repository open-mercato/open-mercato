import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runHrAction } from '../../payrollAction'
import '../../../commands/payroll'

export const metadata = {
  path: '/hr_management/payroll-runs/close',
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
}

const schema = z.object({ id: z.string().uuid() })

export async function POST(req: Request) {
  return runHrAction({
    req,
    schema,
    commandId: 'hr_management.payroll_runs.close',
    resolveResourceId: (input) => input.id,
    resourceKind: 'hr_management:hr_payroll_run',
    fallbackError: 'Unable to close the payroll run',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'HR',
  summary: 'Close a payroll run',
  methods: {
    POST: {
      summary: 'Consumes loan instalments, penalties and incentives and emits the payroll-closed event',
      requestBody: { contentType: 'application/json', schema },
      responses: [{ status: 200, description: 'Closed', schema: z.object({ id: z.string().uuid() }) }],
    },
  },
}
