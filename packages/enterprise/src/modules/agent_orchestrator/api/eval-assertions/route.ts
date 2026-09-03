import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AgentEvalAssertion } from '../../data/entities'
import {
  evalAssertionCreateSchema,
  evalAssertionListQuerySchema,
  evalAssertionUpdateSchema,
  type EvalAssertionCreateInput,
  type EvalAssertionUpdateInput,
} from '../../data/validators'
import { parseScorerConfig } from '../../lib/eval/registry'
import {
  createAgentOrchestratorCrudOpenApi,
  createPagedListResponseSchema,
  defaultCreateResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

const ENTITY_TYPE = 'agent_orchestrator:agent_eval_assertion'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
}

export const metadata = routeMetadata

/**
 * Resolves which registry scorer this assertion runs and validates its config
 * against that scorer's schema. `scorerKey` is optional on the wire so existing
 * clients that only send `key` keep working — falling back to `key` reproduces the
 * pre-column resolution rule.
 *
 * A malformed config is a 422 HERE, at the write boundary. At EVALUATION time the
 * same failure yields a skipped result instead, so a bad config stays visible
 * without ever flipping `AgentRun.evalPassed`.
 */
function resolveScorerForWrite(scorerKey: string | undefined, key: string, config: unknown): string {
  const resolved = scorerKey ?? key
  const parsed = parseScorerConfig(resolved, config, 'write')
  if (!parsed.ok) {
    throw new CrudHttpError(422, {
      error: '[internal] invalid assertion configuration',
      scorerKey: resolved,
      issues: parsed.issues,
    })
  }
  return resolved
}

const crud = makeCrudRoute<
  EvalAssertionCreateInput,
  EvalAssertionUpdateInput,
  z.infer<typeof evalAssertionListQuerySchema>
>({
  metadata: routeMetadata,
  orm: {
    entity: AgentEvalAssertion,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_TYPE },
  list: {
    schema: evalAssertionListQuerySchema,
    entityId: ENTITY_TYPE,
    fields: [
      'id',
      'key',
      'scorer_key',
      'title',
      'description',
      'applies_to',
      'type',
      'severity',
      'config',
      'version',
      'enabled',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      key: 'key',
      scorerKey: 'scorer_key',
      title: 'title',
      appliesTo: 'applies_to',
      type: 'type',
      severity: 'severity',
      enabled: 'enabled',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.appliesTo) filters.applies_to = { $eq: query.appliesTo }
      if (query.scorerKey) filters.scorer_key = { $eq: query.scorerKey }
      if (query.type) filters.type = { $eq: query.type }
      if (query.severity) filters.severity = { $eq: query.severity }
      if (typeof query.enabled === 'boolean') filters.enabled = { $eq: query.enabled }
      return filters
    },
  },
  create: {
    schema: evalAssertionCreateSchema,
    mapToEntity: (input, ctx) => {
      const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
      const tenantId = ctx.auth?.tenantId ?? null
      if (!organizationId || !tenantId) {
        throw new CrudHttpError(400, { error: '[internal] organization and tenant context required' })
      }
      return {
        tenantId,
        organizationId,
        key: input.key,
        scorerKey: resolveScorerForWrite(input.scorerKey, input.key, input.config),
        title: input.title,
        description: input.description ?? null,
        appliesTo: input.appliesTo,
        type: input.type,
        severity: input.severity,
        config: input.config ?? null,
        enabled: input.enabled ?? true,
      }
    },
    response: (entity) => ({ id: String((entity as { id: string }).id) }),
  },
  update: {
    schema: evalAssertionUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      const row = entity as AgentEvalAssertion
      if (input.key !== undefined) row.key = input.key
      if (input.title !== undefined) row.title = input.title
      if (input.description !== undefined) row.description = input.description ?? null
      if (input.appliesTo !== undefined) row.appliesTo = input.appliesTo
      if (input.type !== undefined) row.type = input.type
      // Severity is no longer coerced. A judge assertion MAY now be declared
      // `gate`; whether that verdict actually gates is decided per plane by
      // `GatePolicy` at evaluation time — the manual workbench honours it, CI and
      // online ingest never do. Coercing here would have made the manual policy
      // unreachable.
      if (input.severity !== undefined) row.severity = input.severity
      // Re-validate ONLY when the scorer contract actually changes. Comparing
      // against the stored values (rather than merely checking for presence)
      // matters: clients round-trip the whole row for unrelated edits such as the
      // enable toggle, and a legacy row whose stored config predates validation
      // must not start 422-ing on an untouched field.
      const scorerChanged = input.scorerKey !== undefined && input.scorerKey !== row.scorerKey
      const configChanged =
        input.config !== undefined && JSON.stringify(input.config ?? null) !== JSON.stringify(row.config ?? null)
      if (scorerChanged || configChanged) {
        const nextConfig = input.config !== undefined ? input.config : row.config
        row.scorerKey = resolveScorerForWrite(input.scorerKey ?? row.scorerKey, input.key ?? row.key, nextConfig)
      }
      if (configChanged) {
        row.config = input.config ?? null
        // `version` pins the eval set: bump it whenever the contract actually
        // changes, so a gate run can reference a known assertion revision. It was
        // previously frozen at 1 because nothing ever wrote it. Bumping on every
        // round-trip (including the enable toggle) would make it meaningless.
        row.version = (row.version ?? 1) + 1
      }
      if (input.enabled !== undefined) row.enabled = input.enabled
    },
    response: (entity) => {
      const updatedAt = (entity as AgentEvalAssertion).updatedAt
      return {
        ok: true,
        updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : null,
      }
    },
  },
  del: { idFrom: 'query', softDelete: true },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const evalAssertionListItemSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  scorer_key: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  applies_to: z.string(),
  type: z.string(),
  severity: z.string(),
  config: z.unknown().nullable().optional(),
  version: z.number().int().optional(),
  enabled: z.boolean().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createAgentOrchestratorCrudOpenApi({
  resourceName: 'EvalAssertion',
  pluralName: 'Eval assertions',
  querySchema: evalAssertionListQuerySchema,
  listResponseSchema: createPagedListResponseSchema(evalAssertionListItemSchema),
  create: {
    schema: evalAssertionCreateSchema,
    responseSchema: defaultCreateResponseSchema,
    description:
      'Creates an evaluation assertion. `llm_judge` assertions are always stored as `warn` severity (the judge tier never blocks production).',
  },
  update: {
    schema: evalAssertionUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an evaluation assertion (enable/disable, retarget, or retune its rubric/config).',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes an evaluation assertion by id (provided via query).',
  },
})
