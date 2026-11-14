import type { EntityManager } from '@mikro-orm/postgresql'
import { listWorkflowSafeCommands } from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import {
  readEnabledWorkflowCommandIds,
  resolveWorkflowCommandConfigService,
  writeEnabledWorkflowCommandIds,
  type WorkflowCommandSettingsContainer,
} from '@open-mercato/core/modules/workflows/lib/workflow-command-settings'
import { buildNdaReviewWorkflowSeed, NDA_REVIEW_WORKFLOW_COMMAND_IDS } from './ndaReviewWorkflow'

export type LegalReviewSeedScope = { tenantId: string; organizationId: string }

/**
 * The commands the tenant ends up with after enabling the NDA review commands.
 *
 * A tenant that never saved the setting runs the grandfathered `defaultEnabled`
 * commands; writing only our two ids would silently switch those off, so they
 * are carried over first. Ids the tenant already enabled are always kept.
 */
export function mergeNdaReviewCommandIds(
  stored: readonly string[] | null,
  grandfathered: readonly string[],
  required: readonly string[] = NDA_REVIEW_WORKFLOW_COMMAND_IDS,
): string[] {
  const base = stored === null ? grandfathered : stored
  return Array.from(new Set([...base, ...required]))
}

/**
 * Example-only (`seedExamples`, skipped with `--no-examples`): switch on the two
 * workflow-safe commands the NDA review workflow runs. Real tenants make this
 * decision themselves in the workflow command policy.
 */
export async function enableNdaReviewWorkflowCommands(
  container: WorkflowCommandSettingsContainer,
  tenantId: string,
): Promise<boolean> {
  const service = resolveWorkflowCommandConfigService(container)
  if (!service) return false
  const stored = await readEnabledWorkflowCommandIds(service, tenantId)
  const grandfathered = listWorkflowSafeCommands()
    .filter((command) => command.defaultEnabled === true)
    .map((command) => command.commandId)
  const next = mergeNdaReviewCommandIds(stored, grandfathered)
  if (stored && next.length === stored.length) return false
  await writeEnabledWorkflowCommandIds(service, tenantId, next)
  return true
}

/**
 * Idempotent seed of the NDA review workflow definition (create-if-absent by
 * workflowId within the scope), mirroring the workflows module's own example
 * seeds. The workflows entity is imported lazily so this module never loads it
 * at boot.
 */
export async function seedNdaReviewWorkflowDefinition(
  em: EntityManager,
  scope: LegalReviewSeedScope,
): Promise<boolean> {
  const { WorkflowDefinition } = await import('@open-mercato/core/modules/workflows/data/entities')
  const seed = buildNdaReviewWorkflowSeed()
  const existing = await em.findOne(WorkflowDefinition, {
    workflowId: seed.workflowId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (existing) return false
  em.persist(
    em.create(WorkflowDefinition, {
      ...seed,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }),
  )
  await em.flush()
  return true
}
