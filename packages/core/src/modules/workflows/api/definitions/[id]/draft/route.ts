/**
 * Workflow Definition Draft API (spec §4.7 save model)
 *
 * Endpoints:
 * - GET /api/workflows/definitions/[id]/draft - Get the CURRENT USER's draft
 * - PUT /api/workflows/definitions/[id]/draft - Upsert the current user's draft
 * - DELETE /api/workflows/definitions/[id]/draft - Discard the current user's draft (idempotent)
 *
 * Drafts are a per-user autosave layer over a saved definition. They are
 * scoped by tenant + organization + userId from the authenticated principal
 * (never from the body) and deliberately do NOT participate in the
 * definition's optimistic lock — only the explicit definition PUT does.
 * Server drafts exist only for saved definitions (UUID ids): "code:*" and
 * unsaved-definition ids are rejected with 400; drafts for not-yet-saved
 * definitions are the editor's local concern (Step 8.3).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { WorkflowDefinition, WorkflowDefinitionDraft } from '../../../../data/entities'
import {
  upsertWorkflowDefinitionDraftInputSchema,
  type UpsertWorkflowDefinitionDraftApiInput,
} from '../../../../data/validators'
import {
  workflowsTag,
  workflowErrorSchema,
  workflowDefinitionDraftDetailResponseSchema,
  workflowDefinitionDraftMutationResponseSchema,
  workflowDefinitionDraftDeleteResponseSchema,
} from '../../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

const DRAFT_RESOURCE_KIND = 'workflows.definition_draft'

const draftIdSchema = z.uuid()

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.edit'],
}

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

type ResolvedDraftContext = {
  ok: true
  container: Awaited<ReturnType<typeof createRequestContainer>>
  em: {
    findOne: (entity: unknown, where: Record<string, unknown>) => Promise<unknown>
    create: (entity: unknown, data: Record<string, unknown>) => WorkflowDefinitionDraft
    persist: (entity: unknown) => unknown
    flush: () => Promise<void>
  }
  auth: { sub: string; tenantId: string | null; orgId: string | null }
  userId: string
  tenantId: string
  organizationId: string
  definitionId: string
}

type RejectedDraftContext = {
  ok: false
  response: NextResponse
}

async function resolveDraftContext(
  request: NextRequest,
  context: RouteContext,
): Promise<ResolvedDraftContext | RejectedDraftContext> {
  const params = await context.params
  const container = await createRequestContainer()
  const em = container.resolve('em') as ResolvedDraftContext['em']
  const auth = await getAuthFromRequest(request)

  if (!auth || !auth.sub) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const idValidation = draftIdSchema.safeParse(params.id)
  if (!idValidation.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Drafts are only available for saved workflow definitions' },
        { status: 400 },
      ),
    }
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const tenantId = auth.tenantId
  const organizationId = scope?.selectedId ?? auth.orgId

  if (!tenantId) {
    return { ok: false, response: NextResponse.json({ error: 'Missing tenant context' }, { status: 400 }) }
  }
  if (!organizationId) {
    return { ok: false, response: NextResponse.json({ error: 'Missing organization context' }, { status: 400 }) }
  }

  const rbacService = container.resolve('rbacService') as {
    userHasAllFeatures: (
      userId: string,
      features: string[],
      scope: { tenantId: string | null; organizationId: string | null },
    ) => Promise<boolean>
  }
  const hasPermission = await rbacService.userHasAllFeatures(
    auth.sub,
    ['workflows.definitions.edit'],
    { tenantId, organizationId },
  )

  if (!hasPermission) {
    return { ok: false, response: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) }
  }

  return {
    ok: true,
    container,
    em,
    auth: { sub: auth.sub, tenantId: auth.tenantId ?? null, orgId: auth.orgId ?? null },
    userId: auth.sub,
    tenantId,
    organizationId,
    definitionId: idValidation.data,
  }
}

function serializeWorkflowDefinitionDraft(draft: WorkflowDefinitionDraft) {
  return {
    id: draft.id,
    definitionId: draft.definitionId ?? null,
    definition: draft.definition,
    metadata: draft.metadata ?? null,
    baseUpdatedAt: draft.baseUpdatedAt ? draft.baseUpdatedAt.toISOString() : null,
    createdAt: draft.createdAt ? draft.createdAt.toISOString() : null,
    updatedAt: draft.updatedAt ? draft.updatedAt.toISOString() : null,
  }
}

/**
 * GET /api/workflows/definitions/[id]/draft
 *
 * Return the current user's draft for the definition, or 404 when none exists.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const resolved = await resolveDraftContext(request, context)
    if (!resolved.ok) return resolved.response
    const { em, userId, tenantId, organizationId, definitionId } = resolved

    const draft = (await em.findOne(WorkflowDefinitionDraft, {
      definitionId,
      userId,
      tenantId,
      organizationId,
      deletedAt: null,
    })) as WorkflowDefinitionDraft | null

    if (!draft) {
      return NextResponse.json({ error: 'Workflow definition draft not found' }, { status: 404 })
    }

    return NextResponse.json({ data: serializeWorkflowDefinitionDraft(draft) })
  } catch (error) {
    logger.error('Error getting workflow definition draft', { err: error })
    return NextResponse.json({ error: 'Failed to get workflow definition draft' }, { status: 500 })
  }
}

/**
 * PUT /api/workflows/definitions/[id]/draft
 *
 * Upsert the current user's draft for the definition. The body is validated
 * shape-only (a draft may be mid-edit and structurally incomplete); full
 * definition validation happens on explicit Save via the definition PUT.
 */
