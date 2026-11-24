import { NextResponse } from 'next/server'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SignInAttempt } from '../../../data/entities'
import { profileSignInDtoSchema, profileSignInQuerySchema } from '../../../data/sign-in-query-validators'
import { securityApiError } from '../../i18n'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { resolveSignInContext, toProfileSignInDto } from '../../sign-ins/_shared'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['security.profile.view'] },
}

const userIdSchema = z.string().uuid()

export async function GET(request: Request) {
  const context = await resolveSignInContext(request)
  if (context instanceof NextResponse) return context
  const userId = userIdSchema.safeParse(context.auth.sub)
  if (!userId.success) return securityApiError(403, 'Forbidden')
  const parsed = profileSignInQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return securityApiError(400, 'Invalid query parameters')

  const { em, tenantId, config } = context
  const days = parsed.data.days ?? Math.min(30, config.retentionDays)
  if (days > config.retentionDays) return securityApiError(400, 'Invalid query parameters')
  const since = new Date(Date.now() - days * 86_400_000)
  const attempts = await findWithDecryption(em, SignInAttempt, {
    tenantId, userId: userId.data, occurredAt: { $gte: since },
  }, {
    limit: parsed.data.limit,
    orderBy: { occurredAt: 'desc', id: 'desc' },
  }, { tenantId })

  return NextResponse.json({ items: attempts.map(toProfileSignInDto) })
}

export const openApi = buildSecurityOpenApi({
  summary: 'Personal sign-in activity',
  methods: {
    GET: {
      summary: 'Get recent sign-in attempts for the current user',
      query: profileSignInQuerySchema,
      responses: [{
        status: 200,
        description: 'Personal sign-in attempts',
        schema: z.object({ items: z.array(profileSignInDtoSchema) }),
      }],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 403, description: 'Forbidden', schema: securityErrorSchema },
        { status: 404, description: 'Sign-in activity disabled', schema: securityErrorSchema },
      ],
    },
  },
})
