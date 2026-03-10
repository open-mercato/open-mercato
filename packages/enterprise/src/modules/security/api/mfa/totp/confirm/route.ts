import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../openapi'
import { mapMfaError, readJsonRecord, readString, resolveMfaRequestContext } from '../../_shared'

const requestSchema = z.object({
  setupId: z.string().min(1),
  code: z.string().min(1),
})

const responseSchema = z.object({
  ok: z.literal(true),
  recoveryCodes: z.array(z.string()).optional(),
})

export const metadata = {
  POST: { requireAuth: true},
}

export async function POST(req: Request) {
  const context = await resolveMfaRequestContext(req)
  if (context instanceof NextResponse) return context

  const body = await readJsonRecord(req)
  const setupId = readString(body.setupId)
  const code = readString(body.code)
  if (!setupId || !code) {
    return NextResponse.json({ error: 'setupId and code are required.' }, { status: 400 })
  }

  try {
    const result = await context.mfaService.confirmTotp(context.auth.sub, setupId, code)
    return NextResponse.json({ ok: true, ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}) })
  } catch (error) {
    return mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'TOTP confirmation routes',
  methods: {
    POST: {
      summary: 'Confirm TOTP setup',
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
      },
      responses: [{ status: 200, description: 'TOTP setup confirmed', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid setup payload', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
  },
})
