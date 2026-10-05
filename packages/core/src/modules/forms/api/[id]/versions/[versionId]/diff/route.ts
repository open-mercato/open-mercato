import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { FormVersion } from '../../../../../data/entities'
import { formVersionDiffQuerySchema } from '../../../../../data/validators'
import { buildFormsRouteContext, handleRouteError, jsonError } from '../../../../helpers'
import type { FormVersionCompiler } from '../../../../../services/form-version-compiler'
import type { FormVersionDiffer } from '../../../../../services/form-version-differ'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['forms.view'] },
}

const fieldDescriptorSchema = z.object({
  key: z.string(),
  type: z.string(),
  sectionKey: z.string().nullable(),
  sensitive: z.boolean(),
  editableBy: z.array(z.string()),
  visibleTo: z.array(z.string()),
  required: z.boolean(),
})

const fieldDiffSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('added'), key: z.string(), field: fieldDescriptorSchema }),
  z.object({ kind: z.literal('removed'), key: z.string(), field: fieldDescriptorSchema }),
  z.object({
    kind: z.literal('modified'),
    key: z.string(),
    changes: z.array(
      z.object({ path: z.string(), before: z.unknown(), after: z.unknown() }),
    ),
  }),
])

const responseSchema = z.object({
  base: z.object({
    id: z.string().uuid(),
    versionNumber: z.number().int(),
    schemaHash: z.string(),
  }),
  against: z.object({
    id: z.string().uuid(),
    versionNumber: z.number().int(),
    schemaHash: z.string(),
  }),
  diff: z.array(fieldDiffSchema),
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

export async function GET(req: Request) {
  try {
    const { ctx, organizationId, tenantId } = await buildFormsRouteContext(req)
    if (!organizationId || !tenantId) {
      return jsonError(400, 'forms.errors.organization_required')
    }
    const { formId, versionId } = extractIds(req)
    if (!formId || !versionId) return jsonError(400, 'forms.errors.invalid_id')

    const url = new URL(req.url)
    const queryRaw = { against: url.searchParams.get('against') ?? '' }
    const parsed = formVersionDiffQuerySchema.parse(queryRaw)

    const em = ctx.container.resolve('em') as EntityManager
    const [base, against] = await Promise.all([
      em.findOne(FormVersion, { id: versionId, formId, tenantId, organizationId }),
      em.findOne(FormVersion, {
        id: parsed.against,
        formId,
        tenantId,
        organizationId,
      }),
    ])
    if (!base) return jsonError(404, 'forms.errors.version_not_found')
    if (!against) return jsonError(404, 'forms.errors.version_not_found')

    const compiler = ctx.container.resolve('formVersionCompiler') as FormVersionCompiler
    const differ = ctx.container.resolve('formVersionDiffer') as FormVersionDiffer

    const baseCompiled = compiler.compile({
      id: base.id,
      updatedAt: base.updatedAt,
      schema: base.schema,
      uiSchema: base.uiSchema,
    })
    const againstCompiled = compiler.compile({
      id: against.id,
      updatedAt: against.updatedAt,
      schema: against.schema,
      uiSchema: against.uiSchema,
    })

    return NextResponse.json({
      base: {
        id: base.id,
        versionNumber: base.versionNumber,
        schemaHash: baseCompiled.schemaHash,
      },
      against: {
        id: against.id,
        versionNumber: against.versionNumber,
        schemaHash: againstCompiled.schemaHash,
      },
      diff: differ.diff(againstCompiled, baseCompiled),
    })
  } catch (error) {
    return handleRouteError('forms.versions.diff.GET', error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Forms',
  summary: 'Compute a structural diff between two form versions',
  pathParams: z.object({ id: z.string().uuid(), versionId: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Diff form versions',
      description:
        'Returns added/removed/modified fields between the URL `versionId` (newer) and the `against` query param (older).',
      query: formVersionDiffQuerySchema,
      responses: [{ status: 200, description: 'Diff payload', schema: responseSchema }],
      errors: [{ status: 404, description: 'Version not found', schema: errorSchema }],
    },
  },
}
