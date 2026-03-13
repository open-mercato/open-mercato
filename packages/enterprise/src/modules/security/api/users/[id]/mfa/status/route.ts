import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../../openapi'
import { securityApiError } from '../../../../i18n'
import { mapSecurityUsersError, resolveSecurityUsersContext } from '../../../_shared'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const methodSchema = z.object({
  type: z.string(),
  label: z.string().optional(),
  lastUsed: z.string().datetime().optional(),
})

const statusResponseSchema = z.object({
  enrolled: z.boolean(),
  methods: z.array(methodSchema),
  recoveryCodesRemaining: z.number().int().nonnegative(),
  compliant: z.boolean(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['security.admin.manage'] },
}

export async function GET(req: Request, routeContext: { params: Promise<{ id: string }> }) {
  const context = await resolveSecurityUsersContext(req)
  if (context instanceof NextResponse) return context

  const parsedParams = paramsSchema.safeParse(await routeContext.params)
  if (!parsedParams.success) {
    return securityApiError(400, 'Invalid user id.', { issues: parsedParams.error.issues })
  }

  try {
    const status = await context.mfaAdminService.getUserMfaStatus(parsedParams.data.id)
    return NextResponse.json({
      ...status,
      methods: status.methods.map((method) => ({
        ...method,
        ...(method.lastUsed ? { lastUsed: method.lastUsed.toISOString() } : {}),
      })),
    })
  } catch (error) {
    return await mapSecurityUsersError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Admin user MFA status routes',
  methods: {
    GET: {
      summary: 'Get MFA status for user',
      pathParams: paramsSchema,
      responses: [
        { status: 200, description: 'MFA status', schema: statusResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid user id', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 404, description: 'User not found', schema: securityErrorSchema },
      ],
    },
  },
})
