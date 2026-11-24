import { z } from 'zod'

export const XERO_OPENAPI_TAG = 'Xero'

export const xeroErrorSchema = z.object({ error: z.string(), code: z.string() }).passthrough()

export const xeroScheduleSchema = z.object({
  entityType: z.string(),
  exists: z.boolean(),
  isEnabled: z.boolean(),
  fullSync: z.boolean(),
  scheduleValue: z.string().nullable(),
})

export function xeroRuleOneErrors(feature = 'integrations.credentials.manage') {
  return [
    { status: 400, description: 'No organization could be resolved (code organization_scope_required)', schema: xeroErrorSchema },
    { status: 401, description: 'Unauthorized', schema: xeroErrorSchema },
    {
      status: 403,
      description: `Acting in another tenant, an explicitly empty organization scope, or no ${feature} in the active organization`,
      schema: xeroErrorSchema,
    },
  ]
}
