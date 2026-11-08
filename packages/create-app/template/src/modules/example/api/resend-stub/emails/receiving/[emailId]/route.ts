import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  emailNotFound,
  getResendStubFixture,
  guardResendStubRequest,
  readRouteParam,
  resendStubErrorSchema,
  resendStubReceivedEmailSchema,
  serializeReceivedEmail,
} from '../../../../../lib/resendStub'
import { exampleTag } from '../../../../openapi'

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
  return Response.json(serializeReceivedEmail(fixture))
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Resend stub received email (test only)',
  pathParams: z.object({ emailId: z.string() }),
  methods: {
    GET: {
      summary: 'Test only: Resend `GET /emails/receiving/{id}` for a registered fixture',
      tags: [exampleTag],
      responses: [{ status: 200, description: 'Received email with attachment metadata', schema: resendStubReceivedEmailSchema }],
      errors: [
        { status: 401, description: 'Missing API key', schema: resendStubErrorSchema },
        { status: 403, description: 'Invalid API key', schema: resendStubErrorSchema },
        { status: 404, description: 'Email not found', schema: resendStubErrorSchema },
      ],
    },
  },
}
