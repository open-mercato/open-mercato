/**
 * Tier 1 of the UPDATE_ENTITY authorization model: what the CODE declares
 * possible.
 *
 * A registration is a CANDIDATE, not a grant. `lib/workflow-command-enablement.ts`
 * is tier 2 — the tenant setting that decides which candidates are switched on —
 * and the actor's own ACL features are the third gate at execution time.
 *
 * `requiredFeatures` stays in code because only the owning module can state it
 * correctly, and a candidate that declares none can never be enabled: there
 * would be nothing left to check.
 */
export type WorkflowSafeCommandDefinition = {
  commandId: string
  requiredFeatures: readonly [string, ...string[]]
  /**
   * i18n key for a human label, resolved from the OWNING module's locale files.
   * Optional; consumers fall back to the command id.
   */
  labelKey?: string
  /**
   * GRANDFATHER CLAUSE — reserved for commands that were already reachable
   * before the tenant enablement setting existed.
   *
   * A tenant that has never saved the setting resolves to exactly the entries
   * carrying this flag, which is what makes shipping the gate byte-identical
   * for every existing tenant. A NEW candidate MUST omit it: fail-closed for
   * new capability is the whole point of tier 2, and a module that sets it on
   * a new declaration is handing itself the tenant's decision.
   *
   * Third-party modules that registered a command before this flag existed set
   * it to preserve their behaviour — see UPGRADE_NOTES.md.
   */
  defaultEnabled?: boolean
}

const workflowSafeCommands = new Map<string, WorkflowSafeCommandDefinition>()

function normalizeCommandId(commandId: unknown): string | null {
  if (typeof commandId !== 'string') return null
  const trimmed = commandId.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeFeatures(features: readonly string[]): [string, ...string[]] | null {
  const normalized = features
    .map((feature) => feature.trim())
    .filter((feature) => feature.length > 0)
  if (normalized.length === 0) return null
  return normalized as [string, ...string[]]
}

export function registerWorkflowSafeCommands(commands: readonly WorkflowSafeCommandDefinition[]): void {
  for (const command of commands) {
    const commandId = normalizeCommandId(command.commandId)
    const requiredFeatures = normalizeFeatures(command.requiredFeatures)
    if (!commandId || !requiredFeatures) {
      throw new Error('[internal] Workflow-safe commands require a commandId and requiredFeatures')
    }
    const labelKey = typeof command.labelKey === 'string' ? command.labelKey.trim() : ''
    workflowSafeCommands.set(commandId, {
      commandId,
      requiredFeatures,
      ...(labelKey ? { labelKey } : {}),
      ...(command.defaultEnabled === true ? { defaultEnabled: true } : {}),
    })
  }
}

export function listWorkflowSafeCommands(): WorkflowSafeCommandDefinition[] {
  return Array.from(workflowSafeCommands.values())
}

export function getWorkflowSafeCommand(commandId: unknown): WorkflowSafeCommandDefinition | null {
  const normalized = normalizeCommandId(commandId)
  if (!normalized) return null
  return workflowSafeCommands.get(normalized) ?? null
}

export function isWorkflowSafeCommandId(commandId: unknown): boolean {
  return getWorkflowSafeCommand(commandId) !== null
}

export function clearWorkflowSafeCommandsForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('[internal] clearWorkflowSafeCommandsForTests is test-only')
  }
  workflowSafeCommands.clear()
}
