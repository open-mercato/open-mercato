import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../openapi'
import { mapMfaError, readJsonRecord, readString, resolveMfaRequestContext } from '../../_shared'

const paramsSchema = z.object({
  providername: z.string().min(1),
})

const setupResponseSchema = z.object({
  providerType: z.string(),
  setupId: z.string(),
  clientData: z.record(z.string(), z.unknown()),
})

const confirmRequestSchema = z.object({
  setupId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
})

const confirmResponseSchema = z.object({
  ok: z.literal(true),
  recoveryCodes: z.array(z.string()).optional(),
})

export const metadata = {
  POST: { requireAuth: true },
  PUT: { requireAuth: true },
}

export async function POST(req: Request, context: { params: Promise<{ providername: string }> }) {
  const requestContext = await resolveMfaRequestContext(req)
  if (requestContext instanceof NextResponse) return requestContext

  const body = await readJsonRecord(req)
  const params = await context.params
  const providerType = readString(params.providername)
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

export async function PUT(req: Request, context: { params: Promise<{ providername: string }> }) {
  const requestContext = await resolveMfaRequestContext(req)
  if (requestContext instanceof NextResponse) return requestContext

  const body = await readJsonRecord(req)
  const params = await context.params
  const providerType = readString(params.providername)
  if (!providerType) {
    return NextResponse.json({ error: 'Invalid provider type.' }, { status: 400 })
  }

  const setupId = readString(body.setupId)
  if (!setupId) {
    return NextResponse.json({ error: 'setupId is required.' }, { status: 400 })
  }

  const payload = body.payload && typeof body.payload === 'object'
    ? body.payload
    : Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'setupId'))

  try {
    const result = await requestContext.mfaService.confirmMethod(
      requestContext.auth.sub,
      setupId,
      payload,
      providerType,
    )
    return NextResponse.json({
      ok: true,
      ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}),
    })
  } catch (error) {
    return mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'MFA provider routes',
  methods: {
    POST: {
      summary: 'Begin MFA provider setup',
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
    PUT: {
      summary: 'Confirm MFA provider setup',
      pathParams: paramsSchema,
      requestBody: {
        contentType: 'application/json',
        schema: confirmRequestSchema,
      },
      responses: [{ status: 200, description: 'Provider setup confirmed', schema: confirmResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid provider type or payload', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
  },
})
