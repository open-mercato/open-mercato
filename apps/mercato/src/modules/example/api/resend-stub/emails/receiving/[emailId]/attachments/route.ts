import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resendStubListAttachmentsQuerySchema } from '../../../../../../data/validators'
import {
  emailNotFound,
  getResendStubFixture,
  guardResendStubRequest,
  readRouteParam,
  resendStubAttachmentDataSchema,
  resendStubError,
  resendStubErrorSchema,
  serializeAttachmentData,
} from '../../../../../../lib/resendStub'
import { exampleTag } from '../../../../../openapi'

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
  const url = new URL(request.url)
  const query = resendStubListAttachmentsQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    after: url.searchParams.get('after') ?? undefined,
  })
  if (!query.success) return resendStubError(422, 'validation_error', 'Invalid pagination parameters.')
  let start = 0
  if (query.data.after) {
    const cursorIndex = fixture.attachments.findIndex((attachment) => attachment.id === query.data.after)
    if (cursorIndex === -1) return resendStubError(422, 'validation_error', 'Unknown cursor.')
    start = cursorIndex + 1
  }
  const page = fixture.attachments.slice(start, start + query.data.limit)
  return Response.json({
    object: 'list',
    has_more: start + page.length < fixture.attachments.length,
    data: page.map((attachment) => serializeAttachmentData(request, fixture, attachment)),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Resend stub attachment list (test only)',
  pathParams: z.object({ emailId: z.string() }),
  methods: {
    GET: {
      summary: 'Test only: Resend `GET /emails/receiving/{id}/attachments`, paged with `limit` and the `after` cursor',
      tags: [exampleTag],
      query: resendStubListAttachmentsQuerySchema,
      responses: [{
        status: 200,
        description: 'One page of attachments with signed download URLs',
        schema: z.object({ object: z.literal('list'), has_more: z.boolean(), data: z.array(resendStubAttachmentDataSchema) }),
      }],
      errors: [
        { status: 401, description: 'Missing API key', schema: resendStubErrorSchema },
        { status: 403, description: 'Invalid API key', schema: resendStubErrorSchema },
        { status: 404, description: 'Email not found', schema: resendStubErrorSchema },
        { status: 422, description: 'Invalid pagination parameters', schema: resendStubErrorSchema },
      ],
    },
  },
}
