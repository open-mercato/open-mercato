/**
 * Publish Workflow Definition Version
 *
 * POST /api/workflows/definitions/[id]/publish
 *
 * Mints a new frozen, published version of a workflow definition (snapshotting
 * its current data + IO port contract). Runs breaking-change detection against
 * callers of the workflow as a sub-workflow; when callers would break, the
 * caller must pass `acknowledgeBreakingChanges: true`. Emits
 * `workflows.definition.published`.
 */

import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { validateCrudMutationGuard, runCrudMutationGuardAfterSuccess } from '@open-mercato/shared/lib/crud/mutation-guard'
import { WorkflowDefinition } from '../../../../data/entities'
import type { WorkflowIoContract } from '../../../../data/validators'
import { serializeWorkflowDefinition } from '../../serialize'
import { findSubWorkflowCallers } from '../../../../lib/caller-graph'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.definitions.publish'],
}

const publishInputSchema = z.object({
  acknowledgeBreakingChanges: z.boolean().optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const params = await context.params
    const container = await createRequestContainer()
    const em = container.resolve('em')
    const auth = await getAuthFromRequest(request)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const organizationId = scope?.selectedId ?? auth.orgId

    if (!tenantId || !organizationId) {
      return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = publishInputSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 })
    }

    const guardResult = await validateCrudMutationGuard(container, {
      tenantId,
      organizationId,
      userId: auth.sub ?? '',
      resourceKind: 'workflows.definition',
      resourceId: params.id,
      operation: 'custom',
      requestMethod: 'POST',
      requestHeaders: request.headers,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const source = await em.findOne(WorkflowDefinition, {
      id: params.id,
      tenantId,
      organizationId,
      deletedAt: null,
    })
    if (!source) {
      return NextResponse.json({ error: 'Workflow definition not found' }, { status: 404 })
    }

    // Breaking-change detection: diff this definition's published port contract
    // against every caller that invokes it as a sub-workflow.
    const ports: WorkflowIoContract = (source.definition as { io?: WorkflowIoContract })?.io || {}
    const breakingChanges = await findSubWorkflowCallers(em, {
      subWorkflowId: source.workflowId,
      tenantId,
      organizationId,
      ports,
    })

    if (breakingChanges.length > 0 && !parsed.data.acknowledgeBreakingChanges) {
      return NextResponse.json(
        {
          error: 'Publishing would break existing sub-workflow mappings',
          breakingChanges,
        },
        { status: 409 },
      )
    }

    // Next version = max existing version for this workflowId/tenant + 1.
    const latest = await em.findOne(
      WorkflowDefinition,
      { workflowId: source.workflowId, tenantId },
      { orderBy: { version: 'DESC' } },
    )
    const nextVersion = (latest?.version ?? source.version) + 1

    // Assign the PK up front so it is available before flush (MikroORM does not
    // generate UUIDs client-side).
    const published = em.create(WorkflowDefinition, {
      id: randomUUID(),
      workflowId: source.workflowId,
      codeWorkflowId: source.codeWorkflowId ?? null,
      workflowName: source.workflowName,
      description: source.description ?? null,
      version: nextVersion,
      definition: source.definition,
      metadata: source.metadata ?? null,
      enabled: true,
      kind: source.kind,
      lifecycle: 'published',
      tenantId,
      organizationId,
      createdBy: auth.sub,
      updatedBy: auth.sub,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(published)
    await em.flush()

    if (guardResult?.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(container, {
        tenantId,
        organizationId,
        userId: auth.sub ?? '',
        resourceKind: 'workflows.definition',
        resourceId: String(published.id),
        operation: 'custom',
        requestMethod: 'POST',
        requestHeaders: request.headers,
        metadata: guardResult.metadata,
      })
    }

    try {
      const eventBus = container.resolve('eventBus') as
        | { emitEvent(event: string, payload: unknown, options?: unknown): Promise<void> }
        | undefined
      if (eventBus && typeof eventBus.emitEvent === 'function') {
        await eventBus.emitEvent(
          'workflows.definition.published',
          {
            id: published.id,
            workflowId: published.workflowId,
            version: published.version,
            tenantId: published.tenantId,
            organizationId: published.organizationId,
            userId: auth.sub ?? null,
          },
          { tenantId: published.tenantId, organizationId: published.organizationId, persistent: true },
        )
      }
    } catch (eventError) {
      console.error('Failed to emit workflows.definition.published event:', eventError)
    }

    return NextResponse.json({
      data: serializeWorkflowDefinition(published),
      breakingChanges,
      message: 'Workflow definition published successfully',
    })
  } catch (error) {
    console.error('Error publishing workflow definition:', error)
    return NextResponse.json({ error: 'Failed to publish workflow definition' }, { status: 500 })
  }
}

export const openApi = {
  methods: {
    POST: {
      summary: 'Publish a new workflow definition version',
      description:
        'Mints a frozen published version snapshotting the definition and its IO port contract. Returns affected sub-workflow callers; pass acknowledgeBreakingChanges=true to publish despite breaking changes.',
      tags: ['Workflows'],
      pathParams: z.object({ id: z.string().describe('Workflow definition id') }),
      requestBody: publishInputSchema,
      responses: [
        {
          status: 200,
          description: 'Published',
          example: {
            data: { id: '…', workflowId: 'verify-policy', version: 2, lifecycle: 'published' },
            breakingChanges: [],
            message: 'Workflow definition published successfully',
          },
        },
        {
          status: 409,
          description: 'Breaking changes not acknowledged',
          example: {
            error: 'Publishing would break existing sub-workflow mappings',
            breakingChanges: [{ workflowId: 'order-flow', version: 1, stepId: 'sub', brokenMappings: ['input:claimId'] }],
          },
        },
        { status: 404, description: 'Not found', example: { error: 'Workflow definition not found' } },
      ],
    },
  },
}
