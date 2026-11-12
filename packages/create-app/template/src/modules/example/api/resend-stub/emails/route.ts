import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resendStubSendEmailSchema } from '../../../data/validators'
import {
  guardResendStubRequest,
  recordResendStubSentEmail,
  resendStubError,
  resendStubErrorSchema,
} from '../../../lib/resendStub'
import { exampleTag } from '../../openapi'

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(request: Request) {
  const blocked = await guardResendStubRequest(request, { requireApiKey: true })
  if (blocked) return blocked
  const parsed = resendStubSendEmailSchema.safeParse(await readJsonSafe<unknown>(request))
  if (!parsed.success) return resendStubError(422, 'validation_error', 'Missing from, to or subject.')
  const sent = recordResendStubSentEmail({
    from: parsed.data.from,
    to: Array.isArray(parsed.data.to) ? parsed.data.to : [parsed.data.to],
    subject: parsed.data.subject,
  })
  return Response.json({ id: sent.id })
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Resend stub send (test only)',
  methods: {
    POST: {
      summary: 'Test only: Resend `POST /emails`; records the message and returns its id',
      tags: [exampleTag],
      requestBody: { schema: resendStubSendEmailSchema },
      responses: [{ status: 200, description: 'Message recorded', schema: z.object({ id: z.string().uuid() }) }],
      errors: [
        { status: 401, description: 'Missing API key', schema: resendStubErrorSchema },
        { status: 403, description: 'Invalid API key', schema: resendStubErrorSchema },
        { status: 422, description: 'Invalid payload', schema: resendStubErrorSchema },
      ],
    },
  },
}
