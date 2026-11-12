import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  attachmentNotFound,
  emailNotFound,
  getResendStubFixture,
  guardResendStubRequest,
  readRouteParam,
  resendStubAttachmentDataSchema,
  resendStubErrorSchema,
  serializeAttachmentData,
} from '../../../../../../../lib/resendStub'
import { exampleTag } from '../../../../../../openapi'

export const metadata = {
  GET: { requireAuth: false },
}

type RouteContext = { params?: Record<string, string | string[]> }

export async function GET(request: Request, context: RouteContext) {
  const blocked = await guardResendStubRequest(request, { requireApiKey: true })
  if (blocked) return blocked
  const emailId = readRouteParam(context.params, 'emailId')
  const fixture = emailId ? getResendStubFixture(emailId) : null
  if (!fixture) return emailNotFound()
  const attachmentId = readRouteParam(context.params, 'attachmentId')
  const attachment = fixture.attachments.find((candidate) => candidate.id === attachmentId)
  if (!attachment) return attachmentNotFound()
  return Response.json({ object: 'attachment', ...serializeAttachmentData(request, fixture, attachment) })
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Resend stub attachment (test only)',
  pathParams: z.object({ emailId: z.string(), attachmentId: z.string() }),
  methods: {
    GET: {
      summary: 'Test only: Resend `GET /emails/receiving/{id}/attachments/{attachmentId}` with a fresh signed download URL',
      tags: [exampleTag],
      responses: [{
        status: 200,
        description: 'Attachment with a signed download URL',
        schema: resendStubAttachmentDataSchema.extend({ object: z.literal('attachment') }),
      }],
      errors: [
        { status: 401, description: 'Missing API key', schema: resendStubErrorSchema },
        { status: 403, description: 'Invalid API key', schema: resendStubErrorSchema },
        { status: 404, description: 'Email or attachment not found', schema: resendStubErrorSchema },
      ],
    },
  },
}
