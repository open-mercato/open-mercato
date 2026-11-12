import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  getResendStubFixture,
  guardResendStubRequest,
  readRouteParam,
  resendStubError,
  resendStubErrorSchema,
  verifyResendStubDownloadToken,
} from '../../../../../lib/resendStub'
import { exampleTag } from '../../../../openapi'

export const metadata = {
  GET: { requireAuth: false },
}

type RouteContext = { params?: Record<string, string | string[]> }

export async function GET(request: Request, context: RouteContext) {
  const blocked = await guardResendStubRequest(request, { requireApiKey: false })
  if (blocked) return blocked
  const denied = () => resendStubError(403, 'access_denied', 'Request has expired or the signature does not match.')
  const fixtureId = readRouteParam(context.params, 'fixtureId')
  const attachmentId = readRouteParam(context.params, 'attachmentId')
  const fixture = fixtureId ? getResendStubFixture(fixtureId) : null
  const attachment = fixture?.attachments.find((candidate) => candidate.id === attachmentId) ?? null
  if (!fixture || !attachment) return denied()
  const url = new URL(request.url)
  if (!verifyResendStubDownloadToken(fixture, attachment.id, url.searchParams.get('expires'), url.searchParams.get('token'))) {
    return denied()
  }
  if (fixture.failDownloads) return resendStubError(503, 'service_unavailable', 'Download temporarily unavailable.')
  return new Response(new Uint8Array(attachment.content), {
    status: 200,
    headers: {
      'content-type': attachment.contentType,
      'content-length': String(attachment.content.byteLength),
      'cache-control': 'no-store',
      // Fixture bytes are arbitrary test content: never sniffed or rendered by a browser.
      'content-disposition': 'attachment',
      'x-content-type-options': 'nosniff',
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Resend stub download (test only)',
  pathParams: z.object({ fixtureId: z.string(), attachmentId: z.string() }),
  methods: {
    GET: {
      summary: 'Test only: signed download URL of a fixture attachment (`expires` and `token` query parameters)',
      tags: [exampleTag],
      query: z.object({ expires: z.string(), token: z.string() }),
      responses: [{ status: 200, description: 'Attachment bytes' }],
      errors: [
        { status: 403, description: 'Expired URL or invalid token', schema: resendStubErrorSchema },
        { status: 503, description: 'The fixture failure switch is on', schema: resendStubErrorSchema },
      ],
    },
  },
}
