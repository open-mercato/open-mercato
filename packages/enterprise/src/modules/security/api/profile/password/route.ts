import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { changePasswordSchema } from '../../../data/validators'
import { buildSecurityOpenApi, securityErrorSchema } from '../../openapi'
import { localizeSecurityApiBody } from '../../i18n'

const changePasswordResponseSchema = z.object({
  ok: z.literal(true),
})

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>
type Auth = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>

function buildCommandContext(container: RequestContainer, auth: Auth, req: Request): CommandRuntimeContext {
  return {
    container,
    auth,
    organizationScope: null,
    selectedOrganizationId: auth.orgId ?? null,
    organizationIds: auth.orgId ? [auth.orgId] : null,
    request: req,
  }
}

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['security.profile.password'] },
}

export async function PUT(req: Request) {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json(
      { error: translate('api.errors.unauthorized', 'Unauthorized') },
      { status: 401 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const parsed = changePasswordSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: translate('api.errors.invalidPayload', 'Invalid payload.'), issues: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const container = await createRequestContainer()
    const commandBus = container.resolve<CommandBus>('commandBus')
    await commandBus.execute('security.password.change', {
      input: parsed.data,
      ctx: buildCommandContext(container, auth, req),
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(await localizeSecurityApiBody(error.body), { status: error.status })
    }
    console.error('security.profile.password.update failed', error)
    return NextResponse.json(
      { error: translate('security.profile.password.form.errors.save', 'Failed to update password.') },
      { status: 400 },
    )
  }
}

export const openApi = buildSecurityOpenApi({
  summary: 'Security password routes',
  methods: {
    PUT: {
      summary: 'Change current user password',
      description: 'Changes password for the authenticated user and requires the current password.',
      requestBody: {
        contentType: 'application/json',
        schema: changePasswordSchema,
      },
      responses: [
        { status: 200, description: 'Password updated', schema: changePasswordResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid payload or password validation error', schema: securityErrorSchema },
        { status: 401, description: 'Unauthorized', schema: securityErrorSchema },
      ],
    },
  },
})
