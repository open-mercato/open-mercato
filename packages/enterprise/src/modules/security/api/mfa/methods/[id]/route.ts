import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../openapi'
import { mapMfaError, readUuidParam, resolveMfaRequestContext } from '../../_shared'

const okResponseSchema = z.object({
  ok: z.literal(true),
})

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['security.mfa.manage'] },
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) {
  const requestContext = await resolveMfaRequestContext(req)
  if (requestContext instanceof NextResponse) return requestContext

  const params = await context.params
  const methodId = readUuidParam(params.id)
  if (!methodId) {
    return NextResponse.json({ error: 'Invalid method id.' }, { status: 400 })
  }

  try {
    await requestContext.mfaService.removeMethod(requestContext.auth.sub, methodId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return mapMfaError(error)
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
