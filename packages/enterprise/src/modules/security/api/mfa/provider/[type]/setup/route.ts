import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../../openapi'
import { mapMfaError, readJsonRecord, readString, resolveMfaRequestContext } from '../../../_shared'

const paramsSchema = z.object({
  type: z.string().min(1),
})

const setupResponseSchema = z.object({
  providerType: z.string(),
  setupId: z.string(),
  clientData: z.record(z.string(), z.unknown()),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['security.mfa.manage'] },
}

export async function POST(req: Request, context: { params: Promise<{ type: string }> }) {
  const requestContext = await resolveMfaRequestContext(req)
  if (requestContext instanceof NextResponse) return requestContext

  const body = await readJsonRecord(req)
  const params = await context.params
  const providerType = readString(params.type)
  if (!providerType) {
    return NextResponse.json({ error: 'Invalid provider type.' }, { status: 400 })
  }

  try {
    const setup = await requestContext.mfaService.setupMethod(
      requestContext.auth.sub,
      providerType,
      body,
    )

    return NextResponse.json({
      providerType,
      setupId: setup.setupId,
      clientData: setup.clientData,
    })
  } catch (error) {
    return mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'MFA provider setup routes',
  methods: {
    POST: {
      summary: 'Begin provider setup',
      pathParams: paramsSchema,
      requestBody: {
        contentType: 'application/json',
        schema: z.record(z.string(), z.unknown()).optional(),
      },
      responses: [{ status: 200, description: 'Provider setup created', schema: setupResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid provider type or payload', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
  },
})
