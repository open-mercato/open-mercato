import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  bridgeLegacyGuard,
  runMutationGuards,
  type MutationGuardInput,
} from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import {
  getMockupBySlug,
  loadCopyFileFor,
  mockupWritesEnabled,
  writeMockupDocument,
} from '../../../mockups/loader'
import { checkMockupIntegrity, loadGalleryEntryMap } from '../../../mockups/integrity'
import { mockupDocument } from '../../../mockups/schema'
import {
  designSystemTag,
  mockupDetailResponseSchema,
  mockupDocumentPutRequestSchema,
  mockupDocumentPutResponseSchema,
  mockupErrorSchema,
} from '../openapi'

const logger = createLogger('design_system').child({ component: 'api' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['design_system.view'] },
  PUT: { requireAuth: true, requireFeatures: ['design_system.mockups.manage'] },
} as const

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const mockup = getMockupBySlug(slug)
  if (!mockup) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!mockup.document) {
    return NextResponse.json(
      { error: 'Mockup document is invalid', issues: mockup.issues ?? [] },
      { status: 422 },
    )
  }
  return NextResponse.json({
    document: mockup.document,
    counts: mockup.counts,
    findings: mockup.findings,
    documentHash: mockup.documentHash,
    contentHash: mockup.contentHash,
    copy: loadCopyFileFor(mockup),
  })
}

function resolveUserFeatures(auth: unknown): string[] {
  const features = (auth as { features?: unknown } | null)?.features
  return Array.isArray(features)
    ? features.filter((value): value is string => typeof value === 'string')
    : []
}

/**
 * Phase 2 studio save — full-document write (spec 2026-07-05-ds-live-mockup-composer.md).
 * Same dev-mode + path-containment guards as the annotations route, plus:
 * server-side schema AND registry-integrity validation of the incoming
 * document, and `baseHash` optimistic concurrency (409 on mismatch).
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
  const parsedBody = mockupDocumentPutRequestSchema.safeParse(body)
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

  const parsedDocument = mockupDocument.safeParse(parsedBody.data.document)
  if (!parsedDocument.success) {
    return NextResponse.json(
      {
        error: 'Document fails schema validation',
        issues: parsedDocument.error.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      },
      { status: 422 },
    )
  }

  const entries = await loadGalleryEntryMap()
  const integrityIssues = checkMockupIntegrity(parsedDocument.data, entries)
  if (integrityIssues.length > 0) {
    return NextResponse.json(
      {
        error: 'Document fails registry integrity',
        issues: integrityIssues.map((issue) => ({ path: issue.blockId, message: issue.message })),
      },
      { status: 422 },
    )
  }

  // Mutation-guard contract for this custom write route (packages/core/AGENTS.md
  // → API Routes) — same wiring as the annotations PUT.
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

  const result = writeMockupDocument(mockup, parsedDocument.data, parsedBody.data.baseHash)
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
      logger.error('Mockup document afterSuccess callback failed', { err: error })
    }
  }

  return NextResponse.json({
    ok: true,
    counts: result.counts,
    documentHash: result.documentHash,
    contentHash: result.contentHash,
  })
}

export const openApi = {
  GET: {
    summary: 'Get a design mockup document',
    description:
      'Returns the zod-validated mockup document with per-status counts, findings summary, the on-disk content hash, the findings-free content hash, and the companion copy file when present. 404 for unknown slugs, 422 with zod issues for invalid files.',
    tags: [designSystemTag],
    responses: {
      200: {
        description: 'Mockup document',
        content: { 'application/json': { schema: mockupDetailResponseSchema } },
      },
      404: {
        description: 'Unknown slug',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
      422: {
        description: 'Document fails schema validation',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
    },
  },
  PUT: {
    summary: 'Replace a mockup document (studio save, development only)',
    description:
      'Full-document write with baseHash optimistic concurrency: the request carries the documentHash the client loaded; a mismatch with the on-disk hash yields 409. The document is schema- and registry-integrity-validated server-side. Available exclusively when the app runs in development and the resolved document lives inside the repo working tree; 404 otherwise.',
    tags: [designSystemTag],
    requestBody: {
      content: { 'application/json': { schema: mockupDocumentPutRequestSchema } },
    },
    responses: {
      200: {
        description: 'Document written',
        content: { 'application/json': { schema: mockupDocumentPutResponseSchema } },
      },
      404: {
        description: 'Unknown slug, or the app is not running in development',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
      409: {
        description: 'baseHash no longer matches the on-disk document (concurrent edit)',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
      422: {
        description: 'Document fails schema or registry-integrity validation',
        content: { 'application/json': { schema: mockupErrorSchema } },
      },
    },
  },
}
