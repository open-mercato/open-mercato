/**
 * Prompt-to-draft API (spec §9, "AI-assisted authoring")
 *
 * Endpoint:
 * - POST /api/workflows/definitions/generate — natural language → draft definition
 *
 * ## This route PERSISTS NOTHING
 *
 * That is the whole trust model, and it is stronger than the `enabled: false`
 * row `workflows.create_definition` writes for external agents. There is no
 * `em.persist` on any path here: the generated definition is returned to the
 * Studio, the author reviews it on the canvas, and the ordinary Save + Enable
 * path — with its optimistic lock, its structural-edit guard and its publish
 * step — is the only way it ever becomes something the engine can run.
 *
 * ## Refusals are 200s
 *
 * "No AI provider configured", "the model call failed", "the model produced
 * something that is not a workflow" are all NORMAL authoring outcomes the
 * editor renders, exactly like the sibling test-step route's `{ refused: true }`
 * body. They respond 200 with a structured `{ ok: false, reason }` so the
 * surface can say what happened instead of showing a stack trace — this
 * module's recurring bug class is shipped behaviour that silently does nothing,
 * and a bare 500 is that bug wearing a status code.
 *
 * ## One evaluator
 *
 * The Problems pass is `evaluateWorkflowDefinition` — the same composer the
 * Studio's Problems panel and the definition API's 400 body come through. The
 * response carries its `problems`, `errorCount` and `warningCount` so the
 * author sees what is wrong with a draft BEFORE deciding to put it on a canvas.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { zodToJsonSchema } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getDeclaredEvents } from '@open-mercato/shared/modules/events'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { WorkflowDefinitionData } from '../../../data/entities'
import {
  transitionTriggerSchema,
  workflowDefinitionDataSchema,
  workflowStepTypeSchema,
} from '../../../data/validators'
import { listActivityTypes } from '../../../lib/activity-registry'
import '../../../lib/activity-registry-bootstrap'
import {
  WORKFLOW_DRAFT_AGENT_ID,
  WORKFLOW_DRAFT_PROMPT_MAX_LENGTH,
  buildWorkflowDraftCatalog,
  buildWorkflowDraftPrompt,
  classifyWorkflowDraftFailure,
  interpretWorkflowDraftObject,
  workflowDraftGenerationSchema,
} from '../../../lib/ai-authoring'
import { resolveWorkflowDraftRunner } from '../../../lib/ai-draft-runner'
import {
  computeDefinitionContextLedger,
  warmContextLedgerResolvers,
} from '../../../lib/definition-context-schema'
import { evaluateWorkflowDefinition } from '../../../lib/definition-evaluation'
import { listWorkflowFunctions } from '../../../lib/workflow-function-registry'
import { listWorkflowSafeCommands } from '../../../lib/workflow-safe-commands'
import { workflowsTag, workflowErrorSchema } from '../../openapi'

const logger = createLogger('workflows')

const DEFINITIONS_CREATE = 'workflows.definitions.create'

export const metadata = {
  requireAuth: true,
  requireFeatures: [DEFINITIONS_CREATE],
}

const generateDefinitionRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(WORKFLOW_DRAFT_PROMPT_MAX_LENGTH),
})

const generateDefinitionResponseSchema = z.object({
  ok: z.boolean(),
  reason: z.enum(['unavailable', 'failed', 'malformedResponse', 'schemaError']).optional(),
  message: z.string().optional(),
  messages: z.array(z.string()).optional(),
  summary: z.string().optional(),
  definition: z.record(z.string(), z.unknown()).optional(),
  problems: z.array(z.record(z.string(), z.unknown())).optional(),
  errorCount: z.number().int().nonnegative().optional(),
  warningCount: z.number().int().nonnegative().optional(),
})

/** Compute the ledger for the generated definition, tolerating a broken graph. */
async function tryComputeLedger(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  definition: WorkflowDefinitionData,
) {
  try {
    await warmContextLedgerResolvers(container)
    return computeDefinitionContextLedger(definition)
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(request)

    if (!auth || !auth.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const organizationId = scope?.selectedId ?? auth.orgId ?? null

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenant context' }, { status: 400 })
    }

    const rbacService = container.resolve('rbacService') as {
      userHasAllFeatures: (
        userId: string,
        features: string[],
        scope: { tenantId: string | null; organizationId: string | null },
      ) => Promise<boolean>
      loadAcl?: (
        userId: string,
        scope: { tenantId: string | null; organizationId: string | null },
      ) => Promise<{ features: string[]; isSuperAdmin: boolean }>
    }

    const hasPermission = await rbacService.userHasAllFeatures(auth.sub, [DEFINITIONS_CREATE], {
      tenantId,
      organizationId,
    })
    if (!hasPermission) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const validation = generateDefinitionRequestSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues },
        { status: 400 },
      )
    }

    const runner = await resolveWorkflowDraftRunner()
    if (!runner) {
      return NextResponse.json({ ok: false, reason: 'unavailable' })
    }

    // The catalogs the draft is authored against: the platform's own
    // registries, never a hand-maintained list that could drift from them.
    const catalog = buildWorkflowDraftCatalog({
      stepTypes: workflowStepTypeSchema.options,
      transitionTriggers: transitionTriggerSchema.options,
      activityTypes: listActivityTypes().map((entry) => ({
        id: entry.id,
        configSchema: zodToJsonSchema(entry.configSchema) ?? undefined,
      })),
      commands: listWorkflowSafeCommands().map((entry) => ({ id: entry.commandId })),
      functions: listWorkflowFunctions().map((entry) => ({
        name: entry.name,
        ...(entry.description ? { label: entry.description } : {}),
      })),
      events: getDeclaredEvents()
        .filter((event) => !event.excludeFromTriggers)
        .map((event) => ({ id: event.id })),
    })

    const acl = (await rbacService.loadAcl?.(auth.sub, { tenantId, organizationId })) ?? null

    let raw: unknown
    try {
      raw = await runner({
        agentId: WORKFLOW_DRAFT_AGENT_ID,
        prompt: buildWorkflowDraftPrompt({ prompt: validation.data.prompt, catalog }),
        schemaName: 'WorkflowDraft',
        schema: workflowDraftGenerationSchema,
        authContext: {
          tenantId,
          organizationId,
          userId: auth.sub,
          features: acl?.features ?? [],
          isSuperAdmin: acl?.isSuperAdmin ?? false,
        },
        container,
      })
    } catch (error) {
      const kind = classifyWorkflowDraftFailure(error)
      logger.warn('Workflow draft generation failed', { err: error, kind })
      return NextResponse.json({
        ok: false,
        reason: kind,
        ...(kind === 'failed'
          ? { message: error instanceof Error ? error.message : String(error) }
          : {}),
      })
    }

    const interpreted = interpretWorkflowDraftObject<WorkflowDefinitionData>({
      raw,
      parseDefinition: (value) => {
        const parsed = workflowDefinitionDataSchema.safeParse(value)
        if (parsed.success) return { ok: true, definition: parsed.data as WorkflowDefinitionData }
        return {
          ok: false,
          messages: parsed.error.issues.map(
            (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
          ),
        }
      },
    })

    if (!interpreted.ok) {
      return NextResponse.json({
        ok: false,
        reason: interpreted.reason,
        messages: interpreted.messages,
      })
    }

    const ledger = await tryComputeLedger(container, interpreted.definition)
    const evaluation = evaluateWorkflowDefinition(interpreted.definition, { ledger })

    // Nothing above wrote a row, and nothing below does either — this route
    // never resolves an EntityManager, so a future write would be an obvious
    // diff rather than a quiet line inside an existing block.
    return NextResponse.json({
      ok: true,
      summary: interpreted.summary,
      definition: interpreted.definition,
      problems: evaluation.problems,
      errorCount: evaluation.errorCount,
      warningCount: evaluation.warningCount,
    })
  } catch (error) {
    logger.error('Error generating workflow definition draft', { err: error })
    return NextResponse.json({ error: 'Failed to generate workflow draft' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Generate a draft workflow definition from a prompt',
  methods: {
    POST: {
      summary: 'Author a draft workflow definition from natural language',
      description:
        'Runs the propose-only workflows.workflow_author agent against this installation\'s activity, command, function and event catalogs and returns a draft definition plus the Problems-panel evaluation for it. Persists nothing: the draft is returned to the Studio for a human to apply, save and enable. Refusals ("unavailable" when no AI provider or agent registry is present, "failed" when the model call errored, "malformedResponse"/"schemaError" when the output is not a workflow definition) respond 200 with a structured body.',
      requestBody: { schema: generateDefinitionRequestSchema },
      responses: [
        {
          status: 200,
          description:
            'The generated draft with its Problems-panel evaluation, or a structured refusal',
          schema: generateDefinitionResponseSchema,
        },
        { status: 400, description: 'Invalid request body', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 403, description: 'Insufficient permissions', schema: workflowErrorSchema },
        { status: 500, description: 'Generation failed unexpectedly', schema: workflowErrorSchema },
      ],
    },
  },
}
