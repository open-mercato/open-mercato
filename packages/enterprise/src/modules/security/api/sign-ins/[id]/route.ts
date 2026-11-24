import { NextResponse } from 'next/server'
import { z } from 'zod'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SignInAttempt } from '../../../data/entities'
import { adminSignInDtoSchema, signInDetailParamsSchema } from '../../../data/sign-in-query-validators'
import { securityApiError } from '../../i18n'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import {
  loadSignInUserNames,
  organizationFilter,
  resolveAdminSignInContext,
  signInAdminMetadata,
  signInNotFound,
  toAdminSignInDto,
} from '../_shared'

export const metadata = signInAdminMetadata

export async function GET(request: Request, routeContext: { params: Promise<{ id: string }> }) {
  const context = await resolveAdminSignInContext(request)
  if (context instanceof NextResponse) return context
  const parsed = signInDetailParamsSchema.safeParse(await routeContext.params)
  if (!parsed.success) return securityApiError(400, 'Invalid route parameters')
  const { em, tenantId, organizationIds } = context
  const filter = { tenantId, ...organizationFilter(organizationIds) }
  const scope = { tenantId }
  const attempt = await findOneWithDecryption<SignInAttempt>(em, SignInAttempt, { ...filter, id: parsed.data.id }, undefined, scope)
  if (!attempt) return signInNotFound()

  const [names, previousSuccess] = await Promise.all([
    loadSignInUserNames(em, tenantId, organizationIds, [attempt]),
    attempt.userId
      ? findOneWithDecryption<SignInAttempt>(em, SignInAttempt, {
        ...filter, userId: attempt.userId, result: 'success', occurredAt: { $lt: attempt.occurredAt },
      }, { fields: ['id', 'tenantId', 'organizationId', 'occurredAt'], orderBy: { occurredAt: 'desc', id: 'desc' } }, scope)
      : null,
  ])

  return NextResponse.json({
    ...toAdminSignInDto(attempt, names),
    previousSuccessAt: previousSuccess?.occurredAt.toISOString() ?? null,
  })
}

export const openApi = buildSecurityOpenApi({
  summary: 'Staff sign-in detail',
  methods: {
    GET: {
      summary: 'Get a staff sign-in attempt in the current scope',
      pathParams: signInDetailParamsSchema,
      responses: [{
        status: 200,
        description: 'Sign-in attempt and previous success time',
        schema: adminSignInDtoSchema.extend({ previousSuccessAt: z.string().datetime().nullable() }),
      }],
      errors: [
        { status: 400, description: 'Invalid route parameters', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
        { status: 403, description: 'Forbidden', schema: securityErrorSchema },
        { status: 404, description: 'Sign-in attempt unavailable', schema: securityErrorSchema },
      ],
    },
  },
})
