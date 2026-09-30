import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  invitationRevokeCommandSchema,
  type FormInvitationRevokeCommandInput,
} from '../../../../../data/validators'
import {
  attachOperationMetadata,
  buildFormsRouteContext,
  handleRouteError,
  jsonError,
  withMutationGuard,
  withScopedPayload,
} from '../../../../helpers'
import { FORM_INVITATION_RESOURCE_KIND } from '../../../../../commands/invitation'

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['forms.distribute'] },
}

const deleteResponseSchema = z.object({ id: z.string().uuid() })
const errorSchema = z.object({ error: z.string() })

function extractInvitationId(req: Request): string {
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const idx = segments.findIndex((segment) => segment === 'invitations')
  return idx >= 0 ? segments[idx + 1] ?? '' : ''
}

export async function DELETE(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const invitationId = extractInvitationId(req)
    if (!invitationId) return jsonError(400, 'forms.errors.invalid_id')

    const scoped = withScopedPayload({ invitationId }, ctx, translate)
    const input = invitationRevokeCommandSchema.parse(scoped) satisfies FormInvitationRevokeCommandInput

    return await withMutationGuard({
      ctx,
      tenantId,
      organizationId,
      resourceKind: FORM_INVITATION_RESOURCE_KIND,
      resourceId: invitationId,
      operation: 'delete',
      request: req,
      payload: { invitationId },
      run: async () => {
        const commandBus = ctx.container.resolve('commandBus') as CommandBus
        const { result, logEntry } = await commandBus.execute<
          FormInvitationRevokeCommandInput,
          { invitationId: string }
        >('forms.invitation.revoke', { input, ctx })
        const response = NextResponse.json({ id: result?.invitationId ?? invitationId })
        return attachOperationMetadata(
          response,
          logEntry,
          FORM_INVITATION_RESOURCE_KIND,
          result?.invitationId ?? invitationId,
        )
      },
    })
  } catch (error) {
    return handleRouteError('invitations.DELETE', error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Forms',
  summary: 'Revoke an invitation',
  pathParams: z.object({ distributionId: z.string().uuid(), invitationId: z.string().uuid() }),
  methods: {
    DELETE: {
      summary: 'Revoke invitation',
      description:
        'Soft-revokes an invitation — the row is retained and its status becomes revoked so a revoked token resolves to 410 (not 404).',
      responses: [{ status: 200, description: 'Invitation revoked', schema: deleteResponseSchema }],
      errors: [{ status: 404, description: 'Invitation not found', schema: errorSchema }],
    },
  },
}
