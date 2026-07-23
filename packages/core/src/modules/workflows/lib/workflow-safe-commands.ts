export type WorkflowSafeCommandDefinition = {
  commandId: string
  requiredFeatures: readonly [string, ...string[]]
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
    workflowSafeCommands.set(commandId, { commandId, requiredFeatures })
  }
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
