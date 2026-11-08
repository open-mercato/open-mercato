import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resendStubFixtureCreateSchema } from '../../../data/validators'
import {
  guardResendStubRequest,
  registerResendStubFixture,
  resendStubError,
  resendStubErrorSchema,
} from '../../../lib/resendStub'
import { exampleTag } from '../../openapi'

export const metadata = {
  POST: { requireAuth: false },
}

const fixtureCreatedSchema = z.object({
  id: z.string().uuid(),
  attachments: z.array(z.object({
    id: z.string(),
    filename: z.string().nullable(),
    size: z.number().int(),
    contentType: z.string(),
  })),
})

export async function POST(request: Request) {
  const blocked = await guardResendStubRequest(request, { requireApiKey: true })
  if (blocked) return blocked
  const parsed = resendStubFixtureCreateSchema.safeParse(await readJsonSafe<unknown>(request))
  if (!parsed.success) return resendStubError(422, 'validation_error', 'Invalid fixture payload.')
  const fixture = registerResendStubFixture(parsed.data)
  if (!fixture) return resendStubError(409, 'conflict', 'A fixture with this id is already registered.')
  return Response.json({
    id: fixture.id,
    attachments: fixture.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      size: attachment.content.byteLength,
      contentType: attachment.contentType,
    })),
  }, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Resend stub fixtures (test only)',
  methods: {
    POST: {
      summary: 'Test only: register an inbound email fixture with the Resend stub (OM_ENABLE_RESEND_STUB)',
      description: 'Bearer auth with the stub API key. 404 while the stub is disabled.',
      tags: [exampleTag],
      requestBody: { schema: resendStubFixtureCreateSchema },
      responses: [{ status: 201, description: 'Fixture registered', schema: fixtureCreatedSchema }],
      errors: [
        { status: 401, description: 'Missing API key', schema: resendStubErrorSchema },
        { status: 403, description: 'Invalid API key', schema: resendStubErrorSchema },
        { status: 409, description: 'Fixture id already registered', schema: resendStubErrorSchema },
        { status: 422, description: 'Invalid payload', schema: resendStubErrorSchema },
      ],
    },
  },
}
