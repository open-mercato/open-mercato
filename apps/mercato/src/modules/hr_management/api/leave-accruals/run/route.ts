import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { runHrAction } from '../../payrollAction'
import { runLeaveAccrualSchema } from '../../../data/validators'
import '../../../commands/leaveAccrual'

export const metadata = {
  path: '/hr_management/leave-accruals/run',
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
}

const resultSchema = z.object({
  created: z.number().int(),
  skipped: z.number().int(),
  daysAdded: z.string(),
})

export async function POST(req: Request) {
  return runHrAction({
    req,
    schema: runLeaveAccrualSchema,
    commandId: 'hr_management.leave_accruals.run',
    resourceKind: 'hr_management:hr_leave_accrual',
    resolveResourceId: () => '',
    fallbackError: 'Unable to run leave accrual',
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'HR',
  summary: 'Run leave accrual',
  methods: {
    POST: {
      summary: 'Accrues one month of leave for the entitlements it covers; re-running the month is a no-op',
      requestBody: { contentType: 'application/json', schema: runLeaveAccrualSchema },
      responses: [{ status: 200, description: 'Accrual run result', schema: resultSchema }],
    },
  },
}
