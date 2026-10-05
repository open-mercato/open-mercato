import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  invitationSendCommandSchema,
  type FormInvitationSendCommandInput,
} from '../../../../../../data/validators'
import {
  attachOperationMetadata,
  buildFormsRouteContext,
  handleRouteError,
  jsonError,
  withMutationGuard,
  withScopedPayload,
} from '../../../../../helpers'
import { FORM_INVITATION_RESOURCE_KIND } from '../../../../../../commands/invitation'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['forms.distribute'] },
}

const sendResponseSchema = z.object({ id: z.string().uuid() })
const errorSchema = z.object({ error: z.string() })

function extractInvitationId(req: Request): string {
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const idx = segments.findIndex((segment) => segment === 'invitations')
  return idx >= 0 ? segments[idx + 1] ?? '' : ''
}

export async function POST(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const invitationId = extractInvitationId(req)
    if (!invitationId) return jsonError(400, 'forms.errors.invalid_id')

    const scoped = withScopedPayload({ invitationId }, ctx, translate)
    const input = invitationSendCommandSchema.parse(scoped) satisfies FormInvitationSendCommandInput

    return await withMutationGuard({
      ctx,
      tenantId,
      organizationId,
      resourceKind: FORM_INVITATION_RESOURCE_KIND,
      resourceId: invitationId,
      operation: 'custom',
      request: req,
      payload: { invitationId },
      run: async () => {
        const commandBus = ctx.container.resolve('commandBus') as CommandBus
        const { result, logEntry } = await commandBus.execute<
          FormInvitationSendCommandInput,
          { invitationId: string }
        >('forms.invitation.send', { input, ctx })
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
    return handleRouteError('invitations.send.POST', error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Forms',
  summary: 'Send or resend an invitation',
  pathParams: z.object({ distributionId: z.string().uuid(), invitationId: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Send invitation',
      description:
        'Marks the invitation sent (sent_at, send_count += 1) and emits forms.invitation.sent so the email subscriber dispatches a reminder. Also the resend path.',
      responses: [{ status: 200, description: 'Invitation send tracked', schema: sendResponseSchema }],
      errors: [
        { status: 404, description: 'Invitation not found', schema: errorSchema },
        { status: 409, description: 'Invitation revoked or already submitted', schema: errorSchema },
        { status: 422, description: 'Invitation has no recipient email', schema: errorSchema },
      ],
    },
  },
}