export async function PUT(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const resolved = await resolveDraftContext(request, context)
    if (!resolved.ok) return resolved.response
    const { container, em, userId, tenantId, organizationId, definitionId } = resolved

    const body = await request.json()
    const validation = upsertWorkflowDefinitionDraftInputSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 },
      )
    }

    const input: UpsertWorkflowDefinitionDraftApiInput = validation.data

    const definition = (await em.findOne(WorkflowDefinition, {
      id: definitionId,
      tenantId,
      organizationId,
      deletedAt: null,
    })) as WorkflowDefinition | null

    if (!definition) {
      return NextResponse.json({ error: 'Workflow definition not found' }, { status: 404 })
    }

    const guarded = await runRouteMutationGuards({
      container,
      req: request,
      auth: { userId, tenantId, organizationId },
      input: {
        resourceKind: DRAFT_RESOURCE_KIND,
        resourceId: definitionId,
        operation: 'update',
        mutationPayload: input as Record<string, unknown>,
      },
    })
    if (!guarded.ok) {
      return NextResponse.json(guarded.errorBody, { status: guarded.errorStatus })
    }

    const existingDraft = (await em.findOne(WorkflowDefinitionDraft, {
      definitionId,
      userId,
      tenantId,
    })) as WorkflowDefinitionDraft | null

    let savedDraft: WorkflowDefinitionDraft
    if (existingDraft) {
      existingDraft.deletedAt = null
      existingDraft.organizationId = organizationId
      existingDraft.definition = input.definition
      if (input.metadata !== undefined) {
        existingDraft.metadata = input.metadata
      }
      if (input.baseUpdatedAt !== undefined) {
        existingDraft.baseUpdatedAt = input.baseUpdatedAt
      }
      existingDraft.updatedAt = new Date()
      await em.flush()
      savedDraft = existingDraft
    } else {
      const draft = em.create(WorkflowDefinitionDraft, {
        definitionId,
        userId,
        definition: input.definition,
        metadata: input.metadata ?? null,
        baseUpdatedAt: input.baseUpdatedAt ?? null,
        tenantId,
        organizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(draft)
      await em.flush()
      savedDraft = draft
    }

    await guarded.runAfterSuccess()

    return NextResponse.json({
      data: serializeWorkflowDefinitionDraft(savedDraft),
      message: 'Workflow definition draft saved',
    })
  } catch (error) {
    logger.error('Error saving workflow definition draft', { err: error })
    return NextResponse.json({ error: 'Failed to save workflow definition draft' }, { status: 500 })
  }
}

/**
 * DELETE /api/workflows/definitions/[id]/draft
 *
 * Discard the current user's draft. Idempotent: deleting a non-existent draft
 * succeeds.
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const resolved = await resolveDraftContext(request, context)
    if (!resolved.ok) return resolved.response
    const { container, em, userId, tenantId, organizationId, definitionId } = resolved

    const draft = (await em.findOne(WorkflowDefinitionDraft, {
      definitionId,
      userId,
      tenantId,
      organizationId,
      deletedAt: null,
    })) as WorkflowDefinitionDraft | null

    if (!draft) {
      return NextResponse.json({ message: 'Workflow definition draft discarded' })
    }

    const guarded = await runRouteMutationGuards({
      container,
      req: request,
      auth: { userId, tenantId, organizationId },
      input: {
        resourceKind: DRAFT_RESOURCE_KIND,
        resourceId: definitionId,
        operation: 'delete',
      },
    })
    if (!guarded.ok) {
      return NextResponse.json(guarded.errorBody, { status: guarded.errorStatus })
    }

    draft.deletedAt = new Date()
    draft.updatedAt = new Date()
    await em.flush()

    await guarded.runAfterSuccess()

    return NextResponse.json({ message: 'Workflow definition draft discarded' })
  } catch (error) {
    logger.error('Error discarding workflow definition draft', { err: error })
    return NextResponse.json({ error: 'Failed to discard workflow definition draft' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Per-user workflow definition drafts',
  pathParams: z.object({
    id: z.uuid().describe('Workflow definition UUID (server drafts exist only for saved definitions)'),
  }),
  methods: {
    GET: {
      summary: 'Get the current user\'s draft',
      description: 'Returns the authenticated user\'s autosaved draft for the workflow definition. Drafts are private to the user who saved them.',
      responses: [
        { status: 200, description: 'Draft found', schema: workflowDefinitionDraftDetailResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid definition id (only saved definitions have server drafts)', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
        { status: 404, description: 'No draft exists for this user and definition', schema: workflowErrorSchema },
      ],
    },
    PUT: {
      summary: 'Save the current user\'s draft',
      description: 'Creates or updates the authenticated user\'s draft for the workflow definition. The definition payload is validated shape-only (steps and transitions must be arrays of objects) so a mid-edit, structurally incomplete graph still saves; full validation runs when the draft is promoted via the definition PUT. Draft saves never participate in the definition\'s optimistic lock.',
      requestBody: {
        schema: upsertWorkflowDefinitionDraftInputSchema,
        example: {
          definition: {
            steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' }],
            transitions: [],
          },
          baseUpdatedAt: '2026-07-27T10:00:00.000Z',
        },
      },
      responses: [
        { status: 200, description: 'Draft saved', schema: workflowDefinitionDraftMutationResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Malformed draft payload or invalid definition id', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
        { status: 404, description: 'Workflow definition not found', schema: workflowErrorSchema },
      ],
    },
    DELETE: {
      summary: 'Discard the current user\'s draft',
      description: 'Deletes the authenticated user\'s draft for the workflow definition. Idempotent: discarding a non-existent draft succeeds.',
      responses: [
        { status: 200, description: 'Draft discarded (or no draft existed)', schema: workflowDefinitionDraftDeleteResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid definition id', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
      ],
    },
  },
}
