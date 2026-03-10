import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { buildSecurityOpenApi, securityErrorSchema } from '../../../openapi'
import { mapMfaError, resolveMfaRequestContext } from '../../_shared'

const responseSchema = z.object({
  ok: z.literal(true),
  recoveryCodes: z.array(z.string()),
})

export const metadata = {
  POST: { requireAuth: true },
}

export async function POST(req: Request) {
  const context = await resolveMfaRequestContext(req)
  if (context instanceof NextResponse) return context

  try {
    const commandBus = context.container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute('security.mfa.recovery_codes.regenerate', {
      input: {},
      ctx: context.commandContext,
    })
    return NextResponse.json(result)
  } catch (error) {
    return mapMfaError(error)
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Recovery code routes',
  methods: {
    POST: {
      summary: 'Regenerate recovery codes',
      responses: [{ status: 200, description: 'Recovery codes regenerated', schema: responseSchema }],
      errors: [{ status: 401, description: 'Unauthorized', schema: securityErrorSchema }],
    },
  },
})
