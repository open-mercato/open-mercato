import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { FormVersion } from '../../../../data/entities'
import {
  OM_ROOT_KEYWORDS,
  type OmAnswerMappings,
} from '../../../../schema/jsonschema-extensions'
import {
  formVersionPatchRequestSchema,
  formVersionUpdateDraftCommandSchema,
  type FormVersionUpdateDraftCommandInput,
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
  GET: { requireAuth: true, requireFeatures: ['forms.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['forms.design'] },
}

const versionResponseSchema = z.object({
  id: z.string().uuid(),
  formId: z.string().uuid(),
  versionNumber: z.number().int(),
  status: z.enum(['draft', 'published', 'archived']),
  schema: z.record(z.string(), z.unknown()),
  uiSchema: z.record(z.string(), z.unknown()),
  roles: z.array(z.string()),
  schemaHash: z.string(),
  registryVersion: z.string(),
  publishedAt: z.string().nullable(),
  publishedBy: z.string().uuid().nullable(),
  changelog: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * Answer→target mapping (W8 / INT-5). Surfaced as config so consumers can
   * drive entity binding without PII ever touching an event payload.
   */
  answerMappings: z.record(z.string(), z.string()),
})

/**
 * Reads the `x-om-answer-mappings` config off a version schema (W8 / INT-5).
 * The mapping is config — it carries no answers — so it is safe to expose on
 * the authed read API. Consumer flow (e.g. dental-os): on the id-only
 * `forms.submission.submitted` event, the subscriber loads the version via
 * this API (or the runtime context) to read `answerMappings`, fetches the
 * submission answers from the authed by-subject / GDPR export API, then applies
 * the mapping to its own entities. The forms module never writes to any
 * external entity and never emits answers in events (DP-8).
 */
function readAnswerMappings(schema: unknown): OmAnswerMappings {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {}
  const raw = (schema as Record<string, unknown>)[OM_ROOT_KEYWORDS.answerMappings]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: OmAnswerMappings = {}
  for (const [fieldKey, targetPath] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof targetPath === 'string' && targetPath.length > 0) out[fieldKey] = targetPath
  }
  return out
}

const okSchema = z.object({ ok: z.literal(true) })
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

export async function GET(req: Request) {
  try {
    const { ctx, organizationId, tenantId } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const { formId, versionId } = extractIds(req)
    if (!formId || !versionId) return jsonError(400, 'forms.errors.invalid_id')

    const em = ctx.container.resolve('em') as EntityManager
    const version = await em.findOne(FormVersion, {
      id: versionId,
      formId,
      tenantId,
      organizationId,
    })
    if (!version) return jsonError(404, 'forms.errors.version_not_found')

    return NextResponse.json({
      id: version.id,
      formId: version.formId,
      versionNumber: version.versionNumber,
      status: version.status,
      schema: version.schema,
      uiSchema: version.uiSchema,
      roles: [...version.roles],
      schemaHash: version.schemaHash,
      registryVersion: version.registryVersion,
      publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
      publishedBy: version.publishedBy ?? null,
      changelog: version.changelog ?? null,
      archivedAt: version.archivedAt ? version.archivedAt.toISOString() : null,
      createdAt: version.createdAt.toISOString(),
      updatedAt: version.updatedAt.toISOString(),
      answerMappings: readAnswerMappings(version.schema),
    })
  } catch (error) {
    return handleRouteError('forms.versions[versionId].GET', error)
  }
}

export async function PATCH(req: Request) {
  try {
    const { ctx, organizationId, tenantId, translate } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const { formId, versionId } = extractIds(req)
    if (!formId || !versionId) return jsonError(400, 'forms.errors.invalid_id')

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = formVersionPatchRequestSchema.parse(body)
    const scoped = withScopedPayload({ ...parsed, formId, versionId }, ctx, translate)
    const input = formVersionUpdateDraftCommandSchema.parse(scoped) satisfies FormVersionUpdateDraftCommandInput

    return await withMutationGuard({
      ctx,
      tenantId,
      organizationId,
      resourceKind: FORM_VERSION_RESOURCE_KIND,
      resourceId: versionId,
      operation: 'update',
      request: req,
      payload: scoped as Record<string, unknown>,
      run: async () => {
        const commandBus = ctx.container.resolve('commandBus') as CommandBus
        const { result, logEntry } = await commandBus.execute<FormVersionUpdateDraftCommandInput, { versionId: string }>(
          'forms.form_version.update_draft',
          { input, ctx },
        )
        const response = NextResponse.json({ ok: true })
        return attachOperationMetadata(response, logEntry, FORM_VERSION_RESOURCE_KIND, result?.versionId ?? versionId)
      },
    })
  } catch (error) {
    return handleRouteError('forms.versions[versionId].PATCH', error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Forms',
  summary: 'Form version detail and draft updates',
  pathParams: z.object({ id: z.string().uuid(), versionId: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Get version detail',
      description: 'Returns the full schema/uiSchema/roles for a form version.',
      responses: [{ status: 200, description: 'Form version detail', schema: versionResponseSchema }],
      errors: [{ status: 404, description: 'Version not found', schema: errorSchema }],
    },
    PATCH: {
      summary: 'Update draft version',
      description:
        'Updates schema/uiSchema/roles/changelog on a draft version. Rejects with 409 (version_is_frozen) for non-draft versions.',
      requestBody: { contentType: 'application/json', schema: formVersionPatchRequestSchema },
      responses: [{ status: 200, description: 'Draft updated', schema: okSchema }],
      errors: [
        { status: 404, description: 'Version not found', schema: errorSchema },
        { status: 409, description: 'Version is frozen', schema: errorSchema },
        { status: 422, description: 'Schema validation failed', schema: errorSchema },
      ],
    },
  },
}
