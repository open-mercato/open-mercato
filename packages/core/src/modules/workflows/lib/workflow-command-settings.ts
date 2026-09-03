/**
 * The impure half of the UPDATE_ENTITY tenant enablement gate.
 *
 * Shape copied from `lib/task-permission-settings.ts`: one tenant-scoped
 * `module_configs` row under the `workflows` module id, read through
 * `ModuleConfigService` (scoped row → global row → not found), decided by the
 * PURE functions in `lib/workflow-command-enablement.ts`.
 *
 * ## Caching
 *
 * There is NO cache here, deliberately. `ModuleConfigService.getValue` already
 * caches through the platform `CacheStrategy` — tenant-keyed, 60s TTL, tagged
 * `module-config:module:workflows` — and `setValue` writes the new value
 * through that same key, so the settings page's own save is visible
 * immediately. A second cache in this module would need its own invalidation
 * hook on every write path and could disagree with the settings page about what
 * is enabled, which is the failure mode this gate exists to prevent. On the
 * `UPDATE_ENTITY` hot path this costs one cache read per activity execution and,
 * at most, one indexed single-row `SELECT` per tenant per minute.
 *
 * ## Failure direction
 *
 * A read that cannot happen — no container, no service, an unparseable row —
 * resolves to the UNSET policy, i.e. the grandfathered set. That is the only
 * answer that neither grants a capability the tenant never ticked nor breaks a
 * workflow that already ran. It is never "everything enabled".
 *
 * `tenantId` MUST come from the authenticated context or from the workflow
 * instance, never from request input.
 */

import {
  parseStoredEnabledCommandIds,
  UNSET_WORKFLOW_COMMAND_POLICY,
  type WorkflowCommandEnablementPolicy,
} from './workflow-command-enablement'

/** `module_configs.module_id`, shared with the task-permission setting. */
export const WORKFLOWS_COMMAND_CONFIG_MODULE = 'workflows'

/** `module_configs.name`. Well within `moduleConfigKeySchema`'s 128 chars. */
export const UPDATE_ENTITY_ENABLED_COMMANDS_KEY = 'update_entity_enabled_commands'

/** The `ModuleConfigService` slice this needs, so tests need no container. */
export type WorkflowCommandConfigService = {
  getValue: (
    moduleId: string,
    name: string,
    options?: { defaultValue?: unknown; scope?: { tenantId?: string | null } },
  ) => Promise<unknown>
  setValue: (
    moduleId: string,
    name: string,
    value: unknown,
    scope?: { tenantId?: string | null },
  ) => Promise<unknown>
}

/** The container slice the runtime helper below reaches for. */
export type WorkflowCommandSettingsContainer = { resolve: <T>(name: string) => T }

export async function readEnabledWorkflowCommandIds(
  moduleConfigService: WorkflowCommandConfigService | null | undefined,
  tenantId: string | null,
): Promise<readonly string[] | null> {
  if (!moduleConfigService) return null
  try {
    const value = await moduleConfigService.getValue(
      WORKFLOWS_COMMAND_CONFIG_MODULE,
      UPDATE_ENTITY_ENABLED_COMMANDS_KEY,
      { scope: { tenantId } },
    )
    return parseStoredEnabledCommandIds(value)
  } catch {
    return null
  }
}

/** The `policy` argument every decision function takes. */
export async function resolveWorkflowCommandEnablementPolicy(
  moduleConfigService: WorkflowCommandConfigService | null | undefined,
  tenantId: string | null,
): Promise<WorkflowCommandEnablementPolicy> {
  const enabledCommandIds = await readEnabledWorkflowCommandIds(moduleConfigService, tenantId)
  return enabledCommandIds === null ? UNSET_WORKFLOW_COMMAND_POLICY : { enabledCommandIds }
}

export async function writeEnabledWorkflowCommandIds(
  moduleConfigService: WorkflowCommandConfigService,
  tenantId: string,
  commandIds: readonly string[],
): Promise<void> {
  await moduleConfigService.setValue(
    WORKFLOWS_COMMAND_CONFIG_MODULE,
    UPDATE_ENTITY_ENABLED_COMMANDS_KEY,
    [...commandIds],
    { tenantId },
  )
}

/**
 * Resolve the config service from a container without letting its absence fail
 * the caller. An absent service reads as the UNSET policy — see the header.
 */
export function resolveWorkflowCommandConfigService(
  container: WorkflowCommandSettingsContainer,
): WorkflowCommandConfigService | null {
  try {
    return container.resolve<WorkflowCommandConfigService>('moduleConfigService') ?? null
  } catch {
    return null
  }
}

/** The policy for one workflow run, resolved from its own container + tenant. */
export async function resolveWorkflowCommandPolicyForContainer(
  container: WorkflowCommandSettingsContainer,
  tenantId: string | null,
): Promise<WorkflowCommandEnablementPolicy> {
  return resolveWorkflowCommandEnablementPolicy(
    resolveWorkflowCommandConfigService(container),
    tenantId,
  )
}
