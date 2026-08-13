/**
 * Seeding the deal-briefing workflow definition into a tenant.
 *
 * ## Why the JSON is IMPORTED rather than read from disk
 *
 * `agent_orchestrator/lib/seeds.ts` — the mechanism this mirrors — resolves its
 * `examples/*.json` with `fileURLToPath(import.meta.url)` plus a list of
 * `process.cwd()` fallbacks, because a package ships from `src/` in dev and
 * `dist/` once built and neither path is knowable in advance. This module lives
 * in the APP (`apps/mercato/src/modules/…`), where that problem does not exist
 * and the guessing is pure downside: a Next/Turbopack bundle has no meaningful
 * `import.meta.url`, the CLI's cwd is the repo root, and a wrong guess throws
 * at tenant-init time. `resolveJsonModule` is on repo-wide, so a static import
 * gives one resolution, no fallback list, and one file for the tests to read.
 *
 * ## Idempotent and version-aware
 *
 * The probe pins exactly `(workflowId, version, tenantId)` — the tuple the DB's
 * own `@Unique` on `workflow_definitions` names. Seeding the same version twice
 * writes nothing; publishing version 2 from the Studio leaves version 1 alone;
 * and shipping a `version: 2` here later seeds it beside whatever the tenant
 * already holds instead of rewriting a definition that running instances are
 * pinned to. That last property is why this does not follow
 * `workflows/lib/seeds.ts`, which overwrites the newest row's `definition` in
 * place when its step count changed: a `WorkflowInstance` re-reads its
 * definition row on every advance, so rewriting one mid-flight changes the graph
 * under a run.
 *
 * ## The probe deliberately does NOT filter by organization
 *
 * A workflow definition is a TENANT-level artifact: the unique constraint is
 * `(workflow_id, version, tenant_id)` with no organization column and no
 * `deleted_at` predicate. Adding `organizationId` to the probe — which is what
 * `agent_orchestrator/lib/seeds.ts` and `workflows/lib/seeds.ts` both do — makes
 * this hook CRASH the moment it runs for a tenant's second organization:
 * `yarn mercato seed:defaults` loops over every organization, the org-scoped
 * probe finds nothing, and the insert hits the tenant-wide constraint. Verified
 * against the dev database, which has four organizations under one tenant. The
 * two existing seeders escape it only because they run from `seedExamples`
 * during a single-organization `init`.
 *
 * Consequence worth knowing: the row carries the organization that seeded it,
 * and `findWorkflowDefinition` filters on `organizationId`. On a
 * multi-organization tenant only that organization can start the workflow. The
 * constraint makes a per-organization copy impossible, so this is a platform
 * tension rather than something this hook can resolve.
 *
 * The definition is parsed through the engine's own
 * `workflowDefinitionDataSchema` before it is written. A shipped file that
 * cannot be validated must fail loudly at seed time rather than land as a row
 * that only breaks when somebody presses the button.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  WorkflowDefinition,
  type WorkflowDefinitionData,
} from '@open-mercato/core/modules/workflows/data/entities'
import { workflowDefinitionDataSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { DEAL_BRIEFING_WORKFLOW_ID } from './deal-briefing-contract'
import dealBriefingWorkflow from '../examples/deal-briefing-workflow.json'

const logger = createLogger('sales_call_planner').child({ component: 'seeds' })

/**
 * The definition's stable id, exported so the widget that starts a run (B6) and
 * the integration tests (B7) name it by import rather than by retyping a string
 * whose typo fails only at run time.
 *
 * It is DECLARED in `./deal-briefing-contract` and re-exported here, unchanged
 * for every existing importer. This module reaches the ORM and the engine's
 * validators, so a browser bundle cannot import it; the widget that starts a run
 * is a client component and needs the same id. The declaration therefore lives
 * in a module with no imports, and this stays the id's documented home.
 */
export { DEAL_BRIEFING_WORKFLOW_ID }

export type SalesCallPlannerSeedScope = {
  tenantId: string
  organizationId: string
}

type WorkflowSeedDocument = {
  workflowId: string
  workflowName: string
  description?: string | null
  version?: number
  enabled?: boolean
  metadata?: Record<string, unknown> | null
  definition: unknown
}

const seedDocument = dealBriefingWorkflow as WorkflowSeedDocument

/**
 * Parse once per process. A definition that fails the engine's schema is a
 * packaging defect, and throwing here names the offending path instead of
 * letting a broken row reach a tenant.
 */
export function readDealBriefingDefinition(): WorkflowDefinitionData {
  const parsed = workflowDefinitionDataSchema.safeParse(seedDocument.definition)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(
      `[internal] examples/deal-briefing-workflow.json is not a valid workflow definition: ${detail}`,
    )
  }
  return parsed.data as WorkflowDefinitionData
}

/**
 * Create the deal-briefing definition for one tenant + organization when that
 * exact version is absent. Returns whether a row was written, so the caller can
 * log a first install without logging every re-run.
 */
export async function seedDealBriefingWorkflow(
  em: EntityManager,
  scope: SalesCallPlannerSeedScope,
): Promise<boolean> {
  const version = seedDocument.version ?? 1
  const existing = await em.findOne(WorkflowDefinition, {
    workflowId: DEAL_BRIEFING_WORKFLOW_ID,
    version,
    tenantId: scope.tenantId,
  })
  if (existing) return false

  em.persist(
    em.create(WorkflowDefinition, {
      workflowId: DEAL_BRIEFING_WORKFLOW_ID,
      workflowName: seedDocument.workflowName,
      description: seedDocument.description ?? null,
      version,
      definition: readDealBriefingDefinition(),
      metadata: seedDocument.metadata ?? null,
      enabled: seedDocument.enabled ?? true,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }),
  )
  await em.flush()

  logger.info('seeded the deal-briefing workflow definition', {
    workflowId: DEAL_BRIEFING_WORKFLOW_ID,
    version,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  return true
}
