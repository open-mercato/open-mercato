import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import {
  draftIntentIssue,
  getMockupBySlug,
  mockupWritesEnabled,
  writeAnnotations,
} from '../../../../mockups/loader'
import {
  designSystemTag,
  mockupAnnotationsRequestSchema,
  mockupAnnotationsResponseSchema,
  mockupErrorSchema,
} from '../../openapi'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['design_system.mockups.manage'] },
} as const

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown } | null)?.features
  return Array.isArray(features)
    ? features.filter((value): value is string => typeof value === 'string')
    : []
}

/**
 * Dev-mode-only annotation write-back: rewrites the `status` / `userStory` /
 * `note` fields of named blocks in a discovered mockup document. 404 outside
 * development; the resolved path must be a discovered mockup inside the repo
 * working tree (no client-supplied paths).
 */
export async function PUT(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  // Dev gate first — outside development this surface does not exist at all.
  if (!mockupWritesEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await params
  const mockup = getMockupBySlug(slug)
  if (!mockup) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: unknown = null
  try {
    body = await req.json()
  } catch {
    body = null
  }
  const parsedBody = mockupAnnotationsRequestSchema.safeParse(body)
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        issues: parsedBody.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      },
      { status: 400 },
    )
  }

  // Phase 3 never-auto-final guard: the draft flag only leaves a document
  // through the explicit finalize intent.
  const draftIssue = draftIntentIssue(parsedBody.data)
  if (draftIssue) {
    return NextResponse.json({ error: draftIssue }, { status: 422 })
  }

  // Mutation-guard contract for this custom write route (packages/core/AGENTS.md
  // → API Routes). The write targets a repo file (no tenant record, no
  // optimistic-lock version), so the default OSS guard short-circuits; wiring
  // it keeps the route on the shared write-guard interception path.
  const container = await createRequestContainer()
  const guardInput: MutationGuardInput = {
    tenantId: auth.tenantId ?? '',
    organizationId: auth.orgId ?? null,
    userId: auth.sub,
    resourceKind: 'design_system.mockup',
    resourceId: slug,
    operation: 'update',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsedBody.data,
  }
  const guard = bridgeLegacyGuard(container)
  let afterSuccessCallbacks: Awaited<ReturnType<typeof runMutationGuards>>['afterSuccessCallbacks'] = []
  if (guard) {
    const guardResult = await runMutationGuards([guard], guardInput, {
      userFeatures: resolveUserFeatures(auth),
    })
    if (!guardResult.ok) {
      return NextResponse.json(
        guardResult.errorBody ?? { error: 'Mutation blocked' },
        { status: guardResult.errorStatus ?? 422 },
      )
    }
    afterSuccessCallbacks = guardResult.afterSuccessCallbacks
  }

  const result = writeAnnotations(
    mockup,
    parsedBody.data.blocks,
    undefined,
    parsedBody.data.documentFindings,
    parsedBody.data.finalize === true,
  )
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.issues ? { issues: result.issues } : {}) },
      { status: result.status },
    )
  }

  for (const callback of afterSuccessCallbacks) {
    if (!callback.guard.afterSuccess) continue
    try {
      await callback.guard.afterSuccess({
        tenantId: auth.tenantId ?? '',
        organizationId: auth.orgId ?? null,
        userId: auth.sub,
        resourceKind: 'design_system.mockup',
        resourceId: slug,
        operation: 'update',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: callback.metadata,
      })
    } catch (error) {
      // Committed writes still return successfully; callback failures are logged.
      console.error('design_system mockup annotation afterSuccess callback failed', error)
    }
  }

  return NextResponse.json({ ok: true, counts: result.counts, documentHash: result.documentHash })
}

export const openApi = {
  PUT: {
    summary: 'Rewrite mockup block annotations (development only)',
    description:
      'Rewrites only the annotation fields (status, userStory, note, and — Phase 2 — findings, plus optional screen-level documentFindings) of the named blocks. Phase 3: `finalize: true` is the explicit intent that clears the document draft flag — a `draft` field without it is rejected with 422 (a draft is never auto-finalized). Available exclusively when the app runs in development and the resolved document lives inside the repo working tree; 404 otherwise.',
    tags: [designSystemTag],
    requestBody: {
      content: { 'application/json': { schema: mockupAnnotationsRequestSchema } },
    },
    responses: {
      200: {
        description: 'Annotations written',
        content: { 'application/json': { schema: mockupAnnotationsResponseSchema } },
      },
      404: {
        description: 'Unknown slug, or the app is not running in development',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
      422: {
        description: 'Unknown block ids or the write would produce an invalid document',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
    },
  },
}
