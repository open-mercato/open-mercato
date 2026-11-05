import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { getPasswordPolicy } from '@open-mercato/shared/lib/auth/passwordPolicy'
import { buildSecurityOpenApi, securityErrorSchema } from '../openapi'
import type { MfaService } from '../../services/MfaService'

const profileResponseSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  hasPassword: z.boolean(),
  passwordPolicy: z.object({
    minLength: z.number().int().positive(),
    requireDigit: z.boolean(),
    requireUppercase: z.boolean(),
    requireSpecial: z.boolean(),
  }),
  mfa: z.object({
    enabled: z.boolean(),
    enrolledMethods: z.number().int().nonnegative(),
  }),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['security.profile.view'] },
}

export async function GET(req: Request) {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json(
      { error: translate('api.errors.unauthorized', 'Unauthorized') },
      { status: 401 },
    )
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const mfaService = container.resolve<MfaService>('mfaService')
  const user = await findOneWithDecryption(
    em,
    User,
    { id: auth.sub, deletedAt: null },
    undefined,
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  )

  if (!user) {
    return NextResponse.json(
      { error: translate('auth.users.form.errors.notFound', 'User not found') },
      { status: 404 },
    )
  }

  const methods = await mfaService.getUserMethods(auth.sub)

  return NextResponse.json({
    userId: String(user.id),
    email: String(user.email),
    hasPassword: Boolean(user.passwordHash),
    passwordPolicy: getPasswordPolicy(),
    mfa: {
      enabled: methods.length > 0,
      enrolledMethods: methods.length,
    },
  })
}

export const openApi = buildSecurityOpenApi({
  summary: 'Security profile routes',
  methods: {
    GET: {
      summary: 'Get current security profile',
      description: 'Returns current user security profile data and effective password policy.',
      responses: [
        { status: 200, description: 'Security profile payload', schema: profileResponseSchema },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 404, description: 'User not found', schema: securityErrorSchema },
      ],
    },
  },
})
