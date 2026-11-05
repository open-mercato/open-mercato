import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { loadSupportTicketCategories } from '../../../../lib/support/dictionaries'
import { resolveRoutableCategoryValues } from '../../../../lib/support/routing'
import {
  PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE,
  PORTAL_SUPPORT_TICKETS_VIEW_FEATURE,
  resolveSupportPortalScope,
} from '../../../../lib/support/portalTickets'
import { portalErrorResponse } from '../../../../lib/support/portalRoute'
import { loadPortalAttachmentsApi } from '../../../../lib/support/portalAttachments'

export const metadata: { requireAuth?: boolean } = { requireAuth: false }

const optionsResponseSchema = z.object({
  categories: z.array(z.object({ value: z.string(), label: z.string() })),
  canCreate: z.boolean(),
  maxUploadBytes: z.number().int().positive().nullable(),
})

export async function GET(req: Request) {
  try {
    const scope = await resolveSupportPortalScope(req, PORTAL_SUPPORT_TICKETS_VIEW_FEATURE)
    if (scope instanceof Response) return scope
    const supportScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
    const categories = await loadSupportTicketCategories(scope.em, supportScope)
    const routes = await resolveRoutableCategoryValues(scope.em, supportScope, categories.map((category) => category.value))
    const routable = categories.filter((category) => routes.has(category.value))
    const canManage = await scope.hasFeature(PORTAL_SUPPORT_TICKETS_MANAGE_FEATURE)
    const attachmentsApi = await loadPortalAttachmentsApi()
    const maxUploadBytes = attachmentsApi ? attachmentsApi.resolveAttachmentMaxBytes() : null
    return NextResponse.json(
      optionsResponseSchema.parse({
        categories: routable,
        canCreate: canManage && routable.length > 0,
        maxUploadBytes: maxUploadBytes && maxUploadBytes > 0 ? maxUploadBytes : null,
      }),
    )
  } catch (err) {
    return portalErrorResponse(err, 'staff portal support options GET failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff Portal',
  summary: 'Support ticket form options',
  methods: {
    GET: {
      summary: 'Support ticket form options',
      description:
        'Categories the signed-in customer can file a ticket in — only those that currently route to a usable project — whether the caller may create tickets (`portal.support_tickets.manage`), and the server upload size limit in bytes (`maxUploadBytes`, `null` when the attachments module is unavailable).',
      responses: [{ status: 200, description: 'Options', schema: optionsResponseSchema }],
      errors: [
        { status: 401, description: 'No portal session' },
        { status: 403, description: 'Portal account not linked to a customer, or missing portal.support_tickets.view' },
      ],
    },
  },
}
