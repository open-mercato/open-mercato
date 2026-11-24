import { NextResponse } from 'next/server'
import { z } from 'zod'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SignInAttempt } from '../../data/entities'
import { adminSignInDtoSchema, adminSignInQuerySchema } from '../../data/sign-in-query-validators'
import { securityApiError } from '../i18n'
import { buildSecurityOpenApi, securityErrorSchema } from '../openapi'
import {
  buildAdminSignInFilter,
  loadSignInUserNames,
  resolveAdminSignInContext,
  signInAdminMetadata,
  toAdminSignInDto,
} from './_shared'

export const metadata = signInAdminMetadata

export async function GET(request: Request) {
  const context = await resolveAdminSignInContext(request)
  if (context instanceof NextResponse) return context
  const parsed = adminSignInQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return securityApiError(400, 'Invalid query parameters')
  const { em, tenantId, organizationIds } = context
  const { page, pageSize, sort } = parsed.data
  const order = sort === 'occurredAt:asc' ? 'asc' : 'desc'
  const [attempts, total] = await findAndCountWithDecryption(
    em, SignInAttempt, buildAdminSignInFilter(tenantId, organizationIds, parsed.data),
    { limit: pageSize, offset: (page - 1) * pageSize, orderBy: { occurredAt: order, id: order } },
    { tenantId },
  )
  const names = await loadSignInUserNames(em, tenantId, organizationIds, attempts)

  return NextResponse.json({
    items: attempts.map((attempt) => toAdminSignInDto(attempt, names)),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  })
}

export const openApi = buildSecurityOpenApi({
  summary: 'Staff sign-in activity',
  methods: {
    GET: {
      summary: 'List staff sign-in attempts in the current scope',
      query: adminSignInQuerySchema,
      responses: [{
        status: 200,
        description: 'Paginated sign-in attempts',
        schema: z.object({
          items: z.array(adminSignInDtoSchema),
          total: z.number().int(),
          page: z.number().int(),
          pageSize: z.number().int(),
          totalPages: z.number().int(),
        }),
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
