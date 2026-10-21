import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runHrAction } from '../../payrollAction'
import '../../../commands/payroll'

export const metadata = {
  path: '/hr_management/payroll-runs/submit',
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
}

const schema = z.object({ id: z.string().uuid() })

export async function POST(req: Request) {
  return runHrAction({
    req,
    schema,
    commandId: 'hr_management.payroll_runs.submit',
    resourceKind: 'hr_management:hr_payroll_run',
    resolveResourceId: (input) => input.id,
    fallbackError: 'Unable to submit the payroll run',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'HR',
  summary: 'Submit a payroll run for approval',
  methods: {
    POST: {
      summary: 'Creates an approval request against the configured payroll workflow',
      requestBody: { contentType: 'application/json', schema },
      responses: [{ status: 200, description: 'Submitted', schema: z.object({ id: z.string().uuid(), approvalRequestId: z.string().uuid() }) }],
    },
  },
}
