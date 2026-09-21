/**
 * Tier 2 of the UPDATE_ENTITY authorization model: which of the commands the
 * CODE declares possible are SWITCHED ON for this tenant.
 *
 * ## The three gates, and why there are three
 *
 * `executeUpdateEntity` runs a command only when ALL of the following hold:
 *
 * 1. **Catalogue** — the command was declared through
 *    `registerWorkflowSafeCommands`. Only the owning module can state that a
 *    command is safe to run unattended and which ACL feature it needs, so that
 *    fact stays in code and an administrator can never type an arbitrary id.
 * 2. **Tenant enablement** — THIS module, decided here. A catalogue entry is a
 *    CANDIDATE; a human ticks it before any workflow can reach it.
 * 3. **Actor features** — the workflow's acting user holds the declared
 *    `requiredFeatures`. Unchanged, and deliberately still last: enabling a
 *    command for a tenant is not a grant of it to everybody in that tenant.
 *
 * Dropping any one of them collapses the model. In particular gate 2 without
 * gate 1 would be "let an admin name any of the ~275 commands", which is the
 * design the maintainer rejected.
 *
 * ## Why an absent setting is not "nothing enabled"
 *
 * Before this file existed, every catalogue entry was reachable. Exactly one
 * command was ever in the catalogue (`sales.orders.update`), so "all-off by
 * default" would break the shipped `sales.order-approval` workflow and its
 * gallery template, while "all-on by default" would silently hand every tenant
 * the ability to have workflows mutate products and customers the moment a new
 * candidate is declared.
 *
 * So an absent setting resolves to the entries whose declaration carries
 * `defaultEnabled: true` — the grandfather clause, reserved for commands that
 * were ALREADY reachable before this gate existed. Everything declared from now
 * on omits the flag and is therefore off until a human ticks it. A tenant with
 * no stored row behaves byte-identically to how it behaved before.
 *
 * ## Purity
 *
 * Nothing here reads a database, a container or a clock. The impure read
 * happens once per request in `lib/workflow-command-settings.ts` and the
 * decision is these functions, in the same shape `lib/task-visibility.ts` and
 * its `-request` companion use.
 */

import type { WorkflowSafeCommandDefinition } from './workflow-safe-commands'

/**
 * The tenant's stored answer, already read.
 *
 * `enabledCommandIds: null` means the tenant has never saved the setting — NOT
 * that it saved an empty list. An empty array is a deliberate "nothing is
 * enabled" and must not be confused with the grandfathered default, which is
 * why this is a nullable list rather than a set with a sentinel.
 */
export type WorkflowCommandEnablementPolicy = {
  enabledCommandIds: readonly string[] | null
}

/** The policy for a tenant with no stored row. */
export const UNSET_WORKFLOW_COMMAND_POLICY: WorkflowCommandEnablementPolicy = {
  enabledCommandIds: null,
}

/** One catalogue entry plus this tenant's answer for it. */
export type WorkflowCommandAvailability = {
  commandId: string
  requiredFeatures: string[]
  /** i18n key supplied by the owning module; absent means "render the id". */
  labelKey: string | null
  enabled: boolean
  /**
   * Whether the declaration carries the grandfather clause. Surfaced so the
   * settings UI can explain why a row is ticked in a tenant that never saved.
   */
  defaultEnabled: boolean
}

function normalizeIds(values: readonly unknown[]): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length > 0) seen.add(trimmed)
  }
  return [...seen]
}

/**
 * Turn whatever is stored in `module_configs` into a policy.
 *
 * An absent, null or structurally wrong value all resolve to the UNSET policy,
 * i.e. to the grandfathered set. That is the conservative direction: a broken
 * row can never widen what a tenant may execute beyond what it could execute
 * before the setting existed, and it can never silently disable a command that
 * already works. Non-string members are dropped rather than failing the whole
 * read — a single bad element must not reopen the grandfathered set.
 */
export function parseStoredEnabledCommandIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null
  return normalizeIds(value)
}

function findCatalogueEntry(
  catalogue: readonly WorkflowSafeCommandDefinition[],
  commandId: string,
): WorkflowSafeCommandDefinition | null {
  return catalogue.find((command) => command.commandId === commandId) ?? null
}

/**
 * Gate 2 for one already-catalogued command.
 *
 * Takes the DEFINITION, not an id, so a caller cannot accidentally ask about a
 * command that is not in the catalogue and get a `true` back — gate 1 is
 * discharged by having the definition at all.
 */
export function isWorkflowCommandEnabled(
  command: WorkflowSafeCommandDefinition,
  policy: WorkflowCommandEnablementPolicy,
): boolean {
  if (policy.enabledCommandIds === null) return command.defaultEnabled === true
  return policy.enabledCommandIds.includes(command.commandId)
}

/**
 * Gates 1 and 2 together: the definition to execute, or `null`.
 *
 * The single answer the runtime asks for. A command absent from the catalogue
 * and a command present but not ticked are both `null` here — they differ only
 * in the message the caller reports, never in the outcome.
 */
export function resolveEnabledWorkflowCommand(
  catalogue: readonly WorkflowSafeCommandDefinition[],
  policy: WorkflowCommandEnablementPolicy,
  commandId: string,
): WorkflowSafeCommandDefinition | null {
  const command = findCatalogueEntry(catalogue, commandId)
  if (!command) return null
  return isWorkflowCommandEnabled(command, policy) ? command : null
}

/** The whole catalogue with this tenant's answer attached, in catalogue order. */
export function resolveWorkflowCommandCatalogue(
  catalogue: readonly WorkflowSafeCommandDefinition[],
  policy: WorkflowCommandEnablementPolicy,
): WorkflowCommandAvailability[] {
  return catalogue.map((command) => ({
    commandId: command.commandId,
    requiredFeatures: [...command.requiredFeatures],
    labelKey: command.labelKey ?? null,
    enabled: isWorkflowCommandEnabled(command, policy),
    defaultEnabled: command.defaultEnabled === true,
  }))
}

/**
 * The ids a settings write must persist.
 *
 * Two rules, both about not losing a tenant's answer:
 *
 * - Submitted ids outside the catalogue are DROPPED, never stored. Gate 1 makes
 *   them unexecutable anyway, so storing one would only manufacture a row that
 *   looks like a grant and is not.
 * - Stored ids outside the CURRENT catalogue are KEPT. A module can be absent
 *   from a given process (an optional peer, a temporarily disabled module), and
 *   a settings save from a UI that could not list its commands must not silently
 *   untick them.
 */
export function mergeEnabledCommandIds(
  submitted: readonly string[],
  stored: readonly string[] | null,
  catalogue: readonly WorkflowSafeCommandDefinition[],
): string[] {
  const catalogueIds = new Set(catalogue.map((command) => command.commandId))
  const kept = normalizeIds(submitted).filter((commandId) => catalogueIds.has(commandId))
  const retained = normalizeIds(stored ?? []).filter((commandId) => !catalogueIds.has(commandId))
  return [...new Set([...kept, ...retained])]
}

/** Ids a settings write asked for that the catalogue does not declare. */
export function findUncataloguedCommandIds(
  submitted: readonly string[],
  catalogue: readonly WorkflowSafeCommandDefinition[],
): string[] {
  const catalogueIds = new Set(catalogue.map((command) => command.commandId))
  return normalizeIds(submitted).filter((commandId) => !catalogueIds.has(commandId))
}
