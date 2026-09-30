import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  formVersionPublishCommandSchema,
  formVersionPublishRequestSchema,
  type FormVersionPublishCommandInput,
} from '../../../../../data/validators'
import {
  attachOperationMetadata,
  buildFormsRouteContext,
  handleRouteError,
  jsonError,
  withMutationGuard,
  withScopedPayload,
} from '../../../../helpers'
import { FORM_VERSION_RESOURCE_KIND } from '../../../../../commands/shared'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['forms.design'] },
}

const responseSchema = z.object({
  versionId: z.string().uuid(),
  versionNumber: z.number().int(),
})

const errorSchema = z.object({ error: z.string() })

function extractIds(req: Request): { formId: string; versionId: string } {
  const url = new URL(req.url)
  const segments = url.pathname.split('/').filter(Boolean)
  const formsIdx = segments.findIndex((segment) => segment === 'forms')
  const versionsIdx = segments.findIndex((segment) => segment === 'versions')
  const formId = formsIdx >= 0 ? segments[formsIdx + 1] ?? '' : ''
  const versionId = versionsIdx >= 0 ? segments[versionsIdx + 1] ?? '' : ''
  return { formId, versionId }
}

export async function POST(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const { formId, versionId } = extractIds(req)
    if (!formId || !versionId) return jsonError(400, 'forms.errors.invalid_id')

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = formVersionPublishRequestSchema.parse(body)
    const scoped = withScopedPayload({ ...parsed, formId, versionId }, ctx, translate)
    const input = formVersionPublishCommandSchema.parse(scoped) satisfies FormVersionPublishCommandInput

    return await withMutationGuard({
      ctx,
      tenantId,
      organizationId,
      resourceKind: FORM_VERSION_RESOURCE_KIND,
      resourceId: versionId,
      operation: 'custom',
      request: req,
      payload: scoped as Record<string, unknown>,
      run: async () => {
        const commandBus = ctx.container.resolve('commandBus') as CommandBus
        const { result, logEntry } = await commandBus.execute<
          FormVersionPublishCommandInput,
          { versionId: string; versionNumber: number }
        >('forms.form_version.publish', { input, ctx })
        const response = NextResponse.json({
          versionId: result?.versionId ?? versionId,
          versionNumber: result?.versionNumber ?? null,
        })
        return attachOperationMetadata(response, logEntry, FORM_VERSION_RESOURCE_KIND, result?.versionId ?? versionId)
      },
    })
  } catch (error) {
    return handleRouteError('forms.versions.publish.POST', error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Forms',
  summary: 'Publish a form version',
  pathParams: z.object({ id: z.string().uuid(), versionId: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Publish version',
      description:
        'Publishes a draft version. Emits forms.form_version.published, advances form.current_published_version_id, and pins registry_version. Rejects with 422 no_op_publish if schema is unchanged.',
      requestBody: { contentType: 'application/json', schema: formVersionPublishRequestSchema },
      responses: [{ status: 200, description: 'Version published', schema: responseSchema }],
      errors: [
        { status: 404, description: 'Version not found', schema: errorSchema },
        { status: 409, description: 'Version is frozen', schema: errorSchema },
        { status: 422, description: 'No-op or schema invalid', schema: errorSchema },
      ],
    },
  },
}
