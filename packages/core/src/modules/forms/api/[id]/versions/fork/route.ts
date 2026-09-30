import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  formVersionForkDraftCommandSchema,
  formVersionForkRequestSchema,
  type FormVersionForkDraftCommandInput,
} from '../../../../data/validators'
import {
  attachOperationMetadata,
  buildFormsRouteContext,
  handleRouteError,
  jsonError,
  withMutationGuard,
  withScopedPayload,
} from '../../../helpers'
import { FORM_VERSION_RESOURCE_KIND } from '../../../../commands/shared'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['forms.design'] },
}

const responseSchema = z.object({
  versionId: z.string().uuid(),
})

const errorSchema = z.object({ error: z.string() })

function extractFormId(req: Request): string {
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const idx = segments.findIndex((segment) => segment === 'forms')
  return idx >= 0 ? segments[idx + 1] ?? '' : ''
}

export async function POST(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const formId = extractFormId(req)
    if (!formId) return jsonError(400, 'forms.errors.invalid_id')

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = formVersionForkRequestSchema.parse(body)
    const scoped = withScopedPayload({ ...parsed, formId }, ctx, translate)
    const input = formVersionForkDraftCommandSchema.parse(scoped) satisfies FormVersionForkDraftCommandInput

    return await withMutationGuard({
      ctx,
      tenantId,
      organizationId,
      resourceKind: FORM_VERSION_RESOURCE_KIND,
      resourceId: 'new',
      operation: 'create',
      request: req,
      payload: scoped as Record<string, unknown>,
      run: async () => {
        const commandBus = ctx.container.resolve('commandBus') as CommandBus
        const { result, logEntry } = await commandBus.execute<FormVersionForkDraftCommandInput, { versionId: string }>(
          'forms.form_version.fork_draft',
          { input, ctx },
        )
        const response = NextResponse.json({ versionId: result?.versionId ?? null }, { status: 201 })
        return attachOperationMetadata(response, logEntry, FORM_VERSION_RESOURCE_KIND, result?.versionId ?? null)
      },
    })
  } catch (error) {
    return handleRouteError('forms[id].versions.fork.POST', error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Forms',
  summary: 'Fork a new draft form version',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Fork draft',
      description:
        'Creates a new draft version. Optionally clones from `fromVersionId`. Rejects if a draft already exists (422 draft_already_exists).',
      requestBody: { contentType: 'application/json', schema: formVersionForkRequestSchema },
      responses: [{ status: 201, description: 'Draft created', schema: responseSchema }],
      errors: [
        { status: 404, description: 'Form not found', schema: errorSchema },
        { status: 422, description: 'Draft already exists', schema: errorSchema },
      ],
    },
  },
}
