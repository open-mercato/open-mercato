import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../openapi'
import { securityApiError } from '../../../i18n'
import { mapMfaError, readUuidParam, resolveMfaRequestContext } from '../../_shared'

const okResponseSchema = z.object({
  ok: z.literal(true),
})

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export const metadata = {
  DELETE: { requireAuth: true },
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const requestContext = await resolveMfaRequestContext(req)
  if (requestContext instanceof NextResponse) return requestContext

  const params = await context.params
  const methodId = readUuidParam(params.id)
  if (!methodId) {
    return securityApiError(400, 'Invalid method id.')
  }

  try {
    const commandBus = requestContext.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute('security.mfa.method.remove', {
      input: { id: methodId },
      ctx: requestContext.commandContext,
    })
    return NextResponse.json(result)
  } catch (error) {
    return await mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'MFA method mutation routes',
  methods: {
    DELETE: {
      summary: 'Remove MFA method',
      pathParams: paramsSchema,
      responses: [{ status: 200, description: 'MFA method removed', schema: okResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid method id', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 404, description: 'Method not found', schema: securityErrorSchema },
      ],
    },
  },
})
