import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resendStubFixtureUpdateSchema } from '../../../../data/validators'
import {
  deleteResendStubFixture,
  guardResendStubRequest,
  readRouteParam,
  resendStubError,
  resendStubErrorSchema,
  setResendStubFixtureFailDownloads,
} from '../../../../lib/resendStub'
import { exampleTag } from '../../../openapi'

export const metadata = {
  PATCH: { requireAuth: false },
  DELETE: { requireAuth: false },
}

type RouteContext = { params?: Record<string, string | string[]> }

function fixtureNotFound(): Response {
  return resendStubError(404, 'not_found', 'Fixture not found')
}

export async function PATCH(request: Request, context: RouteContext) {
  const blocked = await guardResendStubRequest(request, { requireApiKey: true })
  if (blocked) return blocked
  const fixtureId = readRouteParam(context.params, 'fixtureId')
  if (!fixtureId) return fixtureNotFound()
  const parsed = resendStubFixtureUpdateSchema.safeParse(await readJsonSafe<unknown>(request))
  if (!parsed.success) return resendStubError(422, 'validation_error', 'Invalid fixture update.')
  const fixture = setResendStubFixtureFailDownloads(fixtureId, parsed.data.failDownloads)
  if (!fixture) return fixtureNotFound()
  return Response.json({ id: fixture.id, failDownloads: fixture.failDownloads })
}

export async function DELETE(request: Request, context: RouteContext) {
  const blocked = await guardResendStubRequest(request, { requireApiKey: true })
  if (blocked) return blocked
  const fixtureId = readRouteParam(context.params, 'fixtureId')
  return Response.json({ ok: true, deleted: fixtureId ? deleteResendStubFixture(fixtureId) : false })
}

const errors = [
  { status: 401, description: 'Missing API key', schema: resendStubErrorSchema },
  { status: 403, description: 'Invalid API key', schema: resendStubErrorSchema },
]

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Resend stub fixture (test only)',
  pathParams: z.object({ fixtureId: z.string() }),
  methods: {
    PATCH: {
      summary: 'Test only: switch the fixture download failure on or off (downloads answer 503 while on)',
      tags: [exampleTag],
      requestBody: { schema: resendStubFixtureUpdateSchema },
      responses: [{ status: 200, description: 'Fixture updated', schema: z.object({ id: z.string(), failDownloads: z.boolean() }) }],
      errors: [...errors, { status: 404, description: 'Fixture not found', schema: resendStubErrorSchema }],
    },
    DELETE: {
      summary: 'Test only: remove a fixture',
      tags: [exampleTag],
      responses: [{ status: 200, description: 'Fixture removed', schema: z.object({ ok: z.literal(true), deleted: z.boolean() }) }],
      errors,
    },
  },
}
