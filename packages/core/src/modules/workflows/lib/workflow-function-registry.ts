export type WorkflowFunctionDefinition = {
  name: string
  labelKey?: string
  description?: string
}

const workflowFunctions = new Map<string, WorkflowFunctionDefinition>()

function normalizeFunctionName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function registerWorkflowFunctions(definitions: readonly WorkflowFunctionDefinition[]): void {
  for (const definition of definitions) {
    const name = normalizeFunctionName(definition.name)
    if (!name) {
      throw new Error('[internal] Workflow function descriptors require a non-empty name')
    }
    workflowFunctions.set(name, {
      name,
      ...(definition.labelKey ? { labelKey: definition.labelKey } : {}),
      ...(definition.description ? { description: definition.description } : {}),
    })
  }
}

export function listWorkflowFunctions(): WorkflowFunctionDefinition[] {
  return Array.from(workflowFunctions.values())
}

export function getWorkflowFunction(name: unknown): WorkflowFunctionDefinition | null {
  const normalized = normalizeFunctionName(name)
  if (!normalized) return null
  return workflowFunctions.get(normalized) ?? null
}

export function clearWorkflowFunctionsForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('[internal] clearWorkflowFunctionsForTests is test-only')
  }
  workflowFunctions.clear()
}
