import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../../openapi'
import { securityApiError } from '../../../../i18n'
import { mapSecurityUsersError, resolveSecurityUsersContext } from '../../../_shared'
import { requireSudo } from '../../../../../lib/sudo-middleware'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

const bodySchema = z.object({
  reason: z.string().min(1),
})

const okResponseSchema = z.object({
  ok: z.literal(true),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['security.admin.manage'] },
}

export async function POST(req: Request, routeContext: { params: Promise<{ id: string }> }) {
  const context = await resolveSecurityUsersContext(req)
  if (context instanceof NextResponse) return context

  const parsedParams = paramsSchema.safeParse(await routeContext.params)
  if (!parsedParams.success) {
    return securityApiError(400, 'Invalid user id.', { issues: parsedParams.error.issues })
  }

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    rawBody = {}
  }

  const parsedBody = bodySchema.safeParse(rawBody)
  if (!parsedBody.success) {
    return securityApiError(400, 'Invalid payload', { issues: parsedBody.error.issues })
  }

  try {
    await requireSudo(req, 'security.admin.mfa.reset')
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute('security.admin.mfa.reset', {
      input: {
        userId: parsedParams.data.id,
        reason: parsedBody.data.reason,
      },
      ctx: context.commandContext,
    })
    return NextResponse.json(result)
  } catch (error) {
    return await mapSecurityUsersError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Admin user MFA reset routes',
  methods: {
    POST: {
      summary: 'Reset MFA for user',
      pathParams: paramsSchema,
      requestBody: {
        contentType: 'application/json',
        schema: bodySchema,
      },
      responses: [
        { status: 200, description: 'MFA reset completed', schema: okResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid input', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 403, description: 'Sudo required', schema: securityErrorSchema },
        { status: 404, description: 'User not found', schema: securityErrorSchema },
      ],
    },
  },
})
